// ---------------------------------------------------------------------------
// geometry.js — procedural meshes. Every mesh is a flat, indexed triangle soup:
//   positions: Float32Array (3 per vertex)
//   normals:   Float32Array (3 per vertex)
//   uvs:       Float32Array (2 per vertex)
//   indices:   Uint32Array  (3 per triangle)
// ---------------------------------------------------------------------------

import { v3, sub, cross, norm, add, mul } from './math.js';

function mesh(positions, normals, uvs, indices) {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    get triangleCount() { return this.indices.length / 3; },
    get vertexCount() { return this.positions.length / 3; },
  };
}

/** Ground plane on Y = 0, spanning [-s, s]. */
export function plane(s = 6) {
  return mesh(
    [-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 2, 1, 0, 3, 2]
  );
}

/** Axis-aligned cube with per-face normals (hard edges). */
export function box(sx = 1, sy = sx, sz = sx) {
  const P = [], N = [], U = [], I = [];
  const faces = [
    [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1], [1, 0, 0]],
    [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1], [-1, 0, 0]],
    [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1], [0, 1, 0]],
    [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1], [0, -1, 0]],
    [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1], [0, 0, 1]],
    [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1], [0, 0, -1]],
  ];
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    const base = P.length / 3;
    const n = f[4];
    for (let k = 0; k < 4; k++) {
      P.push(f[k][0] * sx * 0.5, f[k][1] * sy * 0.5, f[k][2] * sz * 0.5);
      N.push(n[0], n[1], n[2]);
      U.push(uv[k][0], uv[k][1]);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return mesh(P, N, U, I);
}

/** UV sphere with smooth normals. */
export function sphere(radius = 1, segU = 48, segV = 32) {
  const P = [], N = [], U = [], I = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV, phi = v * Math.PI;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU, theta = u * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      P.push(x * radius, y * radius, z * radius);
      N.push(x, y, z);
      U.push(u, v);
    }
  }
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * (segU + 1) + i, b = a + segU + 1;
      I.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh(P, N, U, I);
}

/**
 * (p, q) torus knot swept with a tube. Normals come from the tube's own
 * parametrisation, so no averaging pass is needed.
 */
export function torusKnot(radius = 1, tube = 0.32, segT = 220, segR = 20, p = 2, q = 3) {
  const curve = (t) => {
    const u = t * p * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    const qo = (q / p) * u;
    const cs = Math.cos(qo);
    return v3(radius * (2 + cs) * 0.5 * cu, radius * Math.sin(qo) * 0.5, radius * (2 + cs) * 0.5 * su);
  };
  const P = [], N = [], U = [], I = [];
  for (let i = 0; i <= segT; i++) {
    const t = i / segT;
    const pt = curve(t);
    const nx = curve(t + 1e-4);
    const T = norm(sub(nx, pt));
    // Robust frame: pick any axis not parallel to T.
    const helper = Math.abs(T.y) < 0.99 ? v3(0, 1, 0) : v3(1, 0, 0);
    const B = norm(cross(T, helper));
    const Nn = norm(cross(B, T));
    for (let j = 0; j <= segR; j++) {
      const a = (j / segR) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const dir = norm(add(mul(B, ca), mul(Nn, sa)));
      const pos = add(pt, mul(dir, tube));
      P.push(pos.x, pos.y, pos.z);
      N.push(dir.x, dir.y, dir.z);
      U.push(t * 6, j / segR);
    }
  }
  for (let i = 0; i < segT; i++) {
    for (let j = 0; j < segR; j++) {
      const a = i * (segR + 1) + j, b = a + segR + 1;
      I.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return mesh(P, N, U, I);
}
