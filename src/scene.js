// ---------------------------------------------------------------------------
// scene.js — scene description, shadow pass, shading model and frame loop.
// Renderer-agnostic: it only ever touches typed arrays from framebuffer.js.
// ---------------------------------------------------------------------------

import {
  v3, norm, sub, add, mul, dot, clamp, lookAt, perspective, ortho, matmul, mulAll,
  translation, rotationX, rotationY, scaling, identity, xformPoint,
} from './math.js';
import { Framebuffer, DepthMap } from './framebuffer.js';
import { drawMesh, drawLine, projectPoint, stats, resetStats } from './raster.js';
import { plane, box, sphere, torusKnot } from './geometry.js';

export const MODES = ['shaded', 'normals', 'depth', 'uv'];

export const NEAR = 0.1;
export const FAR = 100;

export function createScene() {
  return {
    meshes: {
      floor: plane(7),
      knot: torusKnot(2.0, 0.34, 260, 22, 2, 3),
      ball: sphere(0.62, 40, 26),
      cube: box(0.9),
    },
    light: {
      dir: norm(v3(-0.55, -0.82, -0.42)), // direction the light travels
      color: v3(1.0, 0.96, 0.9),
      intensity: 1.25,
    },
    camera: { yaw: 0.9, pitch: 0.42, dist: 8.2, target: v3(0, 0.55, 0), fov: 52 },
    options: {
      mode: 'shaded',
      shadows: true,
      wireframe: false,
      spin: true,
      exposure: 1.0,
    },
    time: 0,
  };
}

// --- materials -------------------------------------------------------------
const MATERIALS = {
  floor: { kind: 'checker', a: v3(0.72, 0.73, 0.78), b: v3(0.045, 0.05, 0.07), spec: 0.35, shine: 60, rough: 0.5 },
  knot: { kind: 'stripes', a: v3(0.86, 0.09, 0.06), b: v3(0.97, 0.52, 0.03), spec: 1.1, shine: 110, rough: 0.22 },
  ball: { kind: 'solid', a: v3(0.06, 0.42, 0.92), spec: 1.3, shine: 190, rough: 0.10 },
  cube: { kind: 'solid', a: v3(0.15, 0.80, 0.42), spec: 0.8, shine: 70, rough: 0.30 },
};

function albedo(mat, u, v, out) {
  if (mat.kind === 'checker') {
    const s = (Math.floor(u * 14) + Math.floor(v * 14)) & 1;
    const c = s ? mat.a : mat.b;
    out[0] = c.x; out[1] = c.y; out[2] = c.z;
  } else if (mat.kind === 'stripes') {
    const t = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 3.0);
    out[0] = mat.a.x + (mat.b.x - mat.a.x) * t;
    out[1] = mat.a.y + (mat.b.y - mat.a.y) * t;
    out[2] = mat.a.z + (mat.b.z - mat.a.z) * t;
  } else {
    out[0] = mat.a.x; out[1] = mat.a.y; out[2] = mat.a.z;
  }
}

// --- scene graph -----------------------------------------------------------
export function objectsFor(scene) {
  const t = scene.time;
  const spin = scene.options.spin ? t : 0;
  return [
    { name: 'floor', mesh: scene.meshes.floor, material: MATERIALS.floor, model: translation(0, -1.35, 0), castsShadow: false },
    {
      name: 'knot', mesh: scene.meshes.knot, material: MATERIALS.knot,
      model: mulAll(translation(0, 0.35, 0), rotationY(spin * 0.45), rotationX(0.5 + Math.sin(spin * 0.3) * 0.12)),
      castsShadow: true,
    },
    {
      name: 'ball', mesh: scene.meshes.ball, material: MATERIALS.ball,
      model: translation(
        Math.cos(spin * 0.9) * 3.1,
        -0.55 + Math.abs(Math.sin(spin * 1.8)) * 1.5,
        Math.sin(spin * 0.9) * 3.1
      ),
      castsShadow: true,
    },
    {
      name: 'cube', mesh: scene.meshes.cube, material: MATERIALS.cube,
      model: mulAll(
        translation(Math.cos(spin * 0.9 + Math.PI) * 3.1, -0.9, Math.sin(spin * 0.9 + Math.PI) * 3.1),
        rotationY(spin * 1.3), rotationX(spin * 0.8)
      ),
      castsShadow: true,
    },
  ];
}

