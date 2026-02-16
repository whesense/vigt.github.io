/**
 * InfiniteStrip
 * Generic, pannable, infinite-wrapping horizontal strip with dynamic segment count.
 *
 * Design goals:
 * - Default: always pannable + infinite wrap (even when one segment fits).
 * - Render an odd number of segments (3/5/7/...) based on viewport vs segment width.
 * - Pluggable rendering per item (DOM/canvas/etc).
 */
export class InfiniteStrip {
  /**
   * @param {HTMLElement} container
   * @param {Array<any>} items
   * @param {Object} options
   * @param {(item:any)=>string} [options.key] stable key for item
   * @param {(item:any, cycle:number)=>HTMLElement} [options.createItemContainer]
   * @param {(el:HTMLElement, item:any)=>void} options.renderMainItem called for cycle=0
   * @param {(el:HTMLElement, item:any, mainEl:HTMLElement)=>void} [options.renderCloneItem] called for cycle!=0
   * @param {(item:any)=>void} [options.onItemClick]
   * @param {boolean} [options.enableInfinite=true]
   * @param {boolean} [options.alwaysPannable=true]
   * @param {boolean} [options.wheelPan=true] map vertical wheel -> horizontal pan
   * @param {number} [options.maxSegments=7] clamp odd number of segments
   * @param {number} [options.dragThreshold=6] pixels before drag-to-pan starts
   * @param {string} [options.itemClass='infinite-strip-item']
   * @param {string} [options.selectedClass='selected']
   */
  constructor(container, items, options = {}) {
    this.container = container;
    this.items = Array.isArray(items) ? items : [];
    this.options = {
      key: options.key || ((it) => (typeof it === 'string' ? it : String(it?.key ?? it?.id ?? it))),
      createItemContainer: options.createItemContainer || (() => document.createElement('div')),
      renderMainItem: options.renderMainItem,
      renderCloneItem: options.renderCloneItem || null,
      onItemClick: options.onItemClick || null,
      onRenderStart: options.onRenderStart || null,
      onRenderEnd: options.onRenderEnd || null,
      enableInfinite: options.enableInfinite !== undefined ? options.enableInfinite : true,
      alwaysPannable: options.alwaysPannable !== undefined ? options.alwaysPannable : true,
      wheelPan: options.wheelPan !== undefined ? options.wheelPan : true,
      maxSegments: options.maxSegments !== undefined ? options.maxSegments : 7,
      dragThreshold: options.dragThreshold !== undefined ? options.dragThreshold : 6,
      itemClass: options.itemClass || 'infinite-strip-item',
      selectedClass: options.selectedClass || 'selected'
    };

    if (!this.options.renderMainItem) {
      throw new Error('InfiniteStrip requires options.renderMainItem');
    }

    this._renderedHalf = 0;
    this.segmentWidth = null;
    this.selectedKey = null;

    this._mainEls = new Map(); // key -> HTMLElement (cycle 0 container)
    this._itemsByKey = new Map(); // key -> original item object
    this._allEls = []; // all item containers across cycles

    this._isPanning = false;
    this._isPointerDown = false;
    this._panStartX = 0;
    this._panStartScrollLeft = 0;
    this._pointerDownItem = null;
    this._pointerDownClientX = 0;
    this._pointerDownClientY = 0;
    this._pointerDownScrollLeft = 0;
    this._pointerMoved = false;
    this._activePointerId = null;
    this._suppressClick = false;

    this._onScroll = null;
    this._onResize = null;
    this._onPointerDown = null;
    this._onPointerMove = null;
    this._onPointerUp = null;
    this._onPointerCancel = null;
    this._onLostPointerCapture = null;
    this._onWheel = null;

    this._lastResizeClientWidth = null;

    this.render();
    this._installInteraction();
  }

  setItems(items) {
    this.items = Array.isArray(items) ? items : [];
    this.render();
  }

  setSelected(key) {
    this.selectedKey = key;
    this._syncSelection();
  }

  getSelected() {
    return this.selectedKey;
  }

