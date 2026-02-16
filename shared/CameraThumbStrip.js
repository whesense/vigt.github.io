/**
 * CameraThumbStrip
 * Infinite-scrolling thumbnail strip for camera selection + region previews.
 *
 * Provides updateThumbnail(camName, image, regions) similar to the old CameraGallery.
 */
import { InfiniteStrip } from './InfiniteStrip.js';

export class CameraThumbStrip {
  /**
   * @param {HTMLElement} container
   * @param {Array<string>} cameraNames display order
   * @param {(camName:string)=>void} onSelect
   * @param {Object} [options]
   * @param {number} [options.thumbWidth=150]
   * @param {number} [options.thumbHeight=100]
   * @param {'contain'|'cover'} [options.imageFit='contain']
   * @param {boolean} [options.alwaysPannable=true]
   * @param {number} [options.maxSegments=7]
   */
  constructor(container, cameraNames, onSelect, options = {}) {
    this.container = container;
    this.cameraNames = cameraNames || [];
    this.onSelect = onSelect;

    this.thumbWidth = options.thumbWidth !== undefined ? options.thumbWidth : 150;
    this.thumbHeight = options.thumbHeight !== undefined ? options.thumbHeight : 100;
    this.imageFit = options.imageFit === 'cover' ? 'cover' : 'contain';

    this._state = new Map(); // camName -> { image, regions }
    this._main = new Map(); // camName -> { canvas, ctx, labelEl }
    this._clones = new Map(); // camName -> Array<HTMLCanvasElement>
    this._selected = null;

    const items = this.cameraNames.map((name) => ({ key: name, label: name }));

    this._strip = new InfiniteStrip(this.container, items, {
      key: (it) => it.key,
      itemClass: 'camera-thumb-item',
      alwaysPannable: options.alwaysPannable !== undefined ? options.alwaysPannable : true,
      maxSegments: options.maxSegments !== undefined ? options.maxSegments : 7,
      enableInfinite: true,
      onRenderStart: () => {
        this._main.clear();
        this._clones.clear();
      },
      onRenderEnd: () => {
        // When InfiniteStrip re-renders (e.g., iframe autoheight triggers resize),
        // clones are re-created and need to be synced again from the main canvases.
        requestAnimationFrame(() => {
          for (const camName of this.cameraNames) this._syncClonesFromMain(camName);
        });
      },
      onItemClick: (it) => {
        this.selectCamera(it.key);
      },
      renderMainItem: (el, it) => {
        const camName = it.key;
        const canvas = document.createElement('canvas');
        canvas.className = 'thumbnail-canvas';
        canvas.width = this.thumbWidth;
        canvas.height = this.thumbHeight;

        const label = document.createElement('div');
        label.className = 'thumbnail-label';
        label.textContent = it.label;

        el.appendChild(canvas);
        el.appendChild(label);

        const ctx = canvas.getContext('2d');
        this._main.set(camName, { canvas, ctx, labelEl: label });

        const st = this._state.get(camName);
        if (st && st.image) this._drawIntoCanvas(camName, canvas, ctx, st.image, st.regions || []);
      },
      renderCloneItem: (el, it, mainEl) => {
        void mainEl;
        const camName = it.key;
        const canvas = document.createElement('canvas');
        canvas.className = 'thumbnail-canvas';

        // size will be synced from main canvas
        const label = document.createElement('div');
        label.className = 'thumbnail-label';
        label.textContent = it.label;

        el.appendChild(canvas);
        el.appendChild(label);

        const arr = this._clones.get(camName) || [];
        arr.push(canvas);
        this._clones.set(camName, arr);
      }
    });
  }

  destroy() {
    this._strip?.destroy();
    this._strip = null;
    this._state.clear();
    this._main.clear();
    this._clones.clear();
  }

  selectCamera(camName, skipCallback = false) {
    if (this._selected === camName) return;
    this._selected = camName;
    this._strip.setSelected(camName);
    if (!skipCallback && this.onSelect) this.onSelect(camName);
  }

  getSelectedCamera() {
    return this._selected;
  }

  /**
   * Update thumbnail content. Regions are [{xRange:[x1,x2], yRange:[y1,y2], color}]
   */
  updateThumbnail(camName, image, regions = []) {
    this._state.set(camName, { image, regions });
    const main = this._main.get(camName);
    if (main) this._drawIntoCanvas(camName, main.canvas, main.ctx, image, regions);
    this._syncClonesFromMain(camName);

    // If image isn't ready yet, re-render once it loads.
    const iw = image?.naturalWidth || image?.width || 0;
    const ih = image?.naturalHeight || image?.height || 0;
    if (image && (!iw || !ih) && typeof image.addEventListener === 'function') {
      const onLoad = () => {
        // ensure state still matches this image
        const st = this._state.get(camName);
        if (!st || st.image !== image) return;
        const m = this._main.get(camName);
        if (m) this._drawIntoCanvas(camName, m.canvas, m.ctx, image, st.regions || []);
        this._syncClonesFromMain(camName);
      };
      image.addEventListener('load', onLoad, { once: true });
    }
  }

  _drawIntoCanvas(camName, canvas, ctx, image, regions) {
    try {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // IMPORTANT:
      // Images are often created via `new Image()` and may never be attached to the DOM.
      // In that case, `image.width/height` can be 0 or unreliable; prefer natural sizes.
      const iw = image?.naturalWidth || image?.width || 0;
      const ih = image?.naturalHeight || image?.height || 0;
      if (!image || !iw || !ih) {
        return;
      }

      // Keep a fixed thumbnail height while matching each camera image aspect ratio.
      // This avoids internal letterbox bars without cropping image content.
      const targetHeight = this.thumbHeight;
      const targetWidth = Math.max(1, Math.round((iw / ih) * targetHeight));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      // Keep legacy behavior by default; opt-in cover removes side letterboxing.
      const scale =
        this.imageFit === 'cover'
          ? Math.max(canvas.width / iw, canvas.height / ih)
          : Math.min(canvas.width / iw, canvas.height / ih);
      const width = iw * scale;
      const height = ih * scale;
      const x = (canvas.width - width) / 2;
      const y = (canvas.height - height) / 2;

      ctx.drawImage(image, x, y, width, height);

      // Draw region indicators with matching colors
      if (regions && regions.length > 0) {
        ctx.lineWidth = 2;
        for (let i = 0; i < regions.length; i++) {
          const { xRange, yRange, color = 'yellow' } = regions[i];
          const [x1, x2] = xRange;
          const [y1, y2] = yRange;
          const scaleX = width / iw;
          const scaleY = height / ih;
          ctx.strokeStyle = color;
          ctx.strokeRect(
            x + x1 * scaleX,
            y + y1 * scaleY,
            (x2 - x1) * scaleX,
            (y2 - y1) * scaleY
          );
        }
      }
    } catch (err) {
      console.error(`Error drawing thumbnail for ${camName}:`, err);
    }
  }

  _syncClonesFromMain(camName) {
    const main = this._main.get(camName);
    if (!main) return;
    const clones = this._clones.get(camName) || [];

    for (const c of clones) {
      c.width = main.canvas.width;
      c.height = main.canvas.height;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(main.canvas, 0, 0);
    }
  }
}
