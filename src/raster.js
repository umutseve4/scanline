// ---------------------------------------------------------------------------
// raster.js — the actual rasterizer.
//
// Pipeline per mesh:
//   1. vertex transform  (model -> world -> clip)
//   2. near-plane clipping in homogeneous space (Sutherland-Hodgman)
//   3. perspective divide + viewport mapping
//   4. backface culling via signed screen-space area
//   5. edge-function scan over the bounding box, barycentric coverage
//   6. perspective-correct attribute interpolation, z-buffer test, shading
//
// Nothing here calls into a graphics API. Every pixel is written by hand.
// ---------------------------------------------------------------------------

import { xformPoint, xformDir, normalMatrix } from './math.js';

const NEAR_EPS = 1e-5;

function makeVertex() {
  return { cx: 0, cy: 0, cz: 0, cw: 1, wx: 0, wy: 0, wz: 0, nx: 0, ny: 0, nz: 0, u: 0, v: 0 };
}

function copyVertex(dst, src) {
  dst.cx = src.cx; dst.cy = src.cy; dst.cz = src.cz; dst.cw = src.cw;
  dst.wx = src.wx; dst.wy = src.wy; dst.wz = src.wz;
  dst.nx = src.nx; dst.ny = src.ny; dst.nz = src.nz;
  dst.u = src.u; dst.v = src.v;
  return dst;
}

function lerpVertex(dst, a, b, t) {
  dst.cx = a.cx + (b.cx - a.cx) * t;
  dst.cy = a.cy + (b.cy - a.cy) * t;
  dst.cz = a.cz + (b.cz - a.cz) * t;
  dst.cw = a.cw + (b.cw - a.cw) * t;
  dst.wx = a.wx + (b.wx - a.wx) * t;
  dst.wy = a.wy + (b.wy - a.wy) * t;
  dst.wz = a.wz + (b.wz - a.wz) * t;
  dst.nx = a.nx + (b.nx - a.nx) * t;
  dst.ny = a.ny + (b.ny - a.ny) * t;
  dst.nz = a.nz + (b.nz - a.nz) * t;
  dst.u = a.u + (b.u - a.u) * t;
  dst.v = a.v + (b.v - a.v) * t;
  return dst;
}

// Scratch buffers — reused across every triangle so the hot loop allocates zero.
const VERTS = Array.from({ length: 3 }, makeVertex);
const CLIP_IN = Array.from({ length: 8 }, makeVertex);
const CLIP_OUT = Array.from({ length: 8 }, makeVertex);
const SCRATCH = Array.from({ length: 8 }, makeVertex);
const SCREEN = Array.from({ length: 8 }, () => ({ x: 0, y: 0, z: 0, invW: 0, v: null }));
const FRAG = {
  x: 0, y: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, u: 0, v: 0, depth: 0,
  out: [0, 0, 0],
};

/** Clip a polygon against the near plane (z + w >= 0). Returns vertex count. */
function clipNear(poly, count, out) {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % count];
    const da = a.cz + a.cw;
    const db = b.cz + b.cw;
    const ina = da >= NEAR_EPS;
    const inb = db >= NEAR_EPS;
    if (ina) copyVertex(out[n++], a);
    if (ina !== inb) {
      const t = da / (da - db);
      lerpVertex(out[n++], a, b, t);
    }
  }
  return n;
}

export const stats = { triangles: 0, fragments: 0, clipped: 0 };

export function resetStats() {
  stats.triangles = 0;
  stats.fragments = 0;
  stats.clipped = 0;
}

/**
 * Rasterize one mesh into a target.
 * @param {object} o
 * @param {Float32Array} o.colorBuffer  linear RGB target (null for depth-only)
 * @param {Float32Array} o.depthBuffer  z-buffer, same pixel count
 * @param {number} o.width  @param {number} o.height
 * @param {Float64Array} o.model  @param {Float64Array} o.viewProj
 * @param {Function} [o.shader] fragment shader (frag) -> writes frag.out
 * @param {boolean} [o.cull=true] backface culling
 * @param {number} [o.depthBias=0]
 */
export function drawMesh(o) {
  const {
    mesh, colorBuffer, depthBuffer, width, height,
    model, viewProj, shader = null, cull = true, depthBias = 0,
  } = o;

  const nrmM = normalMatrix(model);
  const { positions, normals, uvs, indices } = mesh;
  const triCount = indices.length / 3;

  for (let t = 0; t < triCount; t++) {
    // ---- 1. vertex stage -------------------------------------------------
    for (let k = 0; k < 3; k++) {
      const idx = indices[t * 3 + k];
      const V = VERTS[k];
      const px = positions[idx * 3], py = positions[idx * 3 + 1], pz = positions[idx * 3 + 2];
      const w = xformPoint(model, { x: px, y: py, z: pz });
      V.wx = w.x; V.wy = w.y; V.wz = w.z;
      const n = xformDir(nrmM, {
        x: normals[idx * 3], y: normals[idx * 3 + 1], z: normals[idx * 3 + 2],
      });
      const nl = Math.hypot(n.x, n.y, n.z) || 1;
      V.nx = n.x / nl; V.ny = n.y / nl; V.nz = n.z / nl;
      V.u = uvs[idx * 2]; V.v = uvs[idx * 2 + 1];
      const c = xformPoint(viewProj, w);
      V.cx = c.x; V.cy = c.y; V.cz = c.z; V.cw = c.w;
      copyVertex(CLIP_IN[k], V);
    }

    // ---- 2. near-plane clipping -----------------------------------------
    let poly = CLIP_IN;
    let count = 3;
    const needsClip =
      CLIP_IN[0].cz + CLIP_IN[0].cw < NEAR_EPS ||
      CLIP_IN[1].cz + CLIP_IN[1].cw < NEAR_EPS ||
      CLIP_IN[2].cz + CLIP_IN[2].cw < NEAR_EPS;
    if (needsClip) {
      count = clipNear(CLIP_IN, 3, CLIP_OUT);
      poly = CLIP_OUT;
      stats.clipped++;
      if (count < 3) continue;
    }

    // ---- 3. perspective divide + viewport map ---------------------------
    for (let i = 0; i < count; i++) {
      const v = copyVertex(SCRATCH[i], poly[i]);
      const invW = 1 / v.cw;
      const s = SCREEN[i];
      s.x = (v.cx * invW * 0.5 + 0.5) * width;
      s.y = (0.5 - v.cy * invW * 0.5) * height;
      s.z = v.cz * invW;
      s.invW = invW;
      s.v = v;
    }

    // Fan-triangulate the (possibly clipped) polygon.
    for (let f = 1; f + 1 < count; f++) {
      rasterTriangle(
        SCREEN[0], SCREEN[f], SCREEN[f + 1],
        colorBuffer, depthBuffer, width, height, shader, cull, depthBias
      );
    }
  }
}

