/**
 * Inverse Attention Visualizer
 * 
 * Core logic for computing inverse attention: given image regions,
 * which BEV queries attend to those regions?
 * 
 * Ported from attention_viz/inverse_attention.py
 */

class PatchInfo {
    constructor(camName, camIdx, startIdx, nPatches, patchH, patchW, imgH, imgW, hScale, wScale) {
        this.camName = camName;
        this.camIdx = camIdx;
        this.startIdx = startIdx;
        this.nPatches = nPatches;
        this.patchH = patchH;
        this.patchW = patchW;
        this.imgH = imgH;
        this.imgW = imgW;
        this.hScale = hScale;
        this.wScale = wScale;
    }
}

class InverseAttentionVisualizer {
    /**
     * Initialize inverse attention visualizer.
     * 
     * @param {Array} attnWeights - Attention weights [1][H][Q][K]
     * @param {Array} cameraImages - List of camera images (scaled to patch boundaries)
     * @param {Array} cameraNames - List of camera names
     * @param {Object} options - Configuration options
     */
    constructor(attnWeights, cameraImages, cameraNames, options = {}) {
        // Handle both nested array format and flat array format (including TypedArrays)
        if (attnWeights instanceof Float32Array || attnWeights instanceof ArrayBuffer) {
            // Flat array format (TypedArray or ArrayBuffer) - store as flat and use index calculations
            if (attnWeights instanceof ArrayBuffer) {
                this.attnWeightsFlat = new Float32Array(attnWeights);
            } else {
                this.attnWeightsFlat = attnWeights;
            }
            this.attnWeightsShape = options.attnWeightsShape || [1, 8, 1024, 1645];
            this.attnWeights = null; // Will use flat access
        } else if (Array.isArray(attnWeights) && attnWeights.length > 0 && typeof attnWeights[0] === 'number') {
            // Flat array format (regular array) - convert to TypedArray for efficiency
            this.attnWeightsFlat = new Float32Array(attnWeights);
            this.attnWeightsShape = options.attnWeightsShape || [1, 8, 1024, 1645];
            this.attnWeights = null;
        } else {
            // Nested array format (legacy)
            this.attnWeights = attnWeights; // [1][H][Q][K]
            this.attnWeightsFlat = null;
            this.attnWeightsShape = null;
        }
        
        this.cameraImages = cameraImages;
        this.originalImages = options.originalImages || cameraImages;
        this.cameraNames = cameraNames;
        
        this.gridSize = options.gridSize || 32;
        this.patchSize = options.patchSize || 14;
        this.bevRange = options.bevRange || [-40, 40, -40, 40];
        this.hasClsTokens = options.hasClsTokens !== undefined ? options.hasClsTokens : true;
        
        this.nQueries = this.gridSize * this.gridSize;
        
        // Determine number of heads
        if (this.attnWeightsShape) {
            this.nHeads = this.attnWeightsShape[1]; // Second dimension
        } else {
            this.nHeads = attnWeights[0].length;
        }
        
        // Build patch info for each camera
        this._patchInfo = this._buildPatchInfo();
        this._nameToInfo = {};
        this._patchInfo.forEach(info => {
            this._nameToInfo[info.camName] = info;
        });
    }
    
    /**
     * Build mapping of cameras to their patch indices.
     * @returns {Array<PatchInfo>}
     */
    _buildPatchInfo() {
        const infos = [];
        let currentIdx = 0;
        
        // Sort cameras by name for consistency
        const cameras = this.cameraNames.map((name, idx) => ({
            name,
            idx,
            img: this.cameraImages[idx],
            origImg: this.originalImages[idx]
        })).sort((a, b) => a.name.localeCompare(b.name));
        
        cameras.forEach(({ name, idx, img, origImg }) => {
            // Get image dimensions
            let H, W;
            if (Array.isArray(img)) {
                // Nested array format [C][H][W]
                H = img[0].length;
                W = img[0][0].length;
            } else if (img instanceof Image || (img.height && img.width)) {
                // Image object (HTMLImageElement or similar)
                H = img.height;
                W = img.width;
            } else {
                throw new Error(`Unknown image format for camera ${name}`);
            }
            
            const patchH = Math.floor(H / this.patchSize);
            const patchW = Math.floor(W / this.patchSize);
            const nPatches = patchH * patchW;
            
            // Calculate scale factors
            let origH, origW;
            if (Array.isArray(origImg)) {
                origH = origImg[0].length;
                origW = origImg[0][0].length;
            } else if (origImg instanceof Image || (origImg.height && origImg.width)) {
                origH = origImg.height;
                origW = origImg.width;
            } else {
                origH = H;
                origW = W;
            }
            
            const hScale = origH / H;
            const wScale = origW / W;
            
            // Account for CLS token before this camera's patches
            if (this.hasClsTokens) {
                currentIdx += 1; // Skip CLS token
            }
            
            infos.push(new PatchInfo(
                name,
                idx,
                currentIdx,
                nPatches,
                patchH,
                patchW,
                H,
                W,
                hScale,
                wScale
            ));
            
            currentIdx += nPatches;
        });
        
        return infos;
    }
    