  destroy() {
    this._removeInteraction();
    this.container.innerHTML = '';
    this._mainEls.clear();
    this._itemsByKey.clear();
    this._allEls = [];
  }

  render() {
    // Start with minimal cycles (0 if finite, else 3 segments) then re-render if we need 5/7/...
    const half = this.options.enableInfinite ? 1 : 0;
    this._renderWithHalf(half);

    // After layout, compute segmentWidth and adjust segment count if needed.
    requestAnimationFrame(() => {
      this._updateSegmentWidth();
      const desiredHalf = this._computeDesiredHalf();
      if (desiredHalf !== this._renderedHalf) {
        this._renderWithHalf(desiredHalf);
        requestAnimationFrame(() => {
          this._updateSegmentWidth();
          this._jumpToCenter();
        });
      } else {
        this._jumpToCenter();
      }
    });
  }

  _renderWithHalf(half) {
    if (this.options.onRenderStart) this.options.onRenderStart({ half });

    this._renderedHalf = half;
    this.segmentWidth = null;
    this._mainEls.clear();
    this._itemsByKey.clear();
    this._allEls = [];
    this.container.innerHTML = '';

    // Two-pass render:
    // 1) Build cycle 0 elements (so clones can reference them).
    // 2) Append segments in visual order [-half..0..half] so segmentWidth measurement is correct.
    for (const item of this.items) {
      const key = String(this.options.key(item));
      const el = this.options.createItemContainer(item, 0);
      el.classList.add(this.options.itemClass);
      el.dataset.stripKey = key;
      el.dataset.cycle = "0";
      if (this.options.onItemClick) el.addEventListener("click", () => this._handleItemClick(item));
      this.options.renderMainItem(el, item);
      this._mainEls.set(key, el);
      this._itemsByKey.set(key, item);
    }

    for (let cycle = -half; cycle <= half; cycle++) {
      for (const item of this.items) {
        const key = String(this.options.key(item));

        let el;
        if (cycle === 0) {
          el = this._mainEls.get(key);
          if (!el) continue;
        } else {
          el = this.options.createItemContainer(item, cycle);
          el.classList.add(this.options.itemClass);
          el.dataset.stripKey = key;
          el.dataset.cycle = String(cycle);
          if (this.options.onItemClick) el.addEventListener("click", () => this._handleItemClick(item));

          const mainEl = this._mainEls.get(key) || null;
          if (this.options.renderCloneItem && mainEl) this.options.renderCloneItem(el, item, mainEl);
          else this.options.renderMainItem(el, item);
        }

        this.container.appendChild(el);
        this._allEls.push(el);
      }
    }

    this._syncSelection();

    if (this.options.onRenderEnd) this.options.onRenderEnd({ half });
  }

  _computeDesiredHalf() {
    if (!this.options.enableInfinite) return 0;
    if (!this.container || this.items.length === 0) return 1;

    const cw = this.container.clientWidth || 0;
    const s = this.segmentWidth || 0;

    // If we couldn't measure yet, keep 3 segments.
    if (cw <= 0 || s <= 0) return 1;

    // If embeds opt out of panning and one segment fits, render single segment.
    if (!this.options.alwaysPannable && s <= cw) return 0;

    // Dynamic odd segment count: n = 2*half + 1, half >= 1
    const half = Math.max(1, Math.ceil(cw / s));
    const maxSeg = Math.max(3, this.options.maxSegments | 0);
    const maxHalf = Math.max(1, Math.floor((maxSeg - 1) / 2));
    return Math.min(half, maxHalf);
  }

  _updateSegmentWidth() {
    // Measure distance between first item in cycle 0 and same item in cycle +1.
    const firstMain = this.container.querySelector(`.${this.options.itemClass}[data-cycle="0"]`);
    const firstRight = this.container.querySelector(`.${this.options.itemClass}[data-cycle="1"]`);
    if (!firstMain || !firstRight) return;
    const s = firstRight.offsetLeft - firstMain.offsetLeft;
    if (s > 0) this.segmentWidth = s;
  }