function rasterTriangle(A, B, C, colorBuffer, depthBuffer, width, height, shader, cull, depthBias) {
  let area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
  if (!(Math.abs(area) > 1e-9)) return;

  // Front faces (CCW in NDC) become negative-area after the Y flip.
  const facingBack = area > 0;
  if (cull && facingBack) return;
  const sign = area > 0 ? 1 : -1; // normalise so area and barycentrics are positive
  area *= sign;

  let minX = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x)));
  let maxX = Math.min(width - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
  let minY = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y)));
  let maxY = Math.min(height - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
  if (minX > maxX || minY > maxY) return;

  stats.triangles++;
  const invArea = 1 / area;

  // Edge function coefficients: w = a*x + b*y + c  (already sign-normalised)
  const e0a = (B.y - C.y) * sign, e0b = (C.x - B.x) * sign;
  const e0c = (B.x * C.y - C.x * B.y) * sign;
  const e1a = (C.y - A.y) * sign, e1b = (A.x - C.x) * sign;
  const e1c = (C.x * A.y - A.x * C.y) * sign;
  const e2a = (A.y - B.y) * sign, e2b = (B.x - A.x) * sign;
  const e2c = (A.x * B.y - B.x * A.y) * sign;

  const va = A.v, vb = B.v, vc = C.v;

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    let w0 = e0a * (minX + 0.5) + e0b * py + e0c;
    let w1 = e1a * (minX + 0.5) + e1b * py + e1c;
    let w2 = e2a * (minX + 0.5) + e2b * py + e2c;
    const row = y * width;
    for (let x = minX; x <= maxX; x++, w0 += e0a, w1 += e1a, w2 += e2a) {
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const l0 = w0 * invArea, l1 = w1 * invArea, l2 = w2 * invArea;
      const z = l0 * A.z + l1 * B.z + l2 * C.z + depthBias;
      const pi = row + x;
      if (z >= depthBuffer[pi]) continue;

      if (!shader) { depthBuffer[pi] = z; stats.fragments++; continue; }

      // Perspective-correct interpolation: attr/w interpolated, then / (1/w).
      const iw = l0 * A.invW + l1 * B.invW + l2 * C.invW;
      const pw = 1 / iw;
      const k0 = l0 * A.invW * pw, k1 = l1 * B.invW * pw, k2 = l2 * C.invW * pw;

      FRAG.x = x; FRAG.y = y; FRAG.depth = z;
      FRAG.px = k0 * va.wx + k1 * vb.wx + k2 * vc.wx;
      FRAG.py = k0 * va.wy + k1 * vb.wy + k2 * vc.wy;
      FRAG.pz = k0 * va.wz + k1 * vb.wz + k2 * vc.wz;
      let nx = k0 * va.nx + k1 * vb.nx + k2 * vc.nx;
      let ny = k0 * va.ny + k1 * vb.ny + k2 * vc.ny;
      let nz = k0 * va.nz + k1 * vb.nz + k2 * vc.nz;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      FRAG.nx = nx / nl; FRAG.ny = ny / nl; FRAG.nz = nz / nl;
      FRAG.u = k0 * va.u + k1 * vb.u + k2 * vc.u;
      FRAG.v = k0 * va.v + k1 * vb.v + k2 * vc.v;
      FRAG.facingBack = facingBack;

      if (shader(FRAG) === false) continue; // shader may discard
      depthBuffer[pi] = z;
      const ci = pi * 3;
      colorBuffer[ci] = FRAG.out[0];
      colorBuffer[ci + 1] = FRAG.out[1];
      colorBuffer[ci + 2] = FRAG.out[2];
      stats.fragments++;
    }
  }
}

/** Bresenham line into the colour buffer — used by the wireframe overlay. */
export function drawLine(colorBuffer, width, height, x0, y0, x1, y1, rgb) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 8192; guard++) {
    if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
      const i = (y0 * width + x0) * 3;
      colorBuffer[i] = rgb[0]; colorBuffer[i + 1] = rgb[1]; colorBuffer[i + 2] = rgb[2];
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Project a world point to screen space; returns null if behind the near plane. */
export function projectPoint(viewProj, p, width, height) {
  const c = xformPoint(viewProj, p);
  if (c.w <= NEAR_EPS) return null;
  return {
    x: (c.x / c.w * 0.5 + 0.5) * width,
    y: (0.5 - c.y / c.w * 0.5) * height,
    z: c.z / c.w,
  };
}
