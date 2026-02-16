/**
 * Shared BEV (Bird's Eye View) renderer.
 *
 * Supports:
 * - LiDAR point projection (world -> canvas)
 * - Grid overlay (for the currently visible viewWindow)
 * - Selected-cell highlight (forward attention)
 * - Multi-region heatmap overlay (inverse attention)
 *
 * This is intentionally framework-agnostic and only depends on a canvas.
 */
 
import { fullWindow, windowToViewRange } from './BEVViewWindow.js';

/**
 * @typedef {{x0:number,x1:number,y0:number,y1:number}} ViewWindow
 */

/**
 * @typedef {{ bevMap:Array<Array<number>>, color:string, alpha?:number }} RegionOverlay
 */

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function colorToRgb(color) {
  const named = {
    red: [1, 0, 0],
    green: [0, 1, 0],
    blue: [0, 0, 1],
    cyan: [0, 1, 1],
    orange: [1, 0.5, 0],
    purple: [0.5, 0, 0.5],
    magenta: [1, 0, 1],
    yellow: [1, 1, 0],
    white: [1, 1, 1],
    black: [0, 0, 0],
    grey: [0.5, 0.5, 0.5],
    gray: [0.5, 0.5, 0.5],
  };

  if (!color) return [1, 0, 0];
  const lower = String(color).toLowerCase();
  if (named[lower]) return named[lower];

  if (lower.startsWith('#') && (lower.length === 7 || lower.length === 4)) {
    if (lower.length === 7) {
      const r = parseInt(lower.slice(1, 3), 16) / 255;
      const g = parseInt(lower.slice(3, 5), 16) / 255;
      const b = parseInt(lower.slice(5, 7), 16) / 255;
      return [r, g, b];
    }
    // #rgb short form
    const r = parseInt(lower[1] + lower[1], 16) / 255;
    const g = parseInt(lower[2] + lower[2], 16) / 255;
    const b = parseInt(lower[3] + lower[3], 16) / 255;
    return [r, g, b];
  }

  return [1, 0, 0];
}

function rgbToCss(rgb) {
  const [r, g, b] = rgb;
  return `rgb(${Math.round(clamp01(r) * 255)}, ${Math.round(clamp01(g) * 255)}, ${Math.round(clamp01(b) * 255)})`;
}

/**
 * Transform world coordinates to plot coordinates for BEV visualization.
 *
 * Matches existing convention used in this repo:
 * - plotWorldX = -worldY
 * - plotWorldY = worldX
 * - plot X axis is reversed (left is max), then canvas X is additionally flipped
 *   in the LiDAR renderers to match historical behavior.
 *
 * @param {number} worldX
 * @param {number} worldY
 * @param {[number,number,number,number]} viewRange [xMin,xMax,yMin,yMax]
 * @param {number} plotWidth
 * @param {number} plotHeight
 * @returns {[number,number]} [plotX, plotY]
 */
function worldToPlot(worldX, worldY, viewRange, plotWidth, plotHeight) {
  const [xMin, xMax, yMin, yMax] = viewRange;

  const plotWorldX = -worldY;
  const plotWorldY = worldX;

  // Use the viewRange to define the plot extent in the plot-coordinate system.
  // plotWorldX corresponds to -worldY, so its range is [-yMax, -yMin].
  // We set left to max and right to min to preserve the repo's flipped axis convention.
  const plotLeft = -yMin;
  const plotRight = -yMax;
  const plotBottom = xMin;
  const plotTop = xMax;

  const normX = (plotWorldX - plotLeft) / (plotRight - plotLeft);
  const normY = (plotWorldY - plotBottom) / (plotTop - plotBottom);

  const pixelX = normX * plotWidth;
  const pixelY = (1 - normY) * plotHeight;
  return [pixelX, pixelY];
}

