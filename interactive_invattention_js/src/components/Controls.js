/**
 * Controls Component
 * UI controls for head selection and zoom.
 */

export class Controls {
    /**
     * @param {HTMLElement} container - Container element
     * @param {Function} onHeadChange - Callback when head selection changes
     */
    constructor(container, onHeadChange, onZoomChange = null) {
        this.container = container;
        this.onHeadChange = onHeadChange;
        this.onZoomChange = onZoomChange;
        
        this.headSelection = { mode: 'mean', headIdx: null };
        
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

        // Head selector
        const headSelect = this.container.querySelector('#heads-select');
        if (headSelect) {
            headSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val === 'mean') {
                    this.headSelection = { mode: 'mean', headIdx: null };
                } else if (val.startsWith('head:')) {
                    const headIdx = parseInt(val.split(':')[1], 10);
                    this.headSelection = { mode: 'head', headIdx };
                }
                this.onHeadChange(this.headSelection);
            });
        }
    }

    setHeadOptions(nHeads) {
        const headSelect = this.container.querySelector('#heads-select');
        if (!headSelect) return;

        const selectedValue = this.headSelection.mode === 'head'
            ? `head:${this.headSelection.headIdx}`
            : 'mean';

        headSelect.innerHTML = '';
        const optMean = document.createElement('option');
        optMean.value = 'mean';
        optMean.textContent = 'Mean over heads';
        headSelect.appendChild(optMean);

        for (let h = 0; h < nHeads; h++) {
            const opt = document.createElement('option');
            opt.value = `head:${h}`;
            opt.textContent = `Head ${h}`;
            headSelect.appendChild(opt);
        }

        const hasSelected = Array.from(headSelect.options).some((opt) => opt.value === selectedValue);
        headSelect.value = hasSelected ? selectedValue : 'mean';
        if (!hasSelected) {
            this.headSelection = { mode: 'mean', headIdx: null };
        }
    }
    
    /**
     * Get current head selection
     */
    getHeadSelection() {
        return this.headSelection;
    }
}