  _jumpToCenter() {
    if (!this.options.enableInfinite) return;
    if (this.segmentWidth === null) return;
    const s = this.segmentWidth;
    const half = this._renderedHalf;
    this.container.scrollLeft = s * half;
  }

  _wrapIfNeeded() {
    if (!this.options.enableInfinite) return;
    if (this.segmentWidth === null) return;
    const s = this.segmentWidth;
    if (s <= 0) return;
    const center = s * this._renderedHalf;
    const leftBound = center - s * 0.5;
    const rightBound = center + s * 0.5;

    // Use while to handle fast drags that cross multiple segments.
    while (this.container.scrollLeft < leftBound) this.container.scrollLeft += s;
    while (this.container.scrollLeft > rightBound) this.container.scrollLeft -= s;
  }

  _syncSelection() {
    const cls = this.options.selectedClass;
    const sel = this.selectedKey;
    for (const el of this._allEls) {
      const key = el.dataset.stripKey || '';
      el.classList.toggle(cls, !!sel && key === sel);
    }
  }

  _handleItemClick(item, { bypassSuppress = false } = {}) {
    if (!bypassSuppress && this._suppressClick) return;
    if (this.options.onItemClick) this.options.onItemClick(item);
  }

  _resolveItemFromTarget(target) {
    if (!target || typeof target.closest !== 'function') return null;
    const itemEl = target.closest(`.${this.options.itemClass}`);
    if (!itemEl || !this.container.contains(itemEl)) return null;
    const key = itemEl.dataset?.stripKey || '';
    return key ? (this._itemsByKey.get(key) || null) : null;
  }

