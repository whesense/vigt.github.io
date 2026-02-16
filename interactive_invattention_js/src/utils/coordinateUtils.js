/**
 * Coordinate transformation utilities for BEV visualization
 */

/**
 * Transform world coordinates to plot coordinates for BEV visualization.
 * 
 * Plot coordinate system:
 * - X axis = -world_Y (so LEFT camera appears on left)
 * - Y axis = world_X (forward is up)
 * 
 * @param {number} worldX - World X coordinate (meters)
 * @param {number} worldY - World Y coordinate (meters)
 * @param {Array<number>} bevRange - [xMin, xMax, yMin, yMax] in meters
 * @param {number} plotWidth - Plot width in pixels
 * @param {number} plotHeight - Plot height in pixels
 * @returns {Array<number>} [plotX, plotY] in pixels
 */
export function worldToPlot(worldX, worldY, bevRange, plotWidth, plotHeight) {
    const [xMin, xMax, yMin, yMax] = bevRange;
    
    // Transform: plotX = -worldY, plotY = worldX
    const plotWorldX = -worldY;
    const plotWorldY = worldX;
    
    // Map to plot extent: [40, -40, -40, 40] -> [left, right, bottom, top]
    const plotExtent = [40, -40, -40, 40];
    const [plotLeft, plotRight, plotBottom, plotTop] = plotExtent;
    
    // Normalize to [0, 1]
    const normX = (plotWorldX - plotLeft) / (plotRight - plotLeft);
    const normY = (plotWorldY - plotBottom) / (plotTop - plotBottom);
    
    // Map to pixel coordinates
    const pixelX = normX * plotWidth;
    const pixelY = (1 - normY) * plotHeight; // Flip Y axis (canvas coordinates)
    
    return [pixelX, pixelY];
}

/**
 * Transform plot coordinates back to world coordinates.
 * 
 * @param {number} plotX - Plot X coordinate in pixels
 * @param {number} plotY - Plot Y coordinate in pixels
 * @param {Array<number>} bevRange - [xMin, xMax, yMin, yMax] in meters
 * @param {number} plotWidth - Plot width in pixels
 * @param {number} plotHeight - Plot height in pixels
 * @returns {Array<number>} [worldX, worldY] in meters
 */
export function plotToWorld(plotX, plotY, bevRange, plotWidth, plotHeight) {
    const plotExtent = [40, -40, -40, 40];
    const [plotLeft, plotRight, plotBottom, plotTop] = plotExtent;
    
    // Normalize from pixel coordinates
    const normX = plotX / plotWidth;
    const normY = 1 - (plotY / plotHeight); // Flip Y axis
    
    // Map to plot world coordinates
    const plotWorldX = plotLeft + normX * (plotRight - plotLeft);
    const plotWorldY = plotBottom + normY * (plotTop - plotBottom);
    
    // Inverse transform: worldX = plotY, worldY = -plotX
    const worldX = plotWorldY;
    const worldY = -plotWorldX;
    
    return [worldX, worldY];
}