export class BEVFrameRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options
   * @param {[number,number,number,number]} options.bevRange
   * @param {number} [options.gridSize=32]
   * @param {ViewWindow} [options.viewWindow] - window in grid indices
   */
  constructor(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.bevRange = options?.bevRange || [-40, 40, -40, 40];
    this.gridSize = options?.gridSize ?? 32;
    this.viewWindow = options?.viewWindow || fullWindow(this.gridSize);
  }

  setViewWindow(win) {
    this.viewWindow = win || fullWindow(this.gridSize);
  }

  setBevRange(bevRange) {
    this.bevRange = bevRange || this.bevRange;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Fill the entire canvas (useful for non-image backgrounds).
   * If you're using a base <img> underneath, you typically don't need this.
   */
  fillBackground(color) {
    if (!color) return;
    this.ctx.save();
    this.ctx.globalAlpha = 1.0;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  /**
   * Draw a pre-rendered BEV base image to exactly the same pixel space
   * used by overlays and grid.
   *
   * @param {HTMLImageElement|ImageBitmap|HTMLCanvasElement} image
   * @param {number} [alpha=1]
   */
  renderBaseImage(image, alpha = 1) {
    if (!image) return;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  renderLidarPoints(lidarPts, color = 'grey', alpha = 0.1, pointSize = 1) {
    if (!lidarPts || lidarPts.length === 0) return;

    const viewRange = windowToViewRange(this.bevRange, this.gridSize, this.viewWindow);

    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha;

    for (const pt of lidarPts) {
      const [x, y, z] = pt;
      void z;
      const [plotX, plotY] = worldToPlot(x, y, viewRange, this.canvas.width, this.canvas.height);

      // Historical convention in this repo: flip X again after worldToPlot.
      const flippedX = this.canvas.width - plotX;

      if (flippedX >= 0 && flippedX < this.canvas.width && plotY >= 0 && plotY < this.canvas.height) {
        this.ctx.fillRect(flippedX, plotY, pointSize, pointSize);
      }
    }

    this.ctx.restore();
  }

  /**
   * Render grid for the current viewWindow.
   * @param {string} color
   * @param {number} alpha
   * @param {Object} [opts]
   * @param {number} [opts.majorEvery=4]
   * @param {number} [opts.minorLineWidth=1]
   * @param {number} [opts.majorLineWidth=1.8]
   */
  renderGrid(color = 'white', alpha = 0.12, opts = {}) {
    const majorEvery = opts.majorEvery ?? 4;
    const minorLineWidth = opts.minorLineWidth ?? 1.0;
    const majorLineWidth = opts.majorLineWidth ?? 1.8;

    const winW = this.viewWindow.x1 - this.viewWindow.x0;
    const winH = this.viewWindow.y1 - this.viewWindow.y0;
    if (winW <= 0 || winH <= 0) return;

    const cellW = this.canvas.width / winW;
    const cellH = this.canvas.height / winH;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.globalAlpha = alpha;
    this.ctx.lineWidth = minorLineWidth;

    // Vertical (x) lines (X axis is flipped)
    for (let x = 0; x <= winW; x++) {
      const plotX = this.canvas.width - x * cellW;
      this.ctx.beginPath();
      this.ctx.moveTo(plotX, 0);
      this.ctx.lineTo(plotX, this.canvas.height);
      this.ctx.stroke();
    }

    // Horizontal (y) lines (Y axis is flipped)
    for (let y = 0; y <= winH; y++) {
      const plotY = this.canvas.height - y * cellH;
      this.ctx.beginPath();
      this.ctx.moveTo(0, plotY);
      this.ctx.lineTo(this.canvas.width, plotY);
      this.ctx.stroke();
    }

    // Major grid lines for easier reading
    if (majorEvery && majorEvery > 1) {
      this.ctx.globalAlpha = Math.min(0.55, alpha + 0.22);
      this.ctx.lineWidth = majorLineWidth;

      for (let x = 0; x <= winW; x += majorEvery) {
        const plotX = this.canvas.width - x * cellW;
        this.ctx.beginPath();
        this.ctx.moveTo(plotX, 0);
        this.ctx.lineTo(plotX, this.canvas.height);
        this.ctx.stroke();
      }
      for (let y = 0; y <= winH; y += majorEvery) {
        const plotY = this.canvas.height - y * cellH;
        this.ctx.beginPath();
        this.ctx.moveTo(0, plotY);
        this.ctx.lineTo(this.canvas.width, plotY);
        this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }

  renderSelectedCell(xIdx, yIdx, color = '#ff2d2d') {
    if (xIdx === null || yIdx === null || xIdx === undefined || yIdx === undefined) return;

    const winW = this.viewWindow.x1 - this.viewWindow.x0;
    const winH = this.viewWindow.y1 - this.viewWindow.y0;
    if (winW <= 0 || winH <= 0) return;

    if (
      xIdx < this.viewWindow.x0 ||
      xIdx >= this.viewWindow.x1 ||
      yIdx < this.viewWindow.y0 ||
      yIdx >= this.viewWindow.y1
    ) {
      return;
    }

    const localX = xIdx - this.viewWindow.x0;
    const localY = yIdx - this.viewWindow.y0;

    const cellW = this.canvas.width / winW;
    const cellH = this.canvas.height / winH;

    const plotX = this.canvas.width - (localX + 1) * cellW;
    const plotY = this.canvas.height - (localY + 1) * cellH;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 3;
    this.ctx.globalAlpha = 0.9;
    this.ctx.strokeRect(plotX + 1, plotY + 1, cellW - 2, cellH - 2);

    this.ctx.globalAlpha = 0.12;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(plotX, plotY, cellW, cellH);
    this.ctx.restore();
  }

  /**
   * Render multi-region overlays by blending colors per-cell.
   *
   * @param {RegionOverlay[]} regions
   * @param {Object} [opts]
   * @param {number} [opts.skipBelow=0.01]
   */
  renderRegions(regions, opts = {}) {
    if (!regions || regions.length === 0) return;
    const skipBelow = opts.skipBelow ?? 0.01;

    const winW = this.viewWindow.x1 - this.viewWindow.x0;
    const winH = this.viewWindow.y1 - this.viewWindow.y0;
    if (winW <= 0 || winH <= 0) return;

    const cellW = this.canvas.width / winW;
    const cellH = this.canvas.height / winH;

    // Precompute min/max per region (on full map; close enough and avoids per-window edge cases)
    const stats = regions.map((r) => {
      const m = r?.bevMap;
      if (!m || m.length === 0) return { min: 0, max: 0, color: colorToRgb(r.color), alpha: r.alpha ?? 0.7 };
      let min = Infinity;
      let max = -Infinity;
      for (let y = 0; y < m.length; y++) {
        const row = m[y];
        for (let x = 0; x < row.length; x++) {
          const v = row[x];
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 0, color: colorToRgb(r.color), alpha: r.alpha ?? 0.7 };
      return { min, max, color: colorToRgb(r.color), alpha: r.alpha ?? 0.7 };
    });

    this.ctx.save();

    for (let localY = 0; localY < winH; localY++) {
      const y = this.viewWindow.y0 + localY;

      for (let localX = 0; localX < winW; localX++) {
        const x = this.viewWindow.x0 + localX;

        let accR = 0;
        let accG = 0;
        let accB = 0;
        let accA = 0;

        for (let i = 0; i < regions.length; i++) {
          const r = regions[i];
          const m = r?.bevMap;
          if (!m || !m[y] || m[y][x] === undefined) continue;

          const { min, max, color, alpha } = stats[i];
          const range = max - min;
          if (range === 0) continue;

          const v = m[y][x];
          const norm = (v - min) / range;
          if (norm <= skipBelow) continue;

          const a = clamp01(norm * alpha);
          accR += color[0] * a;
          accG += color[1] * a;
          accB += color[2] * a;
          accA = clamp01(accA + a);
        }

        if (accA <= 0) continue;

        const plotX = this.canvas.width - (localX + 1) * cellW;
        const plotY = this.canvas.height - (localY + 1) * cellH;

        this.ctx.globalAlpha = accA;
        this.ctx.fillStyle = rgbToCss([accR / accA, accG / accA, accB / accA]);
        this.ctx.fillRect(plotX, plotY, cellW, cellH);
      }
    }

    this.ctx.restore();
  }
}
