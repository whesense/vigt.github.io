/**
 * Camera image renderer with attention overlay
 */

import { saturatedColormap, rgbToCss } from '../utils/colorUtils.js';

export class CameraRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }
    
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    renderImage(image) {
        if (!image) return;

        // Prefer natural dimensions (robust for `new Image()` not in DOM).
        const w = image.naturalWidth || image.width || 0;
        const h = image.naturalHeight || image.height || 0;
        if (!w || !h) return;

        // Resize canvas to match image
        this.canvas.width = w;
        this.canvas.height = h;
        this.ctx.drawImage(image, 0, 0, w, h);
    }
    
    /**
     * Render patch-aligned attention overlay.
     *
     * @param {Float32Array|Array<number>} patchAttn length = patchH*patchW
     * @param {Object} patchInfo
     * @param {Object} options
     * @param {number} options.alpha
     * @param {?number} options.globalMax If set, normalize by this max instead of per-camera max
     * @param {number} options.threshold Skip values below threshold after normalization
     * @param {string} options.colorScheme 'red' | 'hsv'
     */
    renderPatchAttentionOverlay(patchAttn, patchInfo, options = {}) {
        if (!patchAttn || patchAttn.length === 0 || !patchInfo) return;
        
        const {
            alpha = 0.6,
            globalMax = null,
            threshold = 0.0,
            colorScheme = 'red'
        } = options;
        
        const { patchW, patchH, wScale, hScale } = patchInfo;
        const expected = patchW * patchH;
        if (patchAttn.length !== expected) {
            console.warn(`Patch attention length mismatch: got ${patchAttn.length}, expected ${expected}`);
        }
        
        // Compute normalization
        let maxVal = 0;
        if (globalMax !== null && globalMax > 0) {
            maxVal = globalMax;
        } else {
            for (let i = 0; i < patchAttn.length; i++) {
                const v = patchAttn[i];
                if (v > maxVal) maxVal = v;
            }
        }
        if (maxVal <= 0) return;
        
        const patchSize = 14;
        const scaledPatchW = patchSize * wScale;
        const scaledPatchH = patchSize * hScale;
        
        this.ctx.save();
        
        for (let py = 0; py < patchH; py++) {
            for (let px = 0; px < patchW; px++) {
                const idx = py * patchW + px;
                const raw = patchAttn[idx];
                const norm = raw / maxVal;
                if (norm <= threshold) continue;
                
                // Make low values fully transparent, high values strongly visible.
                // Gamma < 1 boosts mid-range without affecting max (still 1).
                const gamma = 0.75;
                const a = alpha * Math.pow(norm, gamma);
                
                let rgb;
                if (colorScheme === 'hsv') {
                    rgb = saturatedColormap(norm);
                } else {
                    // 'red' (default): always red, varying only alpha
                    rgb = [1, 0, 0];
                }
                
                this.ctx.globalAlpha = a;
                this.ctx.fillStyle = rgbToCss(rgb);
                this.ctx.fillRect(px * scaledPatchW, py * scaledPatchH, scaledPatchW, scaledPatchH);
            }
        }
        
        this.ctx.restore();
    }
    
    renderPatchGrid(patchInfo, color = 'cyan', alpha = 0.15) {
        if (!patchInfo) return;
        const { patchH, patchW, wScale, hScale } = patchInfo;
        const patchSize = 14;
        const scaledPatchW = patchSize * wScale;
        const scaledPatchH = patchSize * hScale;
        
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.globalAlpha = alpha;
        this.ctx.lineWidth = 0.5;
        
        for (let px = 0; px <= patchW; px++) {
            const x = px * scaledPatchW;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        for (let py = 0; py <= patchH; py++) {
            const y = py * scaledPatchH;
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
        
        this.ctx.restore();
    }
}

