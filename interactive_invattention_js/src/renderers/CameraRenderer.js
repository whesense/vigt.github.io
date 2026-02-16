/**
 * Camera image renderer with patch grid and region overlays
 */

export class CameraRenderer {
    /**
     * @param {HTMLCanvasElement} canvas - Canvas element to render to
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }
    
    /**
     * Clear the canvas
     */
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    /**
     * Render camera image
     * 
     * @param {Image} image - Image object to render
     * @param {number} scaleX - X scale factor (default: 1)
     * @param {number} scaleY - Y scale factor (default: 1)
     */
    renderImage(image, scaleX = 1, scaleY = 1) {
        if (!image) return;

        // Prefer natural dimensions (robust for `new Image()` not in DOM).
        const iw = image.naturalWidth || image.width || 0;
        const ih = image.naturalHeight || image.height || 0;
        if (!iw || !ih) return;

        const width = iw * scaleX;
        const height = ih * scaleY;
        
        // Resize canvas to fit image
        this.canvas.width = width;
        this.canvas.height = height;
        
        this.ctx.drawImage(image, 0, 0, width, height);
    }
    
    /**
     * Render patch grid
     * 
     * @param {Object} patchInfo - PatchInfo object
     * @param {number} patchSize - Patch size in pixels
     * @param {string} color - Grid color (default: 'cyan')
     * @param {number} alpha - Transparency (default: 0.3)
     */
    renderPatchGrid(patchInfo, patchSize, color = 'cyan', alpha = 0.3) {
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.globalAlpha = alpha;
        this.ctx.lineWidth = 0.5;
        
        const { patchH, patchW, wScale, hScale } = patchInfo;
        const scaledPatchW = patchSize * wScale;
        const scaledPatchH = patchSize * hScale;
        
        // Vertical lines
        for (let px = 0; px <= patchW; px++) {
            const x = px * scaledPatchW;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Horizontal lines
        for (let py = 0; py <= patchH; py++) {
            const y = py * scaledPatchH;
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
        
        this.ctx.restore();
    }
    
    /**
     * Highlight specific patches
     * 
     * @param {Array<number>} patchIndices - Global patch indices to highlight
     * @param {Object} patchInfo - PatchInfo object
     * @param {number} patchSize - Patch size in pixels
     * @param {string} color - Highlight color (default: 'red')
     * @param {number} alpha - Transparency (default: 0.4)
     */
    highlightPatches(patchIndices, patchInfo, patchSize, color = 'red', alpha = 0.4) {
        if (!patchIndices || patchIndices.length === 0) return;
        
        this.ctx.save();
        this.ctx.fillStyle = color;
        this.ctx.globalAlpha = alpha;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;
        
        const { startIdx, nPatches, patchW, wScale, hScale } = patchInfo;
        const scaledPatchW = patchSize * wScale;
        const scaledPatchH = patchSize * hScale;
        
        patchIndices.forEach(globalIdx => {
            // Check if patch belongs to this camera
            if (globalIdx >= startIdx && globalIdx < startIdx + nPatches) {
                const localIdx = globalIdx - startIdx;
                const py = Math.floor(localIdx / patchW);
                const px = localIdx % patchW;
                
                const x = px * scaledPatchW;
                const y = py * scaledPatchH;
                
                // Draw filled rectangle
                this.ctx.fillRect(x, y, scaledPatchW, scaledPatchH);
                this.ctx.strokeRect(x, y, scaledPatchW, scaledPatchH);
            }
        });
        
        this.ctx.restore();
    }
    
    /**
     * Draw region boundaries (rectangles)
     * 
     * @param {Array<Object>} regions - Array of {xRange, yRange, color}
     * @param {string} defaultColor - Default color for regions without color
     */
    renderRegionBoundaries(regions, defaultColor = 'yellow') {
        if (!regions || regions.length === 0) return;
        
        this.ctx.save();
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        
        regions.forEach(({ xRange, yRange, color = defaultColor }) => {
            const [x1, x2] = xRange;
            const [y1, y2] = yRange;
            const width = x2 - x1;
            const height = y2 - y1;
            
            this.ctx.strokeStyle = color;
            this.ctx.strokeRect(x1, y1, width, height);
        });
        
        this.ctx.restore();
    }
    
    /**
     * Render selection rectangle (for drag-to-select)
     * 
     * @param {number} x1 - Start X
     * @param {number} y1 - Start Y
     * @param {number} x2 - End X
     * @param {number} y2 - End Y
     * @param {string} color - Rectangle color (default: 'white')
     */
    renderSelectionRect(x1, y1, x2, y2, color = 'white') {
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([3, 3]);
        
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        
        this.ctx.strokeRect(x, y, width, height);
        this.ctx.restore();
    }
}
