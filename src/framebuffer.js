// ---------------------------------------------------------------------------
// framebuffer.js — colour + depth targets. Plain typed arrays, so the exact
// same code path runs in the browser and in Node (headless still renders).
// ---------------------------------------------------------------------------

export class Framebuffer {
  constructor(width, height) {
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width | 0;
    this.height = height | 0;
    const n = this.width * this.height;
    this.color = new Float32Array(n * 3); // linear RGB, pre-gamma
    this.depth = new Float32Array(n);     // NDC z, smaller = closer
    this.rgba = new Uint8ClampedArray(n * 4);
    return this;
  }

  clear(r = 0, g = 0, b = 0) {
    const c = this.color;
    for (let i = 0; i < c.length; i += 3) {
      c[i] = r; c[i + 1] = g; c[i + 2] = b;
    }
    this.depth.fill(Infinity);
  }

  /** Vertical gradient background, cheap and much nicer than a flat clear. */
  clearGradient(top, bottom) {
    const { width, height, color } = this;
    for (let y = 0; y < height; y++) {
      const t = height > 1 ? y / (height - 1) : 0;
      const r = top[0] + (bottom[0] - top[0]) * t;
      const g = top[1] + (bottom[1] - top[1]) * t;
      const b = top[2] + (bottom[2] - top[2]) * t;
      let i = y * width * 3;
      for (let x = 0; x < width; x++, i += 3) {
        color[i] = r; color[i + 1] = g; color[i + 2] = b;
      }
    }
    this.depth.fill(Infinity);
  }

  /**
   * Tonemap (ACES filmic approximation) + gamma 2.2 + subtle vignette,
   * into 8-bit RGBA. ACES keeps shadows dense instead of washing them grey.
   * This is the only place linear light becomes display pixels.
   */
  resolve(exposure = 1.0, vignette = 0.28) {
    const { width, height, color, rgba } = this;
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    const invR = 1 / Math.sqrt(cx * cx + cy * cy);
    for (let y = 0, p = 0, q = 0; y < height; y++) {
      for (let x = 0; x < width; x++, p += 3, q += 4) {
        const dx = (x - cx) * invR, dy = (y - cy) * invR;
        const v = 1 - vignette * (dx * dx + dy * dy);
        for (let k = 0; k < 3; k++) {
          let c = color[p + k] * exposure * v;
          if (c < 0) c = 0;
          c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14); // ACES
          rgba[q + k] = 255 * Math.pow(c > 1 ? 1 : c, 1 / 2.2);
        }
        rgba[q + 3] = 255;
      }
    }
    return this.rgba;
  }
}

/** Depth-only target for the shadow pass. */
export class DepthMap {
  constructor(size) {
    this.size = size | 0;
    this.data = new Float32Array(this.size * this.size);
  }
  clear() {
    this.data.fill(Infinity);
  }
}
