/**
 * Forward Attention Visualizer
 *
 * Forward attention: BEV query -> image patches (where does this query look?)
 *
 * Implementation notes:
 * - Attention weights are expected as [1, H, Q, K]
 * - K is the concatenation of tokens from all cameras, with optional CLS token
 *   inserted before each camera's patch block.
 * - Cameras are indexed for token layout in lexicographic camera-name order,
 *   matching the Python utilities and the existing inverse-attention app.
 */

class PatchInfo {
    constructor(camName, camIdx, startIdx, nPatches, patchH, patchW, imgH, imgW, hScale, wScale) {
        this.camName = camName;
        this.camIdx = camIdx;     // original image index in arrays passed to loader
        this.startIdx = startIdx; // global K index (points at first patch token, after CLS if present)
        this.nPatches = nPatches;
        this.patchH = patchH;
        this.patchW = patchW;
        this.imgH = imgH;
        this.imgW = imgW;
        this.hScale = hScale;
        this.wScale = wScale;
    }
}

class ForwardAttentionVisualizer {
    /**
     * @param {Array|Float32Array|ArrayBuffer} attnWeights Attention weights [1][H][Q][K] or flat
     * @param {Array} cameraImages Scaled images (patch-aligned sizing)
     * @param {Array<string>} cameraNames Camera names
     * @param {Object} options
     */
    constructor(attnWeights, cameraImages, cameraNames, options = {}) {
        // Handle both nested array format and flat array format (including TypedArrays)
        if (attnWeights instanceof Float32Array || attnWeights instanceof ArrayBuffer) {
            if (attnWeights instanceof ArrayBuffer) {
                this.attnWeightsFlat = new Float32Array(attnWeights);
            } else {
                this.attnWeightsFlat = attnWeights;
            }
            this.attnWeightsShape = options.attnWeightsShape || [1, 8, 1024, 0];
            this.attnWeights = null;
        } else if (Array.isArray(attnWeights) && attnWeights.length > 0 && typeof attnWeights[0] === 'number') {
            this.attnWeightsFlat = new Float32Array(attnWeights);
            this.attnWeightsShape = options.attnWeightsShape || [1, 8, 1024, 0];
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
        
        if (this.attnWeightsShape) {
            this.nHeads = this.attnWeightsShape[1];
            this.kSize = this.attnWeightsShape[3];
        } else {
            this.nHeads = attnWeights[0].length;
            this.kSize = attnWeights[0][0][0].length;
        }
        
        this._patchInfo = this._buildPatchInfo();
        this._nameToInfo = {};
        this._patchInfo.forEach(info => {
            this._nameToInfo[info.camName] = info;
        });
    }
    
    getNumHeads() {
        return this.nHeads;
    }
    
    getCameraInfo(camName) {
        return this._nameToInfo[camName];
    }
    
    /**
     * Build mapping of cameras to their patch indices.
     * Cameras are ordered by name for token layout.
     */
    _buildPatchInfo() {
        const infos = [];
        let currentIdx = 0;
        
        const cameras = this.cameraNames.map((name, idx) => ({
            name,
            idx,
            img: this.cameraImages[idx],
            origImg: this.originalImages[idx]
        })).sort((a, b) => a.name.localeCompare(b.name));
        
        cameras.forEach(({ name, idx, img, origImg }) => {
            let H, W;
            if (img instanceof Image || img) {
                // Prefer natural dimensions (robust for `new Image()` not in DOM).
                H = img.naturalHeight || img.height || 0;
                W = img.naturalWidth || img.width || 0;
            } else if (Array.isArray(img)) {
                H = img[0].length;
                W = img[0][0].length;
            } else {
                throw new Error(`Unknown image format for camera ${name}`);
            }

            if (!H || !W) {
                throw new Error(`Camera image has zero size for ${name} (not loaded/decoded yet)`);
            }
            
            const patchH = Math.floor(H / this.patchSize);
            const patchW = Math.floor(W / this.patchSize);
            const nPatches = patchH * patchW;
            
            let origH, origW;
            if (origImg instanceof Image || origImg) {
                origH = origImg.naturalHeight || origImg.height || 0;
                origW = origImg.naturalWidth || origImg.width || 0;
            } else if (Array.isArray(origImg)) {
                origH = origImg[0].length;
                origW = origImg[0][0].length;
            } else {
                origH = H;
                origW = W;
            }
            
            const hScale = origH / H;
            const wScale = origW / W;
            
            if (this.hasClsTokens) {
                currentIdx += 1;
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
    
    _getAttnFlat(b, h, q, k) {
        if (!this.attnWeightsFlat || !this.attnWeightsShape) {
            throw new Error('Flat array format not available');
        }
        const [d1, d2, d3, d4] = this.attnWeightsShape;
        void (d1);
        const idx = b * d2 * d3 * d4 + h * d3 * d4 + q * d4 + k;
        return this.attnWeightsFlat[idx];
    }
    
    /**
     * Return per-patch attention for a given camera for a selected BEV query.
     *
     * @param {number} queryIdx
     * @param {string} camName
     * @param {Object} options
     * @param {boolean} options.meanHeads
     * @param {?number} options.headIdx
     * @returns {Float32Array} length = nPatches for that camera
     */
    getCameraPatchAttentionForQuery(queryIdx, camName, options = {}) {
        const { meanHeads = true, headIdx = null } = options;
        const info = this.getCameraInfo(camName);
        if (!info) throw new Error(`Unknown camera: ${camName}`);
        
        const out = new Float32Array(info.nPatches);
        
        if (this.attnWeightsFlat) {
            const H = this.nHeads;
            for (let i = 0; i < info.nPatches; i++) {
                const kIdx = info.startIdx + i;
                if (meanHeads) {
                    let sum = 0;
                    for (let h = 0; h < H; h++) {
                        sum += this._getAttnFlat(0, h, queryIdx, kIdx);
                    }
                    out[i] = sum / H;
                } else if (headIdx !== null) {
                    out[i] = this._getAttnFlat(0, headIdx, queryIdx, kIdx);
                } else {
                    throw new Error('Specify headIdx or set meanHeads=true');
                }
            }
            return out;
        }
        
        // Nested array fallback
        const attn = this.attnWeights[0];
        if (meanHeads) {
            for (let i = 0; i < info.nPatches; i++) {
                const kIdx = info.startIdx + i;
                let sum = 0;
                for (let h = 0; h < this.nHeads; h++) {
                    sum += attn[h][queryIdx][kIdx];
                }
                out[i] = sum / this.nHeads;
            }
        } else if (headIdx !== null) {
            for (let i = 0; i < info.nPatches; i++) {
                const kIdx = info.startIdx + i;
                out[i] = attn[headIdx][queryIdx][kIdx];
            }
        } else {
            throw new Error('Specify headIdx or set meanHeads=true');
        }
        
        return out;
    }
    
    /**
     * Compute the maximum patch attention across all cameras for a given query.
     * Used for global normalization of overlays.
     */
    getGlobalMaxPatchAttentionForQuery(queryIdx, options = {}) {
        const { meanHeads = true, headIdx = null } = options;
        let maxVal = 0;
        for (const camName of this.cameraNames) {
            const info = this.getCameraInfo(camName);
            if (!info) continue;
            
            if (this.attnWeightsFlat) {
                const H = this.nHeads;
                for (let i = 0; i < info.nPatches; i++) {
                    const kIdx = info.startIdx + i;
                    let v;
                    if (meanHeads) {
                        let sum = 0;
                        for (let h = 0; h < H; h++) sum += this._getAttnFlat(0, h, queryIdx, kIdx);
                        v = sum / H;
                    } else if (headIdx !== null) {
                        v = this._getAttnFlat(0, headIdx, queryIdx, kIdx);
                    } else {
                        throw new Error('Specify headIdx or set meanHeads=true');
                    }
                    if (v > maxVal) maxVal = v;
                }
            } else {
                const attn = this.attnWeights[0];
                for (let i = 0; i < info.nPatches; i++) {
                    const kIdx = info.startIdx + i;
                    let v;
                    if (meanHeads) {
                        let sum = 0;
                        for (let h = 0; h < this.nHeads; h++) sum += attn[h][queryIdx][kIdx];
                        v = sum / this.nHeads;
                    } else if (headIdx !== null) {
                        v = attn[headIdx][queryIdx][kIdx];
                    } else {
                        throw new Error('Specify headIdx or set meanHeads=true');
                    }
                    if (v > maxVal) maxVal = v;
                }
            }
        }
        return maxVal;
    }
}

export { ForwardAttentionVisualizer, PatchInfo };

