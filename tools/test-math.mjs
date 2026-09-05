// Tiny assertion suite for the math layer — no test framework needed.
import {
  v3, add, sub, mul, dot, cross, norm, len, identity, matmul, xformPoint,
  xformDir, translation, scaling, rotationY, lookAt, perspective, ortho, normalMatrix,
} from '../src/math.js';

let failed = 0;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
function ok(name, cond) {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name}`); failed++; }
}

// --- vectors ---------------------------------------------------------------
ok('cross(x, y) == z', (() => { const c = cross(v3(1, 0, 0), v3(0, 1, 0)); return near(c.x, 0) && near(c.y, 0) && near(c.z, 1); })());
ok('norm length is 1', near(len(norm(v3(3, -4, 12))), 1));
ok('dot of perpendicular is 0', near(dot(v3(1, 2, 3), cross(v3(1, 2, 3), v3(0, 1, 0))), 0));
ok('add/sub round-trip', (() => { const a = v3(1, 2, 3), b = v3(-4, 5, 6); const r = sub(add(a, b), b); return near(r.x, 1) && near(r.y, 2) && near(r.z, 3); })());

// --- matrices --------------------------------------------------------------
ok('identity leaves points alone', (() => { const p = xformPoint(identity(), v3(2, 3, 4)); return near(p.x, 2) && near(p.y, 3) && near(p.z, 4) && near(p.w, 1); })());
ok('translation moves points', (() => { const p = xformPoint(translation(1, 2, 3), v3(0, 0, 0)); return near(p.x, 1) && near(p.y, 2) && near(p.z, 3); })());
ok('translation does not move directions', (() => { const d = xformDir(translation(9, 9, 9), v3(1, 0, 0)); return near(d.x, 1) && near(d.y, 0) && near(d.z, 0); })());
ok('rotationY(90deg) maps +X to -Z', (() => { const p = xformPoint(rotationY(Math.PI / 2), v3(1, 0, 0)); return near(p.x, 0, 1e-9) && near(p.z, -1, 1e-9); })());
ok('matmul is associative', (() => {
  const a = rotationY(0.4), b = translation(1, 2, 3), c = scaling(2, 3, 4);
  const l = matmul(matmul(a, b), c), r = matmul(a, matmul(b, c));
  return l.every((v, i) => near(v, r[i], 1e-9));
})());

// --- camera ----------------------------------------------------------------
ok('lookAt puts the eye at the origin of view space', (() => {
  const p = xformPoint(lookAt(v3(4, 3, 5), v3(0, 0, 0), v3(0, 1, 0)), v3(4, 3, 5));
  return near(p.x, 0, 1e-9) && near(p.y, 0, 1e-9) && near(p.z, 0, 1e-9);
})());
ok('lookAt puts the target down -Z', (() => {
  const p = xformPoint(lookAt(v3(0, 0, 5), v3(0, 0, 0), v3(0, 1, 0)), v3(0, 0, 0));
  return p.z < 0 && near(p.x, 0, 1e-9) && near(p.y, 0, 1e-9);
})());
ok('perspective maps near plane to z=-1', (() => {
  const m = perspective(Math.PI / 3, 1.5, 0.1, 100);
  const c = xformPoint(m, v3(0, 0, -0.1));
  return near(c.z / c.w, -1, 1e-6);
})());
ok('perspective maps far plane to z=+1', (() => {
  const m = perspective(Math.PI / 3, 1.5, 0.1, 100);
  const c = xformPoint(m, v3(0, 0, -100));
  return near(c.z / c.w, 1, 1e-6);
})());
ok('perspective divides by depth (w == -z_view)', (() => {
  const c = xformPoint(perspective(Math.PI / 3, 1, 0.1, 100), v3(1, 1, -7));
  return near(c.w, 7, 1e-9);
})());
ok('ortho maps its box corners to the unit cube', (() => {
  const m = ortho(-2, 2, -2, 2, 1, 11);
  const a = xformPoint(m, v3(2, 2, -1)), b = xformPoint(m, v3(-2, -2, -11));
  return near(a.x, 1) && near(a.y, 1) && near(a.z, -1) && near(b.x, -1) && near(b.y, -1) && near(b.z, 1);
})());

// --- normal matrix ---------------------------------------------------------
ok('normal stays perpendicular under non-uniform scale', (() => {
  const M = matmul(rotationY(0.7), scaling(1, 4, 1));
  const N = normalMatrix(M);
  // tangent on a 45-degree slope in the XY plane, with its normal
  const tangent = v3(1, 1, 0), normal = v3(1, -1, 0);
  const t2 = xformDir(M, tangent);
  const n2 = norm(xformDir(N, normal));
  return near(dot(t2, n2), 0, 1e-9);
})());
ok('normalMatrix of a rotation is the rotation itself', (() => {
  const R = rotationY(0.9), N = normalMatrix(R);
  return [0, 1, 2, 4, 5, 6, 8, 9, 10].every((i) => near(R[i], N[i], 1e-9));
})());
ok('normalMatrix of a singular matrix degrades to identity', (() => {
  const N = normalMatrix(scaling(0, 0, 0));
  return near(N[0], 1) && near(N[5], 1) && near(N[10], 1);
})());

console.log(failed ? `\n${failed} assertion(s) failed` : '\nall math assertions passed');
process.exit(failed ? 1 : 0);