export function cameraMatrices(scene, width, height) {
  const { yaw, pitch, dist, target, fov } = scene.camera;
  const eye = add(target, v3(
    Math.cos(pitch) * Math.sin(yaw) * dist,
    Math.sin(pitch) * dist,
    Math.cos(pitch) * Math.cos(yaw) * dist
  ));
  const view = lookAt(eye, target, v3(0, 1, 0));
  const proj = perspective((fov * Math.PI) / 180, width / height, NEAR, FAR);
  return { eye, view, proj, viewProj: matmul(proj, view) };
}

function lightMatrices(scene) {
  const d = scene.light.dir;
  const center = v3(0, -0.2, 0);
  const eye = sub(center, mul(d, 14));
  const up = Math.abs(d.y) > 0.95 ? v3(0, 0, 1) : v3(0, 1, 0);
  const view = lookAt(eye, center, up);
  const R = 7.6;
  const proj = ortho(-R, R, -R, R, 0.5, 30);
  return matmul(proj, view);
}

// --- shading ---------------------------------------------------------------
const ALB = [0, 0, 0];

function makeShader(scene, ctx) {
  const { light, options } = scene;
  const L = mul(light.dir, -1);            // surface -> light
  const eye = ctx.eye;
  const mode = options.mode;
  const useShadow = options.shadows && ctx.shadow;
  const sm = ctx.shadow;

  return function shade(f) {
    // --- debug visualisations -------------------------------------------
    if (mode === 'normals') {
      f.out[0] = f.nx * 0.5 + 0.5; f.out[1] = f.ny * 0.5 + 0.5; f.out[2] = f.nz * 0.5 + 0.5;
      return true;
    }
    if (mode === 'depth') {
      // NDC z is heavily non-linear, so linearise it back to view-space metres
      // before display, otherwise everything collapses to a flat silhouette.
      const zl = (2 * NEAR * FAR) / (FAR + NEAR - f.depth * (FAR - NEAR));
      const t = 1 - clamp((zl - 3.5) / 11, 0, 1);
      const g = t * t * 1.6;
      f.out[0] = g * 0.35; f.out[1] = g * 0.85; f.out[2] = g * 1.0;
      return true;
    }
    if (mode === 'uv') {
      f.out[0] = f.u % 1; f.out[1] = f.v % 1; f.out[2] = 0.35;
      return true;
    }

    const mat = ctx.material;
    albedo(mat, f.u, f.v, ALB);

    let nx = f.nx, ny = f.ny, nz = f.nz;
    if (f.facingBack) { nx = -nx; ny = -ny; nz = -nz; }

    const ndl = nx * L.x + ny * L.y + nz * L.z;
    let diff = ndl > 0 ? ndl : 0;

    // --- shadow map lookup (3x3 PCF) -------------------------------------
    let shadow = 1;
    if (useShadow && diff > 0) {
      const c = xformPoint(sm.viewProj, { x: f.px, y: f.py, z: f.pz });
      if (c.w > 1e-6) {
        const sx = (c.x / c.w * 0.5 + 0.5) * sm.map.size;
        const sy = (0.5 - c.y / c.w * 0.5) * sm.map.size;
        const sz = c.z / c.w;
        if (sx >= 1 && sy >= 1 && sx < sm.map.size - 1 && sy < sm.map.size - 1) {
          const bias = 0.0016 + 0.006 * (1 - ndl);
          let lit = 0, n = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const d = sm.map.data[((sy + oy) | 0) * sm.map.size + ((sx + ox) | 0)];
              lit += sz - bias <= d ? 1 : 0;
              n++;
            }
          }
          shadow = lit / n;
        }
      }
    }
    diff *= 0.08 + 0.92 * shadow;

    // --- Blinn-Phong specular --------------------------------------------
    let vx = eye.x - f.px, vy = eye.y - f.py, vz = eye.z - f.pz;
    const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    let hx = L.x + vx, hy = L.y + vy, hz = L.z + vz;
    const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
    const ndh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
    const spec = Math.pow(ndh, mat.shine) * mat.spec * shadow;

    // --- hemisphere ambient + fresnel rim --------------------------------
    const up = ny * 0.5 + 0.5;
    const ambR = 0.055 + 0.075 * up, ambG = 0.065 + 0.085 * up, ambB = 0.095 + 0.11 * up;
    const ndv = Math.max(0, nx * vx + ny * vy + nz * vz);
    const rim = Math.pow(1 - ndv, 6) * 0.075 * (1 - mat.rough);

    const li = light.intensity;
    f.out[0] = ALB[0] * (ambR + diff * light.color.x * li) + spec * light.color.x * li * 0.6 + rim * 0.30;
    f.out[1] = ALB[1] * (ambG + diff * light.color.y * li) + spec * light.color.y * li * 0.6 + rim * 0.48;
    f.out[2] = ALB[2] * (ambB + diff * light.color.z * li) + spec * light.color.z * li * 0.6 + rim * 0.90;
    return true;
  };
}

