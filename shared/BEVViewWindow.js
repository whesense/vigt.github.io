/**
 * BEV view-window helpers.
 *
 * We treat the model BEV grid as fixed (typically 32x32 queries).
 * A "zoom" is implemented as a centered sub-window in grid indices, scaled to fill the canvas.
 * This preserves queryIdx semantics while changing what portion of the grid is visible.
 */
 
/**
 * @typedef {{x0:number,x1:number,y0:number,y1:number}} ViewWindow
 */

/**
 * @param {number} gridSize
 * @returns {ViewWindow}
 */
export function fullWindow(gridSize) {
  return { x0: 0, x1: gridSize, y0: 0, y1: gridSize };
}

/**
 * Create a centered square window of size `windowSize` within `gridSize`.
 * @param {number} gridSize
 * @param {number} windowSize
 * @returns {ViewWindow}
 */
export function centeredWindow(gridSize, windowSize) {
  const size = Math.max(1, Math.min(gridSize, Math.floor(windowSize)));
  const start = Math.floor((gridSize - size) / 2);
  return { x0: start, x1: start + size, y0: start, y1: start + size };
}

/**
 * Convert a desired meters crop (e.g. 40m) into a centered grid window.
 * Assumes `bevRange` spans meters across the full grid.
 *
 * @param {number} gridSize
 * @param {number} metersSide - e.g. 80, 40, 20
 * @param {[number,number,number,number]} bevRange - [xMin,xMax,yMin,yMax]
 * @returns {ViewWindow}
 */
export function metersToCenteredWindow(gridSize, metersSide, bevRange) {
  const [xMin, xMax, yMin, yMax] = bevRange;
  const metersFullX = Math.abs(xMax - xMin);
  const metersFullY = Math.abs(yMax - yMin);
  // Use X span as canonical; in your data it's usually square anyway.
  const metersFull = Math.min(metersFullX, metersFullY) || metersFullX || metersFullY || metersSide;
  const ratio = metersSide / metersFull;
  const windowSize = Math.max(1, Math.round(gridSize * ratio));
  return centeredWindow(gridSize, windowSize);
}

/**
 * Derive a "viewRange" in meters from the full bevRange and a viewWindow in grid coords.
 * This is used for zoomed lidar projection (world->canvas mapping).
 *
 * @param {[number,number,number,number]} bevRange - [xMin,xMax,yMin,yMax]
 * @param {number} gridSize
 * @param {ViewWindow} win
 * @returns {[number,number,number,number]} viewRange
 */
export function windowToViewRange(bevRange, gridSize, win) {
  const [xMin, xMax, yMin, yMax] = bevRange;
  const cellW = (xMax - xMin) / gridSize;
  const cellH = (yMax - yMin) / gridSize;

  const vx0 = xMin + win.x0 * cellW;
  const vx1 = xMin + win.x1 * cellW;
  const vy0 = yMin + win.y0 * cellH;
  const vy1 = yMin + win.y1 * cellH;

  return [vx0, vx1, vy0, vy1];
}

/**
 * Map a click in canvas pixel coords to a global BEV cell selection.
 *
 * Conventions match existing apps:
 * - X increases to the left on screen (canvas X is flipped)
 * - Y increases upward on screen (canvas Y is flipped)
 *
 * @param {number} pixelX
 * @param {number} pixelY
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} gridSize
 * @param {ViewWindow} win
 * @returns {{xIdx:number,yIdx:number,queryIdx:number}|null}
 */
export function pixelToSelection(pixelX, pixelY, canvasW, canvasH, gridSize, win) {
  const winW = win.x1 - win.x0;
  const winH = win.y1 - win.y0;
  if (winW <= 0 || winH <= 0) return null;

  const cellW = canvasW / winW;
  const cellH = canvasH / winH;

  const col = Math.floor(pixelX / cellW);
  const row = Math.floor(pixelY / cellH);

  if (col < 0 || col >= winW || row < 0 || row >= winH) return null;

  // Flip axes within the window, then map back to global grid indices.
  const xIdx = win.x0 + (winW - 1 - col);
  const yIdx = win.y0 + (winH - 1 - row);
  const queryIdx = yIdx * gridSize + xIdx;

  return { xIdx, yIdx, queryIdx };
}