    /**
     * Get patch info for a camera.
     * @param {string} camName - Camera name
     * @returns {PatchInfo}
     */
    getCameraInfo(camName) {
        return this._nameToInfo[camName];
    }
    
    /**
     * Convert pixel coordinates to global patch index.
     * 
     * @param {string} camName - Camera name
     * @param {number} pixelX - Pixel X coordinate
     * @param {number} pixelY - Pixel Y coordinate
     * @returns {number} Global patch index
     */
    pixelToPatch(camName, pixelX, pixelY) {
        const info = this.getCameraInfo(camName);
        
        // Convert pixel to patch grid coordinates
        const patchX = Math.min(
            Math.floor(pixelX / info.wScale / this.patchSize),
            info.patchW - 1
        );
        const patchY = Math.min(
            Math.floor(pixelY / info.hScale / this.patchSize),
            info.patchH - 1
        );
        
        // Local patch index (row-major order)
        const localIdx = patchY * info.patchW + patchX;
        
        // Global index
        return info.startIdx + localIdx;
    }
    
    /**
     * Convert local patch index to pixel center coordinates.
     * 
     * @param {string} camName - Camera name
     * @param {number} localPatchIdx - Local patch index
     * @returns {Array<number>} [pixelX, pixelY]
     */
    patchToPixelCenter(camName, localPatchIdx) {
        const info = this.getCameraInfo(camName);
        const patchY = Math.floor(localPatchIdx / info.patchW);
        const patchX = localPatchIdx % info.patchW;
        
        const pixelX = Math.floor((patchX + 0.5) * this.patchSize);
        const pixelY = Math.floor((patchY + 0.5) * this.patchSize);
        
        return [pixelX, pixelY];
    }
    
    /**
     * Get global patch indices for a rectangular region.
     * 
     * @param {string} camName - Camera name
     * @param {Array<number>} xRange - [xMin, xMax] pixel range (inclusive)
     * @param {Array<number>} yRange - [yMin, yMax] pixel range (inclusive)
     * @returns {Array<number>} List of global patch indices
     */
    getPatchIndicesForRegion(camName, xRange = null, yRange = null) {
        const info = this.getCameraInfo(camName);
        
        // Default to full image
        if (xRange === null) {
            xRange = [0, Math.floor(info.imgW * info.wScale) - 1];
        }
        if (yRange === null) {
            yRange = [0, Math.floor(info.imgH * info.hScale) - 1];
        }
        
        // Convert pixels to patches (inclusive range)
        const patchXMin = Math.max(0, Math.floor(xRange[0] / info.wScale / this.patchSize));
        const patchXMax = Math.min(info.patchW - 1, Math.floor(xRange[1] / info.wScale / this.patchSize));
        const patchYMin = Math.max(0, Math.floor(yRange[0] / info.hScale / this.patchSize));
        const patchYMax = Math.min(info.patchH - 1, Math.floor(yRange[1] / info.hScale / this.patchSize));
        
        const indices = [];
        for (let py = patchYMin; py <= patchYMax; py++) {
            for (let px = patchXMin; px <= patchXMax; px++) {
                const localIdx = py * info.patchW + px;
                const globalIdx = info.startIdx + localIdx;
                indices.push(globalIdx);
            }
        }
        
        return indices;
    }
    
    /**
     * Get all patch indices for a camera.
     * @param {string} camName - Camera name
     * @returns {Array<number>} List of global patch indices
     */
    getAllPatchesForCamera(camName) {
        const info = this.getCameraInfo(camName);
        const indices = [];
        for (let i = 0; i < info.nPatches; i++) {
            indices.push(info.startIdx + i);
        }
        return indices;
    }
    