  _installInteraction() {
    // Avoid double-binding if render() is called repeatedly.
    this._removeInteraction();

    // Infinite wrap scroll handler
    this._onScroll = () => this._wrapIfNeeded();
    this.container.addEventListener('scroll', this._onScroll, { passive: true });

    // Resize handler: recompute segments and re-center
    this._onResize = () => {
      const cw = this.container?.clientWidth || 0;
      // Ignore height-only resizes (common with iframe autoheight) unless width changed.
      if (this._lastResizeClientWidth !== null && Math.abs(cw - this._lastResizeClientWidth) < 1) return;
      this._lastResizeClientWidth = cw;
      this.render();
    };
    window.addEventListener('resize', this._onResize);

    // Pointer-drag panning
    const finishPointerGesture = (
      ev,
      {
        allowClickSuppression = false,
        allowTapSelection = false
      } = {}
    ) => {
      if (!this._isPointerDown) return;
      if (this._activePointerId !== null && ev?.pointerId !== this._activePointerId) return;
      const wasPanning = this._isPanning;
      const pointerId = ev?.pointerId ?? this._activePointerId;
      const shouldSelectFromPointerUp =
        allowTapSelection && !wasPanning && !this._pointerMoved && !!this._pointerDownItem;
      this._isPointerDown = false;
      this._isPanning = false;

      if (wasPanning && pointerId !== null && pointerId !== undefined) {
        try {
          if (!this.container.hasPointerCapture || this.container.hasPointerCapture(pointerId)) {
            this.container.releasePointerCapture?.(pointerId);
          }
        } catch (_) {
          // Capture may already be gone (for example on pointer cancel).
        }
      }

      this._activePointerId = null;
      const tappedItem = this._pointerDownItem;
      this._pointerDownItem = null;
      this._pointerMoved = false;
      this._pointerDownClientX = 0;
      this._pointerDownClientY = 0;
      this._pointerDownScrollLeft = 0;

      if (shouldSelectFromPointerUp && tappedItem) {
        this._handleItemClick(tappedItem, { bypassSuppress: true });
      }

      if (shouldSelectFromPointerUp || (wasPanning && allowClickSuppression)) {
        // Click often fires after drag end; suppress once.
        this._suppressClick = true;
        setTimeout(() => { this._suppressClick = false; }, 0);
      } else {
        this._suppressClick = false;
      }
    };

    this._onPointerDown = (ev) => {
      if (!this.options.alwaysPannable) return;
      // Ignore right/middle click drags.
      if (ev.button !== undefined && ev.button !== 0) return;
      this._isPointerDown = true;
      this._isPanning = false;
      this._panStartX = ev.clientX;
      this._panStartScrollLeft = this.container.scrollLeft;
      this._pointerDownItem = this._resolveItemFromTarget(ev.target);
      this._pointerDownClientX = ev.clientX;
      this._pointerDownClientY = ev.clientY;
      this._pointerDownScrollLeft = this.container.scrollLeft;
      this._pointerMoved = false;
      this._activePointerId = ev.pointerId ?? null;
    };
    this._onPointerMove = (ev) => {
      if (!this._isPointerDown) return;
      if (this._activePointerId !== null && ev.pointerId !== this._activePointerId) return;
      const dx = ev.clientX - this._panStartX;
      const totalDx = ev.clientX - this._pointerDownClientX;
      const totalDy = ev.clientY - this._pointerDownClientY;
      const scrollDx = this.container.scrollLeft - this._pointerDownScrollLeft;
      if (
        Math.abs(totalDx) >= this.options.dragThreshold ||
        Math.abs(totalDy) >= this.options.dragThreshold ||
        Math.abs(scrollDx) >= this.options.dragThreshold
      ) {
        this._pointerMoved = true;
      }
      if (!this._isPanning) {
        if (Math.abs(dx) < this.options.dragThreshold) return;
        this._isPanning = true;
        this._suppressClick = true;
        this.container.setPointerCapture?.(ev.pointerId);
      }
      this.container.scrollLeft = this._panStartScrollLeft - dx;
      this._wrapIfNeeded();
    };
    this._onPointerUp = (ev) => {
      finishPointerGesture(ev, { allowClickSuppression: true, allowTapSelection: true });
    };
    this._onPointerCancel = (ev) => finishPointerGesture(ev, { allowClickSuppression: false, allowTapSelection: false });
    this._onLostPointerCapture = (ev) => finishPointerGesture(ev, { allowClickSuppression: false, allowTapSelection: false });

    this.container.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    window.addEventListener('pointerup', this._onPointerUp, { passive: true });
    window.addEventListener('pointercancel', this._onPointerCancel, { passive: true });
    this.container.addEventListener('lostpointercapture', this._onLostPointerCapture);

    // Wheel -> horizontal pan (optional)
    this._onWheel = (ev) => {
      if (!this.options.wheelPan) return;
      // If user is already scrolling horizontally (shiftKey), keep default.
      if (ev.shiftKey) return;
      // Only intercept if vertical wheel is dominant.
      if (Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) return;
      ev.preventDefault();
      this.container.scrollLeft += ev.deltaY;
      this._wrapIfNeeded();
    };
    this.container.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _removeInteraction() {
    if (this._onScroll) this.container.removeEventListener('scroll', this._onScroll);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._onPointerDown) this.container.removeEventListener('pointerdown', this._onPointerDown);
    if (this._onPointerMove) window.removeEventListener('pointermove', this._onPointerMove);
    if (this._onPointerUp) window.removeEventListener('pointerup', this._onPointerUp);
    if (this._onPointerCancel) window.removeEventListener('pointercancel', this._onPointerCancel);
    if (this._onLostPointerCapture) this.container.removeEventListener('lostpointercapture', this._onLostPointerCapture);
    if (this._onWheel) this.container.removeEventListener('wheel', this._onWheel);
    this._isPointerDown = false;
    this._isPanning = false;
    this._activePointerId = null;
    this._pointerDownItem = null;
    this._pointerMoved = false;
    this._suppressClick = false;
    this._onScroll = null;
    this._onResize = null;
    this._onPointerDown = null;
    this._onPointerMove = null;
    this._onPointerUp = null;
    this._onPointerCancel = null;
    this._onLostPointerCapture = null;
    this._onWheel = null;
  }
}