// --- frame -----------------------------------------------------------------
export function createRenderer(width, height, shadowSize = 768) {
  return {
    fb: new Framebuffer(width, height),
    shadowMap: new DepthMap(shadowSize),
  };
}

const SKY_TOP = [0.010, 0.013, 0.024];
const SKY_BOTTOM = [0.055, 0.042, 0.075];

export function renderFrame(renderer, scene) {
  const t0 = now();
  const { fb, shadowMap } = renderer;
  const { width, height } = fb;
  resetStats();

  const objects = objectsFor(scene);
  const cam = cameraMatrices(scene, width, height);

  // ---- shadow pass --------------------------------------------------------
  let shadow = null;
  if (scene.options.shadows) {
    const viewProj = lightMatrices(scene);
    shadowMap.clear();
    for (const obj of objects) {
      if (!obj.castsShadow) continue;
      drawMesh({
        mesh: obj.mesh, colorBuffer: null, depthBuffer: shadowMap.data,
        width: shadowMap.size, height: shadowMap.size,
        model: obj.model, viewProj, shader: null, cull: false,
      });
    }
    shadow = { map: shadowMap, viewProj };
  }
  const tShadow = now();

  // ---- main pass ----------------------------------------------------------
  fb.clearGradient(SKY_TOP, SKY_BOTTOM);
  for (const obj of objects) {
    const ctx = { eye: cam.eye, material: obj.material, shadow };
    drawMesh({
      mesh: obj.mesh, colorBuffer: fb.color, depthBuffer: fb.depth,
      width, height, model: obj.model, viewProj: cam.viewProj,
      shader: makeShader(scene, ctx), cull: obj.name !== 'floor',
    });
  }

  // ---- wireframe overlay --------------------------------------------------
  if (scene.options.wireframe) {
    const rgb = [0.0, 1.4, 1.1];
    for (const obj of objects) {
      if (obj.name === 'floor') continue;
      const { positions, indices } = obj.mesh;
      const mvp = matmul(cam.viewProj, obj.model);
      const step = indices.length > 6000 ? 9 : 3; // thin out dense meshes
      for (let i = 0; i < indices.length; i += step) {
        const p = [];
        for (let k = 0; k < 3; k++) {
          const idx = indices[i + k];
          p.push(projectPoint(mvp, {
            x: positions[idx * 3], y: positions[idx * 3 + 1], z: positions[idx * 3 + 2],
          }, width, height));
        }
        if (p.some((q) => !q)) continue;
        for (let k = 0; k < 3; k++) {
          const a = p[k], b = p[(k + 1) % 3];
          drawLine(fb.color, width, height, a.x, a.y, b.x, b.y, rgb);
        }
      }
    }
  }

  const tMain = now();
  fb.resolve(scene.options.exposure);
  const t1 = now();

  return {
    rgba: fb.rgba,
    timings: { shadow: tShadow - t0, geometry: tMain - tShadow, resolve: t1 - tMain, total: t1 - t0 },
    stats: { ...stats },
  };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
