// ---------------------------------------------------------------------------
// math.js — minimal linear algebra. No dependencies, no allocations in hot loops.
// Matrices are row-major, 16 floats: m[row * 4 + col]. v' = M * v.
// ---------------------------------------------------------------------------

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

export function v3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a) => Math.sqrt(dot(a, a));

export function norm(a) {
  const l = len(a);
  return l > 1e-12 ? mul(a, 1 / l) : v3(0, 0, 0);
}

export function identity() {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function matmul(a, b) {
  const o = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      o[r * 4 + c] = s;
    }
  }
  return o;
}

export const mulAll = (...ms) => ms.reduce(matmul);

/** Transform a point (w = 1); returns {x,y,z,w} in the target space. */
export function xformPoint(m, p) {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3],
    y: m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7],
    z: m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11],
    w: m[12] * p.x + m[13] * p.y + m[14] * p.z + m[15],
  };
}

/** Transform a direction (w = 0), ignoring translation. */
export function xformDir(m, d) {
  return v3(
    m[0] * d.x + m[1] * d.y + m[2] * d.z,
    m[4] * d.x + m[5] * d.y + m[6] * d.z,
    m[8] * d.x + m[9] * d.y + m[10] * d.z
  );
}

export function translation(x, y, z) {
  const m = identity();
  m[3] = x;
  m[7] = y;
  m[11] = z;
  return m;
}

export function scaling(x, y = x, z = x) {
  const m = identity();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}

export function rotationX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = identity();
  m[5] = c; m[6] = -s; m[9] = s; m[10] = c;
  return m;
}

export function rotationY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = identity();
  m[0] = c; m[2] = s; m[8] = -s; m[10] = c;
  return m;
}

export function rotationZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = identity();
  m[0] = c; m[1] = -s; m[4] = s; m[5] = c;
  return m;
}

/** Right-handed look-at view matrix (camera looks down -Z). */
export function lookAt(eye, target, up) {
  const f = norm(sub(target, eye));          // forward
  const r = norm(cross(f, up));              // right
  const u = cross(r, f);                     // true up
  const m = identity();
  m[0] = r.x; m[1] = r.y; m[2] = r.z; m[3] = -dot(r, eye);
  m[4] = u.x; m[5] = u.y; m[6] = u.z; m[7] = -dot(u, eye);
  m[8] = -f.x; m[9] = -f.y; m[10] = -f.z; m[11] = dot(f, eye);
  return m;
}

/** Perspective projection, fovY in radians, depth mapped to [-1, 1]. */
export function perspective(fovY, aspect, near, far) {
  const t = 1 / Math.tan(fovY / 2);
  const m = new Float64Array(16);
  m[0] = t / aspect;
  m[5] = t;
  m[10] = (far + near) / (near - far);
  m[11] = (2 * far * near) / (near - far);
  m[14] = -1;
  return m;
}

/** Orthographic projection — used for the directional-light shadow pass. */
export function ortho(l, r, b, t, n, f) {
  const m = identity();
  m[0] = 2 / (r - l);   m[3] = -(r + l) / (r - l);
  m[5] = 2 / (t - b);   m[7] = -(t + b) / (t - b);
  m[10] = -2 / (f - n); m[11] = -(f + n) / (f - n);
  return m;
}

/**
 * Inverse-transpose of the upper-left 3x3, returned as a 4x4.
 * Required so normals stay perpendicular under non-uniform scale.
 */
export function normalMatrix(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const o = identity();
  if (Math.abs(det) < 1e-12) return o;
  const id = 1 / det;
  // inverse = adj/det ; then transpose  ->  o[row*4+col]
  o[0] = A * id;                    o[1] = B * id;                    o[2] = C * id;
  o[4] = -(b * i - c * h) * id;     o[5] = (a * i - c * g) * id;      o[6] = -(a * h - b * g) * id;
  o[8] = (b * f - c * e) * id;      o[9] = -(a * f - c * d) * id;     o[10] = (a * e - b * d) * id;
  return o;
}
