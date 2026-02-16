/**
 * Camera View Component
 * Displays camera image with interactive region selection
 */

import { CameraRenderer } from '../renderers/CameraRenderer.js';
import { getDistinctColor } from '../utils/colorUtils.js';

export class CameraView {
    /**
     * @param {HTMLElement} container - Container element
     * @param {HTMLCanvasElement} canvas - Canvas element
     * @param {Function} onRegionAdd - Callback when region is added
     * @param {Function} onRegionDelete - Callback when region is deleted
     * @param {Object} visualizer - InverseAttentionVisualizer instance
     */
    constructor(container, canvas, onRegionAdd, onRegionDelete, visualizer = null) {
        this.container = container;
        this.canvas = canvas;
        this.onRegionAdd = onRegionAdd;
        this.onRegionDelete = onRegionDelete;
        this.visualizer = visualizer;
        
        this.renderer = new CameraRenderer(canvas);
        this.currentCamera = null;
        this.currentImage = null;
        this.currentPatchInfo = null;
        this.regions = [];
        
        // Drag selection state
        this.isDragging = false;
        this.dragStart = null;
        this.dragEnd = null;
        this.activePointerId = null;

        this.setupEventListeners();
    }
    
    /**
     * Setup event listeners for drag-to-select
     */
    setupEventListeners() {
        // Touch-first pointer interaction for drag-to-select on mobile and desktop.
        this.canvas.style.touchAction = 'none';

        this.canvas.addEventListener('pointerdown', (e) => {
            if (!this.currentImage) return;
            if (e.button !== undefined && e.button !== 0) return;

            const { x, y } = this._eventToCanvasXY(e);
            this.activePointerId = e.pointerId ?? null;
            this.isDragging = true;
            this.dragStart = { x, y };
            this.dragEnd = { x, y };
            this.canvas.setPointerCapture?.(e.pointerId);
            e.preventDefault();
            this.render();
        });

        this.canvas.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;
            if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

            const { x, y } = this._eventToCanvasXY(e);
            this.dragEnd = { x, y };
            e.preventDefault();
            this.render();
        });

        const finishDrag = (e) => {
            if (!this.isDragging) return;
            if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

            const { x, y } = this._eventToCanvasXY(e);
            this.dragEnd = { x, y };

            // Finalize selection.
            const x1 = Math.min(this.dragStart.x, this.dragEnd.x);
            const x2 = Math.max(this.dragStart.x, this.dragEnd.x);
            const y1 = Math.min(this.dragStart.y, this.dragEnd.y);
            const y2 = Math.max(this.dragStart.y, this.dragEnd.y);

            // Lower threshold to make finger drag easier on phones.
            if (Math.abs(x2 - x1) > 6 && Math.abs(y2 - y1) > 6) {
                this.addRegion([x1, x2], [y1, y2]);
            }

            this.canvas.releasePointerCapture?.(e.pointerId);
            this.isDragging = false;
            this.dragStart = null;
            this.dragEnd = null;
            this.activePointerId = null;
            e.preventDefault();
            this.render();
        };

        this.canvas.addEventListener('pointerup', finishDrag);
        this.canvas.addEventListener('pointercancel', finishDrag);
        this.canvas.addEventListener('pointerleave', (e) => {
            // Keep drag active when pointer is captured; otherwise cancel.
            if (!this.isDragging) return;
            if (this.canvas.hasPointerCapture?.(e.pointerId)) return;
            this.isDragging = false;
            this.dragStart = null;
            this.dragEnd = null;
            this.activePointerId = null;
            this.render();
        });
    }

    _eventToCanvasXY(e) {
        const rect = this.canvas.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;

        // Canvas is frequently CSS-scaled (responsive), so convert CSS pixels to canvas pixels.
        const scaleX = rect.width > 0 ? (this.canvas.width / rect.width) : 1;
        const scaleY = rect.height > 0 ? (this.canvas.height / rect.height) : 1;

        return {
            x: cssX * scaleX,
            y: cssY * scaleY
        };
    }
    
    /**
     * Set visualizer reference
     */
    setVisualizer(visualizer) {
        this.visualizer = visualizer;
    }
    
    /**
     * Set current camera and image
     */
    setCamera(camName, image, patchInfo) {
        this.currentCamera = camName;
        this.currentImage = image;
        this.currentPatchInfo = patchInfo;
        this.render();
    }
    
    /**
     * Set regions for current camera
     */
    setRegions(regions) {
        // Don't add regions here - just display them
        // The app manages the actual region list
        this.regions = regions || [];
        this.render();
    }
    
    /**
     * Add a region
     */
    addRegion(xRange, yRange) {
        // Don't assign color here - let the app handle it globally
        // Don't add to local regions - let the app manage it and call setRegions
        const region = { xRange, yRange };
        this.onRegionAdd(this.currentCamera, region);
        // Note: Don't render here - the app will call setRegions which will render
    }
    
    /**
     * Delete a region
     */
    deleteRegion(index) {
        if (index < 0 || index >= this.regions.length) return;
        // Let the app own the source of truth for regions; it will call `setRegions()`.
        this.onRegionDelete(this.currentCamera, index);
    }
    
    /**
     * Clear all regions
     */
    clearRegions() {
        this.regions = [];
        this.render();
    }
    
    /**
     * Render the camera view
     */
    render() {
        this.renderer.clear();
        
        if (!this.currentImage) {
            return;
        }
        
        // Render image
        this.renderer.renderImage(this.currentImage);
        
        // Render patch grid
        if (this.currentPatchInfo) {
            this.renderer.renderPatchGrid(
                this.currentPatchInfo,
                14, // patch size
                'cyan',
                0.3
            );
        }
        
        // Highlight patches for all regions
        if (this.currentPatchInfo && this.regions.length > 0 && this.visualizer) {
            // Collect all patch indices for all regions
            const allPatches = [];
            this.regions.forEach(region => {
                const patches = this.visualizer.getPatchIndicesForRegion(
                    this.currentCamera,
                    region.xRange,
                    region.yRange
                );
                allPatches.push(...patches);
            });
            
            // Highlight patches with region colors
            this.regions.forEach((region, idx) => {
                const patches = this.visualizer.getPatchIndicesForRegion(
                    this.currentCamera,
                    region.xRange,
                    region.yRange
                );
                this.renderer.highlightPatches(
                    patches,
                    this.currentPatchInfo,
                    14, // patch size
                    region.color,
                    0.4
                );
            });
        }
        
        // Render region boundaries
        if (this.regions.length > 0) {
            this.renderer.renderRegionBoundaries(this.regions);
        }
        
        // Render drag selection rectangle
        if (this.isDragging && this.dragStart && this.dragEnd) {
            this.renderer.renderSelectionRect(
                this.dragStart.x,
                this.dragStart.y,
                this.dragEnd.x,
                this.dragEnd.y
            );
        }
    }
    
    /**
     * Get image dimensions
     */
    getImageDimensions() {
        if (!this.currentImage) return { width: 0, height: 0 };
        const w = this.currentImage.naturalWidth || this.currentImage.width || 0;
        const h = this.currentImage.naturalHeight || this.currentImage.height || 0;
        return {
            width: w,
            height: h
        };
    }
}
