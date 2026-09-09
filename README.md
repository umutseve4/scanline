<h1 align="center">scanline</h1>

<p align="center">
  A 3D renderer that uses no GPU and computes every pixel one by one in JavaScript.<br>
  Triangle scan, z-buffer, shadow map, lighting, tonemapping. All of it written by hand.<br>
  <code>canvas</code> exists only to blit the finished pixel array to the screen.
</p>

<p align="center">
  <a href="https://umutseve4.github.io/scanline/"><b>Live demo</b></a>
</p>

<p align="center">
  <a href="https://github.com/umutseve4/scanline/actions"><img src="https://github.com/umutseve4/scanline/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/CI%20steps-5-FF4D4F?style=flat-square" alt="5 CI steps">
  <img src="https://img.shields.io/badge/dependencies-0-FF4D4F?style=flat-square" alt="0 dependencies">
  <img src="https://img.shields.io/badge/pipeline%20stages-10-FF4D4F?style=flat-square" alt="10 stages">
</p>

---

## What happens in the first 30 seconds

```bash
git clone https://github.com/umutseve4/scanline && cd scanline
npm run build      # -> dist/scanline.html
```

Double click the single file that comes out. No server, no install, no internet needed.

If you would rather run it from source, any simple server will do for ES modules:

```bash
python3 -m http.server 8000   # then http://localhost:8000
```

On screen: a rotating (2,3) torus knot, a bouncing sphere, a spinning cube and a checkerboard floor, drawn in real time with a directional light, a 3x3 PCF soft shadow, a Blinn-Phong specular and an ACES tonemap.

## Controls

| Control | What it does |
| --- | --- |
| Mode | `shaded`, `normals`, `depth` (linearised), `uv` |
| Shadow map | 768x768 shadow map plus PCF, on or off |
| Wireframe | Wireframe overlay drawn with Bresenham lines |
| Resolution | Internal render scale from 0.25x to 1.0x |
| Exposure | Pre ACES exposure from 0.30 to 2.50 |
| Save PNG | Downloads the current frame |

Shortcuts: `W` wireframe, `S` shadow, `Space` pause, `1` to `4` render mode. Drag with the mouse to orbit, wheel to zoom. The HUD shows fps, frame time, resolution, rasterised triangles, shaded fragments, clipped triangles and milliseconds per pass, live.

## Measured reference numbers

Node 24, single core, 960x600, **20,485 triangles**, **527,240 fragments**, 2 triangles clipped at the near plane:

| Pass | Time |
| --- | --- |
| Shadow pass | 43.63 ms |
| Geometry and shading | 178.76 ms |
| Resolve | 53.52 ms |
| **Total** | **275.91 ms** |

In the same run, subject coverage was **66.0%** and mean brightness **81.99/255**. Bundle verification passed at 675x420 with **65.1%** coverage and a maximum luma of **223.67**.

## Verification

CI (`.github/workflows/ci.yml`) runs five steps on every push, and none of them rests on the assumption that "it built, so it works":

| Step | What it proves |
| --- | --- |
| `test` | 18 maths assertions: does `lookAt` move the camera to the origin, does `perspective` map the near and far planes exactly to -1 and +1, does `normalMatrix` keep perpendicularity under non uniform scale, does it fall back to identity on a singular matrix |
| `still` | Renders a headless frame and inspects the pixel statistics. **A black or flat frame fails CI** |
| `modes` | Renders the four render modes separately and verifies their hashes differ (a broken mode switch would produce four identical frames) |
| `build` | Inlines six ES modules into one HTML file, and errors out if any `import` or `export` is left in the output |
| `verify` | **Runs** the produced single file inside Node's `vm` with a minimal DOM stub, captures the real pixels heading for `putImageData`, and checks the coverage and brightness thresholds |

So what is tested is not "the bundle parses", it is **"the bundle draws an image"**.

<details>
<summary><b>Pipeline: the hand written version of what a GPU does silently</b></summary>

Inside `src/raster.js`:

1. **Vertex transform.** Model to world to clip space; normals are carried by the inverse transpose matrix so they stay perpendicular under non uniform scale.
2. **Near plane clipping.** Sutherland-Hodgman in homogeneous space; triangles crossing behind the camera are clipped and the result is fan triangulated.
3. **Perspective divide and viewport map.** NDC to pixel coordinates.
4. **Backface culling.** Using the signed screen area.
5. **Edge function scan.** Incremental edge functions over the bounding box; the coverage test is 3 comparisons.
6. **Perspective correct interpolation.** Attribute over w interpolation, then division by 1/w. (Affine interpolation visibly warped the floor.)
7. **Z-buffer.** A Float32Array depth buffer.
8. **Shadow pass.** An orthographic depth render for the light, then 3x3 PCF and a slope dependent depth bias (`0.0016 + 0.006 * (1 - N·L)`) to keep shadow acne away.
9. **Shading.** Hemisphere ambient plus Lambert diffuse plus Blinn-Phong specular plus a Fresnel rim; procedural checker and stripe albedo.
10. **Resolve.** ACES filmic tonemap, vignette, gamma 2.2.

There is no allocation in the hot loop: the vertex, clip and fragment structures are allocated once at module level and reused.

</details>

<details>
<summary><b>File layout and the other commands</b></summary>

```
src/math.js         4x4 matrix and vector layer (lookAt, perspective, ortho, normalMatrix)
src/framebuffer.js  linear colour and depth targets, ACES resolve
src/geometry.js     procedural plane / box / sphere / torus knot
src/raster.js       rasteriser: clipping, culling, edge scan, z-test, line drawing
src/scene.js        scene graph, light, shadow pass, shading model, frame loop
src/main.js         browser layer: canvas blit, orbit control, HUD, UI
tools/              headless render, PNG encoder, tests, single file build
```

The renderer knows nothing about the DOM, which is why the same code also runs under Node and produces a PNG.

```bash
npm run still     # headless still render plus smoke test
npm run modes     # render every debug mode into one contact sheet
npm test          # unit tests for the maths layer (18 assertions)
```

</details>

## Why it is interesting

Everything a GPU does silently for you is visible here: remove the perspective correct interpolation and textures slide, zero the depth bias and shadow acne appears, skip the near plane clipping and triangles behind the camera tear across the screen. That is why the code was written to be **readable** rather than short.

## Limits

- **Not real time, honestly timed.** The 275.91 ms above is a single core CPU measurement; a GPU draws the same frame in microseconds. This project was written for visibility, not for speed.
- It runs only on Node 18 or newer. No dependencies, but there is a platform requirement.
- The live demo runs in the browser, and the published file is identical to the `npm run build` output. The browser frame rate was not measured and no fps claim is published anywhere.
- There are no texture files, no material system, no animation import and no transparency sorting; albedo is procedural.
- CI proves pixels are drawn. Visual correctness in a browser, accessibility and frame rate behaviour need a separate acceptance pass.

---

MIT
