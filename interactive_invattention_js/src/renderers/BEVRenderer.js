/**
 * BEV (Bird's Eye View) renderer for attention heatmaps
 */

import { colorToRgb, blendColors, rgbToCss } from '../utils/colorUtils.js';
import { worldToPlot } from '../utils/coordinateUtils.js';

export class BEVRenderer {
    /**
     * @param {HTMLCanvasElement} canvas - Canvas element to render to
     * @param {Array<number>} bevRange - [xMin, xMax, yMin, yMax] in meters
     */
    constructor(canvas, bevRange = [-40, 40, -40, 40]) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.bevRange = bevRange;
        this.gridSize = 32;
    }
    
    /**
     * Clear the canvas
     * Also invalidates lidar cache if canvas size changed
     */
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // Invalidate lidar cache if canvas size changed
        if (this.lidarImageData && 
            (this.lidarImageData.width !== this.canvas.width || 
             this.lidarImageData.height !== this.canvas.height)) {
            this.lidarImageData = null;
            this.lastLidarPts = null;
        }
    }
    
    /**
     * Render LiDAR point cloud
     * Flips X axis, Y axis is already correct from worldToPlot
     * Renders fresh each time to avoid alpha accumulation issues
     * 
     * @param {Array<Array<number>>} lidarPts - Array of [x, y, z] points
     * @param {string} color - Point color (default: 'grey')
     * @param {number} alpha - Transparency (default: 0.1)
     * @param {number} pointSize - Point size in pixels (default: 1)
     */
    renderLidarPoints(lidarPts, color = 'grey', alpha = 0.1, pointSize = 1) {
        if (!lidarPts || lidarPts.length === 0) return;
        
        this.ctx.save();
        this.ctx.fillStyle = color;
        this.ctx.globalAlpha = alpha; // Use actual alpha for transparency
        
        lidarPts.forEach(pt => {
            const [x, y, z] = pt;
            const [plotX, plotY] = worldToPlot(
                x, y,
                this.bevRange,
                this.canvas.width,
                this.canvas.height
            );
            
            // Flip X axis for lidar (Y axis is already correct from worldToPlot)
            const flippedX = this.canvas.width - plotX;
            
            // Only render if within canvas bounds
            if (flippedX >= 0 && flippedX < this.canvas.width &&
                plotY >= 0 && plotY < this.canvas.height) {
                this.ctx.fillRect(flippedX, plotY, pointSize, pointSize);
            }
        });
        
        this.ctx.restore();
    }
    
    /**
     * Render attention heatmap
     * Only renders cells with significant attention to avoid black areas
     * 
     * @param {Array<Array<number>>} bevMap - BEV attention map [gridSize][gridSize]
     * @param {string} colormap - Colormap name (default: 'hot')
     * @param {number} alpha - Transparency (default: 0.8)
     */
    renderAttentionHeatmap(bevMap, colormap = 'hot', alpha = 0.8) {
        if (!bevMap || bevMap.length === 0) return;
        
        const gridSize = bevMap.length;
        const cellWidth = this.canvas.width / gridSize;
        const cellHeight = this.canvas.height / gridSize;
        
        // Normalize attention values
        let min = Infinity;
        let max = -Infinity;
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const val = bevMap[y][x];
                min = Math.min(min, val);
                max = Math.max(max, val);
            }
        }
        
        const range = max - min;
        if (range === 0) return; // No variation
        
        // Render cells - only where there's significant attention
        this.ctx.save();
        
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const val = bevMap[y][x];
                const normalized = (val - min) / range;
                
                // Skip cells with very low attention to avoid black areas
                if (normalized <= 0.01) continue;
                
                // Get color
                let color;
                if (colormap === 'hot') {
                    color = this._hotColormap(normalized);
                } else {
                    // Default to grayscale
                    color = [normalized, normalized, normalized];
                }
                
                // Map to plot coordinates (flip X axis, flip Y axis)
                const plotX = this.canvas.width - (x + 1) * cellWidth;
                const plotY = this.canvas.height - (y + 1) * cellHeight;
                
                // Draw cell with alpha blending
                this.ctx.globalAlpha = alpha * normalized; // Scale alpha by attention strength
                this.ctx.fillStyle = rgbToCss(color);
                this.ctx.fillRect(plotX, plotY, cellWidth, cellHeight);
            }
        }
        
        this.ctx.restore();
    }
    
    /**
     * Render multiple attention maps with different colors (RGB blending)
     * Preserves existing canvas content (e.g., lidar points) and only overlays attention
     * 
     * @param {Array<Object>} regions - Array of {bevMap, color, alpha}
     */
    renderMultipleRegions(regions) {
        if (!regions || regions.length === 0) return;
        
        const gridSize = this.gridSize;
        const cellWidth = this.canvas.width / gridSize;
        const cellHeight = this.canvas.height / gridSize;
        
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Get current canvas content (preserves lidar points) - read BEFORE processing
        const currentImageData = this.ctx.getImageData(0, 0, width, height);
        
        // Build RGB accumulation buffer for attention overlays only
        const attentionAccum = new Float32Array(width * height * 3); // R, G, B channels
        const attentionAlpha = new Float32Array(width * height); // Alpha accumulation
        
        // Process each region and accumulate attention colors
        regions.forEach(({ bevMap, color, alpha = 0.7 }) => {
            let min = Infinity;
            let max = -Infinity;
            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    const val = bevMap[y][x];
                    min = Math.min(min, val);
                    max = Math.max(max, val);
                }
            }
            
            const range = max - min;
            if (range === 0) return; // Skip if no variation
            
            const colorRgb = colorToRgb(color);
            
            // Accumulate colors for each cell
            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    const val = bevMap[y][x];
                    const normalized = (val - min) / range;
                    
                    // Only add attention where there's actual attention (no black areas)
                    if (normalized > 0.01) {
                        const plotX = Math.floor(this.canvas.width - (x + 1) * cellWidth);
                        const plotY = Math.floor(this.canvas.height - (y + 1) * cellHeight);
                        
                        // Accumulate color for all pixels in this cell
                        for (let py = 0; py < cellHeight && plotY + py < height && plotY + py >= 0; py++) {
                            for (let px = 0; px < cellWidth && plotX + px < width && plotX + px >= 0; px++) {
                                const pixelIdx = (plotY + py) * width + (plotX + px);
                                const rgbIdx = pixelIdx * 3;
                                const cellAlpha = normalized * alpha;
                                
                                // Accumulate attention colors
                                attentionAccum[rgbIdx] += colorRgb[0] * cellAlpha;
                                attentionAccum[rgbIdx + 1] += colorRgb[1] * cellAlpha;
                                attentionAccum[rgbIdx + 2] += colorRgb[2] * cellAlpha;
                                
                                // Track total alpha for proper blending
                                attentionAlpha[pixelIdx] = Math.min(1.0, attentionAlpha[pixelIdx] + cellAlpha);
                            }
                        }
                    }
                }
            }
        });
        
        // Blend attention overlays with existing canvas content
        const imageData = this.ctx.createImageData(width, height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            const rgbIdx = i * 3;
            
            // Get background color from current canvas (lidar, etc.)
            const bgR = currentImageData.data[idx] / 255.0;
            const bgG = currentImageData.data[idx + 1] / 255.0;
            const bgB = currentImageData.data[idx + 2] / 255.0;
            
            // Get attention overlay color
            const attnAlpha = attentionAlpha[i];
            
            if (attnAlpha > 0) {
                // Normalize accumulated attention colors by total alpha
                const attnR = attentionAccum[rgbIdx] / attnAlpha;
                const attnG = attentionAccum[rgbIdx + 1] / attnAlpha;
                const attnB = attentionAccum[rgbIdx + 2] / attnAlpha;
                
                // Alpha blend: result = background * (1 - alpha) + overlay * alpha
                const finalR = bgR * (1 - attnAlpha) + attnR * attnAlpha;
                const finalG = bgG * (1 - attnAlpha) + attnG * attnAlpha;
                const finalB = bgB * (1 - attnAlpha) + attnB * attnAlpha;
                
                imageData.data[idx] = Math.min(255, Math.max(0, finalR * 255));
                imageData.data[idx + 1] = Math.min(255, Math.max(0, finalG * 255));
                imageData.data[idx + 2] = Math.min(255, Math.max(0, finalB * 255));
            } else {
                // No attention - preserve background
                imageData.data[idx] = currentImageData.data[idx];
                imageData.data[idx + 1] = currentImageData.data[idx + 1];
                imageData.data[idx + 2] = currentImageData.data[idx + 2];
            }
            
            imageData.data[idx + 3] = 255; // Full opacity
        }
        
        this.ctx.putImageData(imageData, 0, 0);
    }
    
    /**
     * Render grid lines
     * 
     * @param {string} color - Grid color (default: 'white')
     * @param {number} alpha - Transparency (default: 0.1)
     */
    renderGrid(color = 'white', alpha = 0.1) {
        const gridSize = this.gridSize;
        const cellWidth = this.canvas.width / gridSize;
        const cellHeight = this.canvas.height / gridSize;
        
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.globalAlpha = alpha;
        this.ctx.lineWidth = 0.5;
        
        // Vertical lines
        for (let x = 0; x <= gridSize; x++) {
            const plotX = this.canvas.width - x * cellWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(plotX, 0);
            this.ctx.lineTo(plotX, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Horizontal lines
        for (let y = 0; y <= gridSize; y++) {
            const plotY = y * cellHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(0, plotY);
            this.ctx.lineTo(this.canvas.width, plotY);
            this.ctx.stroke();
        }
        
        this.ctx.restore();
    }
    
    /**
     * Render axes labels and title
     * 
     * @param {string} title - Plot title
     */
    renderLabels(title = 'BEV Attention Map') {
        this.ctx.save();
        this.ctx.fillStyle = 'black';
        this.ctx.font = '14px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';
        
        // Title
        this.ctx.fillText(title, this.canvas.width / 2, 10);
        
        // X axis label
        this.ctx.textBaseline = 'bottom';
        this.ctx.fillText('-Y (m)', this.canvas.width / 2, this.canvas.height - 10);
        
        // Y axis label
        this.ctx.save();
        this.ctx.translate(20, this.canvas.height / 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('X (m)', 0, 0);
        this.ctx.restore();
        
        this.ctx.restore();
    }
    
    /**
     * Hot colormap helper
     * @private
     */
    _hotColormap(value) {
        value = Math.max(0, Math.min(1, value));
        
        let r, g, b;
        if (value < 0.33) {
            r = value * 3;
            g = 0;
            b = 0;
        } else if (value < 0.66) {
            r = 1;
            g = (value - 0.33) * 3;
            b = 0;
        } else {
            r = 1;
            g = 1;
            b = (value - 0.66) * 3;
        }
        
        return [r, g, b];
    }
}
