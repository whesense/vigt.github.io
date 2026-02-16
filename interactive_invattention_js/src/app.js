/**
 * Main Application
 * Coordinates all components and handles user interactions
 */

import { loadSceneData } from './dataLoader.js?v=2026-02-10-inv-manifest-only-v1';
import { CameraThumbStrip } from '../../shared/CameraThumbStrip.js';
import { CameraView } from './components/CameraView.js';
import { BEVView } from './components/BEVView.js';
import { Controls } from './components/Controls.js';
import { getDistinctColor } from './utils/colorUtils.js';
import { DatasetFrameDock } from '../../shared/DatasetFrameDock.js';

class App {
    static normalizeAttnPrecision(raw) {
        const v = (raw || 'auto').toString().trim().toLowerCase();
        if (v === 'int8' || v === 'int8_phs_v1') return 'int8';
        if (v === 'int4' || v === 'int4_phq_v1') return 'int4';
        if (v === 'fp32' || v === 'float32') return 'fp32';
        return 'auto';
    }

    constructor() {
        this.visualizer = null;
        this.sceneData = null;
        this.selectedCamera = null;
        this.regionsByCamera = new Map(); // Map<cameraName, Array<region>>
        this.nextRegionId = 1; // Monotonic global region id/color assignment
        this.aggregation = 'sum';
        this.headSelection = 'mean';
        
        // Initialize UI elements
        this.loadingEl = document.getElementById('loading');
        this.mainContentEl = document.getElementById('main-content');
        this.errorEl = document.getElementById('error');
        this.errorMessageEl = document.getElementById('error-message');
        this.attnPrecisionSelectEl = document.getElementById('attn-precision-select');
        
        // Initialize components
        this.cameraGallery = null;
        this.cameraView = null;
        this.bevView = null;
        this.controls = null;
        this.bevBaseImgEl = document.getElementById('bev-base-img');
        this.userBevBaseOverride = '';
        this.sceneBevBaseImage = '';
        this.sceneBevBaseImages = {};
        this.dock = null;
        
        // Setup event listeners
        this.setupEventListeners();
    }

    /**
     * Optional: set a pre-rendered BEV base image (e.g., Python-generated).
     * Pass null/empty to disable.
     */
    setBevBaseImage(src) {
        if (this.bevView && typeof this.bevView.setBaseImageUrl === 'function') {
            this.bevView.setBaseImageUrl(src || '');
        }
        // Legacy DOM layer is kept in HTML, but rendering is now canvas-native
        // to guarantee exact alignment with grid and overlays.
        if (this.bevBaseImgEl) {
            this.bevBaseImgEl.src = '';
            this.bevBaseImgEl.classList.add('hidden');
        }
    }

    setUserBevBaseOverride(src) {
        this.userBevBaseOverride = src || '';
        if (this.userBevBaseOverride) {
            this.setBevBaseImage(this.userBevBaseOverride);
        }
    }

    updateBevBaseImageForCurrentZoom() {
        if (this.userBevBaseOverride) {
            this.setBevBaseImage(this.userBevBaseOverride);
            return;
        }
        const zoomSelect = document.getElementById('bev-zoom-select');
        const zoomKey = zoomSelect ? String(parseInt(zoomSelect.value, 10)) : '';
        const sceneSrc = (zoomKey && this.sceneBevBaseImages[zoomKey]) || this.sceneBevBaseImage || '';
        this.setBevBaseImage(sceneSrc);
    }
    
