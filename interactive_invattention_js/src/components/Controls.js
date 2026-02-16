/**
 * Controls Component
 * UI controls for aggregation, head selection, etc.
 */

export class Controls {
    /**
     * @param {HTMLElement} container - Container element
     * @param {Function} onAggregationChange - Callback when aggregation changes
     * @param {Function} onHeadChange - Callback when head selection changes
     */
    constructor(container, onAggregationChange, onHeadChange, onZoomChange = null) {
        this.container = container;
        this.onAggregationChange = onAggregationChange;
        this.onHeadChange = onHeadChange;
        this.onZoomChange = onZoomChange;
        
        this.aggregation = 'sum';
        this.headSelection = 'mean';
        
        this.setupControls();
    }
    
    /**
     * Setup control elements
     */
    setupControls() {
        // Zoom selector (optional)
        const zoomSelect = this.container.querySelector('#bev-zoom-select');
        if (zoomSelect) {
            zoomSelect.addEventListener('change', (e) => {
                const meters = parseInt(e.target.value, 10);
                // Bubble up as a synthetic "aggregation" change? No: expose via callback if present.
                if (typeof this.onZoomChange === 'function' && Number.isFinite(meters)) {
                    this.onZoomChange(meters);
                }
            });
        }

        // Aggregation selector
        const aggSelect = this.container.querySelector('#aggregation-select');
        if (aggSelect) {
            aggSelect.addEventListener('change', (e) => {
                this.aggregation = e.target.value;
                this.onAggregationChange(this.aggregation);
            });
        }
        
        // Head selector
        const headSelect = this.container.querySelector('#heads-select');
        if (headSelect) {
            headSelect.addEventListener('change', (e) => {
                this.headSelection = e.target.value;
                this.onHeadChange(this.headSelection);
            });
        }
    }
    
    /**
     * Get current aggregation method
     */
    getAggregation() {
        return this.aggregation;
    }
    
    /**
     * Get current head selection
     */
    getHeadSelection() {
        return this.headSelection;
    }
}
