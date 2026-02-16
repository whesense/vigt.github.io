/**
 * Camera strip component
 * Renders a horizontal strip of camera canvases with attention overlays.
 */

import { CameraRenderer } from '../renderers/CameraRenderer.js';
import { CameraCanvasStrip } from '../../../shared/CameraCanvasStrip.js';

export class CameraStrip {
    /**
     * @param {HTMLElement} container
     * @param {Array<string>} cameraDisplayOrder
     * @param {(camName:string) => Object} getPatchInfoForCam
     * @param {(camName:string) => Image} getImageForCam
     * @param {(camName:string, queryIdx:number, opts:{meanHeads:boolean, headIdx:?number}) => Float32Array} getPatchAttention
     */
    constructor(container, cameraDisplayOrder, getPatchInfoForCam, getImageForCam, getPatchAttention) {
        this.overlayAlpha = 0.6;
        this._impl = new CameraCanvasStrip(
            container,
            cameraDisplayOrder,
            {
                getPatchInfoForCam,
                getImageForCam,
                getPatchAttention,
                rendererFactory: (canvas) => new CameraRenderer(canvas)
            },
            {
                overlayAlpha: this.overlayAlpha,
                alwaysPannable: true,
                maxSegments: 3
            }
        );
    }
    
    setOverlayAlpha(alpha) {
        this.overlayAlpha = alpha;
        this._impl.setOverlayAlpha(alpha);
    }
    
    /**
     * Recompute and render overlays for all cameras for a given query.
     *
     * @param {number} queryIdx
     * @param {Object} opts
     * @param {boolean} opts.meanHeads
     * @param {?number} opts.headIdx
     * @param {?number} opts.globalMax
     * @param {string} opts.colorScheme
     */
    updateOverlaysForQuery(queryIdx, opts = {}) {
        // Keep signature identical; delegate.
        this._impl.setOverlayAlpha(this.overlayAlpha);
        this._impl.updateOverlaysForQuery(queryIdx, opts);
    }
}
