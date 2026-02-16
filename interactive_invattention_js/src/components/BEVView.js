/**
 * BEV View Component
 * Displays BEV attention heatmap
 */

import { BEVFrameRenderer } from '../../../shared/BEVFrameRenderer.js';
import { metersToCenteredWindow } from '../../../shared/BEVViewWindow.js';

export class BEVView {
    /**
     * @param {HTMLElement} container - Container element
     * @param {HTMLCanvasElement} canvas - Canvas element
     * @param {Array<number>} bevRange - BEV range [xMin, xMax, yMin, yMax]
     */
    constructor(container, canvas, bevRange = [-40, 40, -40, 40]) {
        this.container = container;
        this.canvas = canvas;
        this.bevRange = bevRange;
        this.gridSize = 32;
        
        // Default zoom for inverse: full (80x80 meters).
        this.viewWindow = metersToCenteredWindow(this.gridSize, 80, this.bevRange);
        this.renderer = new BEVFrameRenderer(canvas, {
            bevRange: this.bevRange,
            gridSize: this.gridSize,
            viewWindow: this.viewWindow
        });
        this.baseImage = null;
        this.baseImageUrl = '';
        this.baseImageLoadToken = 0;
        this.lidarPts = null;
        this.regions = []; // Array of {bevMap, color, alpha}
        
        // Set canvas size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        if ('ResizeObserver' in window) {
            this._resizeObserver = new ResizeObserver(() => this.resizeCanvas());
            const target = this.canvas.parentElement || this.container || this.canvas;
            if (target) this._resizeObserver.observe(target);
        }
    }
    
    /**
     * Resize canvas to fit container
     */
    resizeCanvas() {
        const container = this.canvas.parentElement;
        // In compact iframe embeds, use more of the available width.
        const maxSize = Math.min(container.clientWidth, 900);
        const rawSize = Math.max(360, maxSize);
        const quantStep = 4;
        const size = Math.max(360, Math.round(rawSize / quantStep) * quantStep);
        if (Math.abs(this.canvas.width - size) < quantStep && Math.abs(this.canvas.height - size) < quantStep) {
            return;
        }
        this.canvas.width = size;
        this.canvas.height = size;
        this.render();
    }

    setBaseImageUrl(url) {
        const next = url || '';
        if (next === this.baseImageUrl) return;
        this.baseImageUrl = next;
        this.baseImage = null;

        if (!next) {
            this.render();
            return;
        }

        const token = ++this.baseImageLoadToken;
        const img = new Image();
        img.onload = () => {
            if (token !== this.baseImageLoadToken) return;
            this.baseImage = img;
            this.render();
        };
        img.onerror = (err) => {
            if (token !== this.baseImageLoadToken) return;
            console.warn('Failed to load BEV base image:', next, err);
            this.baseImage = null;
            this.render();
        };
        img.src = next;
    }
    
    /**
     * Set LiDAR points
     */
    setLidarPoints(lidarPts) {
        this.lidarPts = lidarPts;
        this.render();
    }
    
    /**
     * Set regions to display
     * @param {Array<Object>} regions - Array of {bevMap, color, alpha}
     */
    setRegions(regions) {
        this.regions = regions || [];
        this.render();
    }
    
    /**
     * Clear all regions
     */
    clearRegions() {
        this.regions = [];
        this.render();
    }

    /**
     * Set BEV zoom preset in meters (e.g. 80 or 40) as a centered sub-grid.
     */
    setZoomMeters(metersSide) {
        this.viewWindow = metersToCenteredWindow(this.gridSize, metersSide, this.bevRange);
        this.renderer.setViewWindow(this.viewWindow);
        this.render();
    }
    
    /**
     * Render the BEV view
     */
    render() {
        this.renderer.clear();

        if (this.baseImage) {
            this.renderer.renderBaseImage(this.baseImage, 1.0);
        }
        
        // Render LiDAR points first (background)
        if (this.lidarPts && this.lidarPts.length > 0) {
            this.renderer.renderLidarPoints(this.lidarPts, 'grey', 0.1, 1); // 10% alpha
        }
        
        // Render multi-region overlays
        if (this.regions.length > 0) this.renderer.renderRegions(this.regions);
        
        // Render grid
        this.renderer.renderGrid('white', 0.1);
    }
}
