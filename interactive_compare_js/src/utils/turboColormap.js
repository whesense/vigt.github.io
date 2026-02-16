/**
 * Turbo colormap (same simplified implementation as other demos).
 * Returns [r,g,b] in [0,1] for value in [0,1].
 */

export function turboColormap(value) {
  value = Math.max(0, Math.min(1, value));

  let r, g, b;
  if (value < 0.25) {
    const t = value / 0.25;
    r = 0.0;
    g = t * 0.5;
    b = 0.5 + t * 0.5;
  } else if (value < 0.5) {
    const t = (value - 0.25) / 0.25;
    r = 0.0;
    g = 0.5 + t * 0.5;
    b = 1.0 - t * 0.5;
  } else if (value < 0.75) {
    const t = (value - 0.5) / 0.25;
    r = t * 0.5;
    g = 1.0;
    b = 0.0;
  } else {
    const t = (value - 0.75) / 0.25;
    r = 0.5 + t * 0.5;
    g = 1.0 - t;
    b = 0.0;
  }
  return [r, g, b];
}

export function normalizeHeight(z, zBounds) {
  const [zMin, zMax] = zBounds;
  if (zMax === zMin) return 0.5;
  return Math.max(0, Math.min(1, (z - zMin) / (zMax - zMin)));
}