    /**
     * Get BEV attention map for selected patches.
     * 
     * @param {Array<number>} patchIndices - List of global patch indices
     * @param {Object} options - Computation options
     * @param {boolean} options.meanHeads - Average over attention heads (default: true)
     * @param {number} options.headIdx - Specific head index (ignored if meanHeads=true)
     * @param {string} options.aggregation - How to combine attention: 'sum', 'max', or 'mean' (default: 'sum')
     * @returns {Array<Array<number>>} BEV attention map [gridSize][gridSize]
     */
    getInverseAttention(patchIndices, options = {}) {
        const {
            meanHeads = true,
            headIdx = null,
            aggregation = 'sum'
        } = options;
        
        let patchAttn;
        
        if (this.attnWeightsFlat) {
            // Use flat array format - avoid creating nested structures
            const Q = this.nQueries;
            const H = this.nHeads;
            
            if (meanHeads) {
                // Average over heads and extract patches
                patchAttn = [];
                for (let q = 0; q < Q; q++) {
                    const qAttn = [];
                    for (const kIdx of patchIndices) {
                        let sum = 0;
                        for (let h = 0; h < H; h++) {
                            sum += this._getAttnFlat(0, h, q, kIdx);
                        }
                        qAttn.push(sum / H);
                    }
                    patchAttn.push(qAttn);
                }
            } else if (headIdx !== null) {
                // Select specific head
                patchAttn = [];
                for (let q = 0; q < Q; q++) {
                    const qAttn = [];
                    for (const kIdx of patchIndices) {
                        qAttn.push(this._getAttnFlat(0, headIdx, q, kIdx));
                    }
                    patchAttn.push(qAttn);
                }
            } else {
                throw new Error("Specify headIdx or set meanHeads=true");
            }
        } else {
            // Nested array format (legacy)
            // Get attention: [1][H][Q][K] -> work with [H][Q][K]
            let attn = this.attnWeights[0];
            
            if (meanHeads) {
                // Average over heads: [H][Q][K] -> [Q][K]
                attn = this._meanOverHeads(attn);
            } else if (headIdx !== null) {
                // Select specific head: [H][Q][K] -> [Q][K]
                attn = attn[headIdx];
            } else {
                throw new Error("Specify headIdx or set meanHeads=true");
            }
            
            // Select patches: For each query Q, get attention to selected patches
            // attn is [Q][K], we want [Q][len(patchIndices)]
            patchAttn = attn.map(qAttn => {
                return patchIndices.map(kIdx => qAttn[kIdx]);
            });
        }
        
        // Aggregate across patches
        let bevAttn;
        if (aggregation === 'sum') {
            bevAttn = patchAttn.map(qAttn => {
                return qAttn.reduce((sum, val) => sum + val, 0);
            });
        } else if (aggregation === 'max') {
            bevAttn = patchAttn.map(qAttn => {
                return Math.max(...qAttn);
            });
        } else if (aggregation === 'mean') {
            bevAttn = patchAttn.map(qAttn => {
                const sum = qAttn.reduce((sum, val) => sum + val, 0);
                return sum / qAttn.length;
            });
        } else {
            throw new Error(`Unknown aggregation: ${aggregation}`);
        }
        
        // Reshape to BEV grid
        const bevMap = [];
        for (let y = 0; y < this.gridSize; y++) {
            const row = [];
            for (let x = 0; x < this.gridSize; x++) {
                const qIdx = y * this.gridSize + x;
                row.push(bevAttn[qIdx]);
            }
            bevMap.push(row);
        }
        
        return bevMap;
    }
    
    /**
     * Get attention value using flat array index
     * @private
     */
    _getAttnFlat(b, h, q, k) {
        if (!this.attnWeightsFlat || !this.attnWeightsShape) {
            throw new Error('Flat array format not available');
        }
        const [d1, d2, d3, d4] = this.attnWeightsShape;
        const idx = b * d2 * d3 * d4 + h * d3 * d4 + q * d4 + k;
        return this.attnWeightsFlat[idx];
    }
    
    /**
     * Average attention over heads.
     * @private
     */
    _meanOverHeads(attn) {
        if (this.attnWeightsFlat) {
            // Use flat array format
            const Q = this.nQueries;
            const K = this.attnWeightsShape[3];
            const H = this.nHeads;
            
            const mean = [];
            for (let q = 0; q < Q; q++) {
                const row = [];
                for (let k = 0; k < K; k++) {
                    let sum = 0;
                    for (let h = 0; h < H; h++) {
                        sum += this._getAttnFlat(0, h, q, k);
                    }
                    row.push(sum / H);
                }
                mean.push(row);
            }
            return mean;
        } else {
            // Nested array format
            // attn is [H][Q][K]
            const H = attn.length;
            const Q = attn[0].length;
            const K = attn[0][0].length;
            
            const mean = [];
            for (let q = 0; q < Q; q++) {
                const row = [];
                for (let k = 0; k < K; k++) {
                    let sum = 0;
                    for (let h = 0; h < H; h++) {
                        sum += attn[h][q][k];
                    }
                    row.push(sum / H);
                }
                mean.push(row);
            }
            return mean;
        }
    }
    
    /**
     * Get BEV attention maps for each camera separately.
     * 
     * @param {Object} options - Computation options
     * @returns {Object} Dictionary mapping camera name to BEV attention map
     */
    getInverseAttentionPerCamera(options = {}) {
        const result = {};
        this.cameraNames.forEach(camName => {
            const patches = this.getAllPatchesForCamera(camName);
            result[camName] = this.getInverseAttention(patches, options);
        });
        return result;
    }
    
    /**
     * Convert query index to BEV world coordinates.
     * 
     * @param {number} queryIdx - Query index (0 to nQueries-1)
     * @returns {Array<number>} [x, y] world coordinates in meters
     */
    queryIdxToBevCoords(queryIdx) {
        const qy = Math.floor(queryIdx / this.gridSize);
        const qx = queryIdx % this.gridSize;
        
        const cellW = (this.bevRange[1] - this.bevRange[0]) / this.gridSize;
        const cellH = (this.bevRange[3] - this.bevRange[2]) / this.gridSize;
        
        const x = this.bevRange[0] + (qx + 0.5) * cellW;
        const y = this.bevRange[2] + (qy + 0.5) * cellH;
        
        return [x, y];
    }
}

// Export for ES6 modules
export { InverseAttentionVisualizer, PatchInfo };
