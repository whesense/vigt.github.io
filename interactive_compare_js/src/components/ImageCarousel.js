export class ImageCarousel {
  constructor(stripEl, selectedImgEl, selectedLabelEl) {
    this.stripEl = stripEl;
    this.selectedImgEl = selectedImgEl;
    this.selectedLabelEl = selectedLabelEl;
    this.images = [];
    this.selectedIdx = 0;
  }

  setImages(images) {
    this.images = Array.isArray(images) ? images : [];
    console.log('Carousel images:', this.images);
    this.selectedIdx = 0;
    this.render();
    if (this.images.length > 0) this.select(0);
  }

  render() {
    this.stripEl.innerHTML = '';
    this.images.forEach((img, idx) => {
      const item = document.createElement('div');
      item.className = 'thumb' + (idx === this.selectedIdx ? ' selected' : '');
      item.title = img.name || '';
      item.addEventListener('click', () => this.select(idx));

      const im = document.createElement('img');
      im.loading = 'lazy';
      im.alt = img.name || `image ${idx}`;
      im.src = img.url;
      im.addEventListener('error', () => {
        console.warn('Failed to load image:', img.url);
      });

      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = img.name || '';

      item.appendChild(im);
      item.appendChild(cap);
      this.stripEl.appendChild(item);
    });
  }

  select(idx) {
    if (this.images.length === 0) return;
    this.selectedIdx = Math.max(0, Math.min(this.images.length - 1, idx));

    const img = this.images[this.selectedIdx];
    this.selectedImgEl.src = img.url;
    this.selectedLabelEl.textContent = img.name || img.url;

    // update selection styling
    const children = Array.from(this.stripEl.children);
    children.forEach((el, i) => {
      if (!(el instanceof HTMLElement)) return;
      el.classList.toggle('selected', i === this.selectedIdx);
    });
  }
}

