/**
 * ImageStrip
 * Infinite-scrolling strip for displaying images (optionally selectable).
 */
import { InfiniteStrip } from './InfiniteStrip.js';

export class ImageStrip {
  /**
   * @param {HTMLElement} container
   * @param {Array<{key:string, src:string, label?:string}>} images
   * @param {Object} [options]
   * @param {(key:string)=>void} [options.onSelect]
   * @param {boolean} [options.enableSelection=false]
   * @param {boolean} [options.alwaysPannable=true]
   * @param {number} [options.maxSegments=7]
   * @param {string} [options.itemClass='image-strip-item']
   */
  constructor(container, images, options = {}) {
    this.container = container;
    this.images = Array.isArray(images) ? images : [];
    this.onSelect = options.onSelect || null;
    this.enableSelection = options.enableSelection !== undefined ? options.enableSelection : false;
    this._selected = null;

    this._strip = new InfiniteStrip(this.container, this.images, {
      key: (it) => it.key,
      itemClass: options.itemClass || 'image-strip-item',
      alwaysPannable: options.alwaysPannable !== undefined ? options.alwaysPannable : true,
      maxSegments: options.maxSegments !== undefined ? options.maxSegments : 7,
      enableInfinite: true,
      onItemClick: this.enableSelection
        ? (it) => {
            this.setSelected(it.key);
            this.onSelect && this.onSelect(it.key);
          }
        : null,
      renderMainItem: (el, it) => {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.fetchPriority = 'low';
        img.alt = it.label || it.key || 'image';
        img.src = it.src;
        el.appendChild(img);

        if (it.label) {
          const cap = document.createElement('div');
          cap.className = 'image-strip-label';
          cap.textContent = it.label;
          el.appendChild(cap);
        }
      }
    });
  }

  destroy() {
    this._strip?.destroy();
    this._strip = null;
  }

  setImages(images) {
    this.images = Array.isArray(images) ? images : [];
    this._strip?.setItems(this.images);
  }

  setSelected(key) {
    this._selected = key;
    if (this.enableSelection) this._strip?.setSelected(key);
  }

  getSelected() {
    return this._selected;
  }
}