    /**
     * Setup global event listeners
     */
    setupEventListeners() {
        // Add region button
        const addRegionBtn = document.getElementById('add-region-btn');
        if (addRegionBtn) {
            addRegionBtn.addEventListener('click', () => {
                this.addRegionFromInputs();
            });
        }
        
        // Clear buttons
        const clearCameraBtn = document.getElementById('clear-camera-btn');
        if (clearCameraBtn) {
            clearCameraBtn.addEventListener('click', () => {
                this.clearCurrentCamera();
            });
        }
        
        const clearAllBtn = document.getElementById('clear-all-btn');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                this.clearAllCameras();
            });
        }

        if (this.attnPrecisionSelectEl) {
            this.attnPrecisionSelectEl.addEventListener('change', (e) => {
                const selected = App.normalizeAttnPrecision(e.target.value);
                const url = new URL(window.location.href);
                url.searchParams.set('attn_precision', selected);
                window.location.href = url.toString();
            });
        }
    }
    
    /**
     * Load scene data
     */
    async loadScene(jsonPath, options = {}) {
        try {
            this.showLoading();
            this.hideError();
            
            const sceneData = await loadSceneData(jsonPath, {
                attnPrecision: options.attnPrecision || 'auto'
            });
            this.sceneData = sceneData;
            this.visualizer = sceneData.visualizer;
            this.sceneBevBaseImage = sceneData.metadata?.bev_base_image || '';
            this.sceneBevBaseImages = sceneData.metadata?.bev_base_images || {};
            
            // Initialize regions map and count existing regions
            this.nextRegionId = 1;
            let maxRegionId = 0;
            sceneData.imageNames.forEach(name => {
                const existing = this.regionsByCamera.get(name) || [];
                if (existing.length === 0) {
                    this.regionsByCamera.set(name, []);
                    return;
                }

                existing.forEach(region => {
                    const hasValidId = Number.isFinite(region?.id);
                    if (!hasValidId) {
                        region.id = this.nextRegionId++;
                    }
                    maxRegionId = Math.max(maxRegionId, region.id || 0);
                    if (!region.color) {
                        region.color = getDistinctColor((region.id || 1) - 1);
                    }
                });
            });
            if (this.nextRegionId <= maxRegionId) {
                this.nextRegionId = maxRegionId + 1;
            }
            
            // Initialize components
            console.log('Initializing UI components...');
            this.initializeComponents(sceneData);
            this.updateBevBaseImageForCurrentZoom();
            console.log('UI components initialized');
            
            // Select first camera (use display order)
            const displayOrder = sceneData.imageDisplayOrder || sceneData.imageNames;
            if (displayOrder.length > 0) {
                console.log(`Selecting first camera: ${displayOrder[0]}`);
                this.selectCamera(displayOrder[0]);
                console.log('Camera selected');
            }
            
            this.hideLoading();
            this.showMainContent();
            console.log('Scene loaded successfully!');
            
        } catch (error) {
            console.error('Error loading scene:', error);
            console.error('Error stack:', error.stack);
            this.showError(`Failed to load scene: ${error.message}`);
            this.hideLoading();
        }
    }
    
    /**
     * Initialize UI components
     */
    initializeComponents(sceneData) {
        // Use display order for gallery, but keep original order for data
        const displayOrder = sceneData.imageDisplayOrder || sceneData.imageNames;
        
        // Create mapping from display name to original index
        const nameToIndex = new Map();
        sceneData.imageNames.forEach((name, idx) => {
            nameToIndex.set(name, idx);
        });
        
        // Camera Gallery - use display order
        const stripContainer = document.getElementById('camera-strip');
        this.cameraGallery = new CameraThumbStrip(stripContainer, displayOrder, (camName) => this.selectCamera(camName), {
            thumbWidth: 240,
            thumbHeight: 160,
            alwaysPannable: true,
            maxSegments: 3
        });
        
        // Update thumbnails (use try-catch to isolate errors)
        try {
            displayOrder.forEach((name) => {
                try {
                    const origIdx = nameToIndex.get(name);
                    if (origIdx === undefined) {
                        console.warn(`Camera ${name} not found in original image names`);
                        return;
                    }
                    const image = sceneData.originalImages[origIdx];
                    this.cameraGallery.updateThumbnail(name, image, []);
                } catch (err) {
                    console.error(`Error updating thumbnail for ${name}:`, err);
                }
            });
        } catch (err) {
            console.error('Error in thumbnail update loop:', err);
        }
        
        // Camera View
        const cameraCanvas = document.getElementById('camera-canvas');
        this.cameraView = new CameraView(
            document.getElementById('camera-view'),
            cameraCanvas,
            (camName, region) => this.onRegionAdded(camName, region),
            (camName, index) => this.onRegionDeleted(camName, index),
            this.visualizer
        );
        
        // BEV View
        const bevCanvas = document.getElementById('bev-canvas');
        const bevRange = sceneData.metadata.bev_range || [-40, 40, -40, 40];
        this.bevView = new BEVView(
            document.getElementById('bev-view'),
            bevCanvas,
            bevRange
        );
        
        // Set LiDAR points
        if (sceneData.lidarPts) {
            this.bevView.setLidarPoints(sceneData.lidarPts);
        }
        
        // Controls
        const controlsContainer = document.querySelector('.bev-controls');
        this.controls = new Controls(
            controlsContainer,
            (agg) => {
                this.aggregation = agg;
                this.updateBEVView();
            },
            (head) => {
                this.headSelection = head;
                this.updateBEVView();
            },
            (meters) => {
                if (!this.bevView) return;
                this.bevView.setZoomMeters(meters);
                this.updateBevBaseImageForCurrentZoom();
            }
        );
    }
    
    /**
     * Select a camera
     */
    selectCamera(camName) {
        // Don't do anything if already selected
        if (this.selectedCamera === camName) {
            return;
        }
        
        this.selectedCamera = camName;
        
        // Update camera gallery (skip callback to avoid recursion)
        if (this.cameraGallery) {
            this.cameraGallery.selectCamera(camName, true); // Skip callback
        }
        
        // Update camera view
        if (this.cameraView && this.sceneData) {
            const camIdx = this.sceneData.imageNames.indexOf(camName);
            const image = this.sceneData.originalImages[camIdx];
            const patchInfo = this.visualizer.getCameraInfo(camName);
            const regions = this.regionsByCamera.get(camName) || [];
            
            this.cameraView.setVisualizer(this.visualizer);
            this.cameraView.setCamera(camName, image, patchInfo);
            this.cameraView.setRegions(regions);
        }
        
        // Update camera title
        const cameraNameEl = document.getElementById('camera-name');
        if (cameraNameEl) {
            cameraNameEl.textContent = camName;
        }
        
        // Update region list
        this.updateRegionList();
        
        // Update input max values
        this.updateInputMaxValues();
    }
    
    /**
     * Add region from manual inputs
     */
    addRegionFromInputs() {
        if (!this.selectedCamera) return;
        
        const x1 = parseInt(document.getElementById('x1-input').value) || 0;
        const x2 = parseInt(document.getElementById('x2-input').value) || 0;
        const y1 = parseInt(document.getElementById('y1-input').value) || 0;
        const y2 = parseInt(document.getElementById('y2-input').value) || 0;
        
        const xRange = [Math.min(x1, x2), Math.max(x1, x2)];
        const yRange = [Math.min(y1, y2), Math.max(y1, y2)];
        
        this.cameraView.addRegion(xRange, yRange);
    }
    
    /**
     * Handle region added
     */
    onRegionAdded(camName, region) {
        const regions = this.regionsByCamera.get(camName) || [];
        
        // Check for duplicates (with small tolerance for floating point)
        const tolerance = 1.0; // 1 pixel tolerance
        const isDuplicate = regions.some(r => 
            Math.abs(r.xRange[0] - region.xRange[0]) < tolerance &&
            Math.abs(r.xRange[1] - region.xRange[1]) < tolerance &&
            Math.abs(r.yRange[0] - region.yRange[0]) < tolerance &&
            Math.abs(r.yRange[1] - region.yRange[1]) < tolerance
        );
        
        if (!isDuplicate) {
            // Assign a global, monotonic region id + color.
            if (!Number.isFinite(region?.id)) {
                region.id = this.nextRegionId++;
            }
            if (!region.color) {
                region.color = getDistinctColor((region.id || 1) - 1);
            }
            
            regions.push(region);
            this.regionsByCamera.set(camName, regions);
            
            // Update camera view to show the new region
            if (this.cameraView && this.selectedCamera === camName) {
                this.cameraView.setRegions(regions);
            }
            
            this.updateRegionList();
            this.updateBEVView();
            
            // Update thumbnail for this camera
            if (this.cameraGallery && this.sceneData) {
                const camIdx = this.sceneData.imageNames.indexOf(camName);
                const image = this.sceneData.originalImages[camIdx];
                this.cameraGallery.updateThumbnail(camName, image, regions);
            }
        } else {
            console.warn('Duplicate region ignored:', region);
        }
    }
    
    /**
     * Handle region deleted
     */
    onRegionDeleted(camName, index) {
        const regions = this.regionsByCamera.get(camName) || [];
        if (index >= 0 && index < regions.length) {
            regions.splice(index, 1);
            this.regionsByCamera.set(camName, regions);

            // Update camera view to reflect the deletion
            if (this.cameraView && this.selectedCamera === camName) {
                this.cameraView.setRegions(regions);
            }
            
            this.updateRegionList();
            this.updateBEVView();
            
            // Update thumbnail
            if (this.cameraGallery && this.sceneData) {
                const camIdx = this.sceneData.imageNames.indexOf(camName);
                const image = this.sceneData.originalImages[camIdx];
                this.cameraGallery.updateThumbnail(camName, image, regions);
            }
        }
    }
    
    /**
     * Update region list UI
     */
    updateRegionList() {
        const regionsListEl = document.getElementById('regions-list');
        if (!regionsListEl) return;
        
        const regions = this.regionsByCamera.get(this.selectedCamera) || [];
        
        regionsListEl.innerHTML = '';
        
        if (regions.length === 0) {
            regionsListEl.innerHTML = '<p class="no-regions">No regions selected</p>';
            return;
        }
        
        regions.forEach((region, index) => {
            const div = document.createElement('div');
            div.className = 'region-item';
            div.style.borderLeftColor = region.color;
            const regionId = Number.isFinite(region?.id) ? region.id : (index + 1);
            
            const info = document.createElement('span');
            info.className = 'region-info';
            info.textContent = `Region ${regionId}`;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-small';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => {
                this.cameraView.deleteRegion(index);
            });
            
            div.appendChild(info);
            div.appendChild(deleteBtn);
            regionsListEl.appendChild(div);
        });
    }
    
    /**
     * Update input max values based on current image
     */
    updateInputMaxValues() {
        if (!this.cameraView) return;
        
        const dims = this.cameraView.getImageDimensions();
        const inputs = ['x1-input', 'x2-input', 'y1-input', 'y2-input'];
        inputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                if (id.startsWith('x')) {
                    input.max = dims.width;
                } else {
                    input.max = dims.height;
                }
            }
        });
    }
    
    /**
     * Update BEV view with all regions
     */
    updateBEVView() {
        if (!this.bevView || !this.visualizer) {
            console.warn('BEV view or visualizer not available');
            return;
        }
        
        // Collect all regions from all cameras
        const allRegions = [];
        
        this.regionsByCamera.forEach((regions, camName) => {
            regions.forEach(region => {
                if (!region.xRange || !region.yRange) {
                    console.warn('Invalid region:', region);
                    return;
                }
                
                try {
                    // Get patch indices for this region
                    const patches = this.visualizer.getPatchIndicesForRegion(
                        camName,
                        region.xRange,
                        region.yRange
                    );
                    
                    if (patches.length === 0) {
                        console.warn('No patches found for region:', region);
                        return;
                    }
                    
                    // Compute BEV attention map
                    const bevMap = this.visualizer.getInverseAttention(patches, {
                        meanHeads: this.headSelection === 'mean',
                        aggregation: this.aggregation
                    });
                    
                    // Ensure region has a color
                    if (!region.color) {
                        const fallbackId = Number.isFinite(region?.id) ? region.id : 1;
                        region.color = getDistinctColor(fallbackId - 1);
                    }
                    
                    allRegions.push({
                        bevMap,
                        color: region.color,
                        alpha: 0.7
                    });
                } catch (error) {
                    console.error('Error computing BEV map for region:', error, region);
                }
            });
        });
        
        console.log(`Updating BEV with ${allRegions.length} regions`);
        this.bevView.setRegions(allRegions);
    }
    
    /**
     * Clear current camera regions
     */
    clearCurrentCamera() {
        if (!this.selectedCamera) return;
        
        const regions = this.regionsByCamera.get(this.selectedCamera) || [];
        this.regionsByCamera.set(this.selectedCamera, []);
        this.cameraView.clearRegions();
        this.updateRegionList();
        this.updateBEVView();
        
        // Update thumbnail
        if (this.cameraGallery && this.sceneData) {
            const camIdx = this.sceneData.imageNames.indexOf(this.selectedCamera);
            const image = this.sceneData.originalImages[camIdx];
            this.cameraGallery.updateThumbnail(this.selectedCamera, image, []);
        }
    }
    
    /**
     * Clear all camera regions
     */
    clearAllCameras() {
        this.regionsByCamera.forEach((regions, camName) => {
            this.regionsByCamera.set(camName, []);
        });
        
        if (this.cameraView) {
            this.cameraView.clearRegions();
        }
        
        this.updateRegionList();
        this.updateBEVView();
        
        // Update all thumbnails
        if (this.cameraGallery && this.sceneData) {
            this.sceneData.imageNames.forEach((name, idx) => {
                const image = this.sceneData.originalImages[idx];
                this.cameraGallery.updateThumbnail(name, image, []);
            });
        }
    }
    
    /**
     * Show/hide loading state
     */
    showLoading() {
        if (this.loadingEl) {
            this.loadingEl.classList.remove('hidden');
        }
    }
    
    hideLoading() {
        if (this.loadingEl) {
            this.loadingEl.classList.add('hidden');
        }
    }
    
    showMainContent() {
        if (this.mainContentEl) {
            this.mainContentEl.classList.remove('hidden');
        }
        // Ensure BEV canvas resizes after content becomes visible.
        if (this.bevView && typeof this.bevView.resizeCanvas === 'function') {
            requestAnimationFrame(() => this.bevView.resizeCanvas());
        }
    }
    
    showError(message) {
        if (this.errorEl && this.errorMessageEl) {
            this.errorMessageEl.textContent = message;
            this.errorEl.classList.remove('hidden');
        }
    }
    
    hideError() {
        if (this.errorEl) {
            this.errorEl.classList.add('hidden');
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    const urlParams = new URLSearchParams(window.location.search);
    const attnPrecision = App.normalizeAttnPrecision(urlParams.get('attn_precision') || 'auto');
    if (app.attnPrecisionSelectEl) {
        app.attnPrecisionSelectEl.value = attnPrecision;
    }

    const dockContainer = document.getElementById('context-dock');
    const initDock = async () => {
        if (!dockContainer) return null;
        try {
            const dock = new DatasetFrameDock(dockContainer, { demoKey: 'attention' });
            await dock.init();
            return dock;
        } catch (err) {
            console.warn('Dataset dock init failed:', err);
            return null;
        }
    };

    (async () => {
        app.dock = await initDock();

        let scenePath = urlParams.get('scene');
        if (scenePath) {
            app.dock?.setSelectedBySceneUrl(scenePath);
        } else {
            const def = app.dock?.getDefaultSceneUrl?.() || null;
            if (def) {
                const url = new URL(window.location.href);
                url.searchParams.set('scene', def);
                window.history.replaceState({}, '', url.toString());
                scenePath = def;
                app.dock?.setSelectedBySceneUrl(def);
            }
        }

        if (!scenePath) {
            app.showError(
                'No canonical scene manifest provided. Pass ?scene=../artifacts/.../manifests/attention.scene.json or choose a scene from the dock.'
            );
            return;
        }

        const bevBase = urlParams.get('bev_base') || '';
        if (bevBase) app.setUserBevBaseOverride(new URL(bevBase, window.location.href).toString());
        app.loadScene(scenePath, { attnPrecision });
        window.app = app;
    })();
});
