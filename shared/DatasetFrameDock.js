/**
 * DatasetFrameDock
 * Shared dataset + frame filmstrip selector for iframe demos.
 */

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  return await res.json();
}

function resolveUrl(pathOrUrl, baseUrl) {
  if (!pathOrUrl) return null;
  try {
    return new URL(pathOrUrl, baseUrl).toString();
  } catch (err) {
    return null;
  }
}

function pickCameraKey(cameraNames) {
  if (!Array.isArray(cameraNames) || cameraNames.length === 0) return null;
  if (cameraNames.includes('ring_front_center')) return 'ring_front_center';
  if (cameraNames.includes('CAM_FRONT')) return 'CAM_FRONT';
  const front = cameraNames.find((name) => String(name).toLowerCase().includes('front'));
  return front || cameraNames[0];
}

function getManifestKey(demoKey) {
  if (demoKey === 'compare') return 'compare';
  if (demoKey === 'attention') return 'attention';
  if (demoKey === 'dropcameras') return 'dropcameras';
  if (demoKey === 'occupancy') return 'compare';
  if (demoKey === 'pointcloud') return 'compare';
  return null;
}

export class DatasetFrameDock {
  /**
   * @param {HTMLElement} container
   * @param {Object} options
   * @param {'compare'|'attention'|'dropcameras'} options.demoKey
   * @param {string} [options.registryUrl]
   * @param {(sceneUrl:string, frame:any)=>void} [options.onNavigate]
   */
  constructor(container, options = {}) {
    if (!container) throw new Error('DatasetFrameDock: missing container');
    this.container = container;
    this.demoKey = options.demoKey || 'compare';
    this.registryUrl = options.registryUrl || '../artifacts/registry.json';
    this.onNavigate = options.onNavigate || null;
    this.aliases = options.aliases || null;

    this.manifestKey = getManifestKey(this.demoKey);
    if (!this.manifestKey) {
      throw new Error(`DatasetFrameDock: unknown demoKey "${this.demoKey}"`);
    }

    this._registry = null;
    this._aliasesByDataset = new Map(); // dataset -> aliasMap
    this._framesByDataset = new Map(); // dataset -> frame[]
    this._datasetOrder = [];
    this._activeDataset = '';
    this._selectedFrameKey = '';
    this._frameByKey = new Map();
    this._frameByManifestUrl = new Map();
    this._thumbCache = new Map(); // frameManifestUrl -> thumbUrl
    this._frameManifestCache = new Map(); // frameManifestUrl -> manifest json

    this._io = null;

    this.elDatasets = null;
    this.elStrip = null;
    this.elLabel = null;
    this.elPrev = null;
    this.elNext = null;

    this.ready = false;

    if (this.aliases && typeof this.aliases === 'object') {
      Object.entries(this.aliases).forEach(([dataset, map]) => {
        if (map && typeof map === 'object') this._aliasesByDataset.set(dataset, map);
      });
    }
  }

  async init() {
    this._renderSkeleton();

    try {
      await this._loadRegistryAndAliases();
      this._buildFrameIndex();
      this._renderDatasets();
      const firstDataset = this._datasetOrder.find((d) => (this._framesByDataset.get(d) || []).length > 0);
      if (firstDataset) {
        this._setActiveDataset(firstDataset, { preserveSelection: false });
      } else if (this.elLabel) {
        this.elLabel.textContent = 'No frames available';
      }
      this.ready = true;
    } catch (err) {
      console.error('DatasetFrameDock init failed:', err);
      this.container.classList.add('dataset-dock--error');
      if (this.elLabel) {
        this.elLabel.textContent = 'Scene selector unavailable';
      }
      this.ready = false;
    }
  }

  destroy() {
    this._io?.disconnect?.();
    this._io = null;
    this.container.innerHTML = '';
    this._frameByKey.clear();
    this._frameByManifestUrl.clear();
    this._framesByDataset.clear();
    this._datasetOrder = [];
  }

  getDefaultSceneUrl() {
    for (const dataset of this._datasetOrder) {
      const frames = this._framesByDataset.get(dataset) || [];
      if (frames.length > 0) return frames[0].manifestUrl || null;
    }
    return null;
  }

  /**
   * Select a frame by its scene manifest URL (relative or absolute).
   * Updates UI only (no navigation).
   */
  setSelectedBySceneUrl(sceneUrl) {
    if (!this.ready || !sceneUrl) return false;
    const abs = resolveUrl(sceneUrl, window.location.href);
    if (!abs) return false;
    const frame = this._frameByManifestUrl.get(abs) || null;
    if (!frame) return false;
    if (frame.dataset !== this._activeDataset) {
      this._setActiveDataset(frame.dataset, { preserveSelection: true });
    }
    this._setSelectedFrame(frame.key, { navigate: false });
    return true;
  }

  _renderSkeleton() {
    this.container.classList.add('dataset-dock');
    this.container.innerHTML = '';

    const datasetsRow = document.createElement('div');
    datasetsRow.className = 'dataset-dock__datasets';
    this.elDatasets = datasetsRow;

    const filmRow = document.createElement('div');
    filmRow.className = 'dataset-dock__film';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'dataset-dock__nav';
    prevBtn.textContent = '<';
    prevBtn.disabled = true;
    prevBtn.addEventListener('click', () => this._stepFrame(-1));
    this.elPrev = prevBtn;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'dataset-dock__nav';
    nextBtn.textContent = '>';
    nextBtn.disabled = true;
    nextBtn.addEventListener('click', () => this._stepFrame(1));
    this.elNext = nextBtn;

    const strip = document.createElement('div');
    strip.className = 'dataset-dock__strip';
    this.elStrip = strip;

    filmRow.appendChild(prevBtn);
    filmRow.appendChild(strip);
    filmRow.appendChild(nextBtn);

    const labelRow = document.createElement('div');
    labelRow.className = 'dataset-dock__label';
    labelRow.textContent = 'Loading frames...';
    this.elLabel = labelRow;

    this.container.appendChild(datasetsRow);
    this.container.appendChild(filmRow);
    this.container.appendChild(labelRow);
  }

  async _loadRegistryAndAliases() {
    const registryAbs = resolveUrl(this.registryUrl, window.location.href);
    if (!registryAbs) throw new Error('Invalid registry URL');
    this.registryAbsUrl = registryAbs;

    this._registry = await fetchJson(registryAbs);
    const datasets = Array.isArray(this._registry.datasets) ? this._registry.datasets : [];

    for (const ds of datasets) {
      const name = ds.dataset;
      if (!name) continue;
      if (this._aliasesByDataset.has(name)) continue;
      const aliasUrl = resolveUrl(`../artifacts/aliases/${name}_scene_aliases.json`, window.location.href);
      if (!aliasUrl) continue;
      try {
        const aliasMap = await fetchJson(aliasUrl);
        this._aliasesByDataset.set(name, aliasMap || {});
      } catch (err) {
        // Optional; ignore missing aliases
        this._aliasesByDataset.set(name, {});
      }
    }
  }

  _buildFrameIndex() {
    this._framesByDataset.clear();
    this._datasetOrder = [];
    this._frameByKey.clear();
    this._frameByManifestUrl.clear();

    const datasets = Array.isArray(this._registry?.datasets) ? this._registry.datasets : [];
    datasets.forEach((ds) => {
      const datasetName = ds.dataset;
      if (!datasetName) return;
      const frames = [];
      const aliasMap = this._aliasesByDataset.get(datasetName) || {};
      const scenes = Array.isArray(ds.scenes) ? ds.scenes : [];
      scenes.forEach((scene) => {
        const sceneId = scene.scene_id || '';
        const sourceSceneId = scene.source_scene_id || '';
        const sceneLabel = aliasMap[sourceSceneId] || sceneId || sourceSceneId;
        const sceneFrames = Array.isArray(scene.frames) ? scene.frames : [];
        sceneFrames.forEach((frame) => {
          const manifests = frame.manifests || {};
          const manifestRel = manifests[this.manifestKey];
          if (!manifestRel) return;
          const frameManifestRel = manifests.frame || null;
          const manifestUrl = resolveUrl(manifestRel, this.registryAbsUrl);
          const frameManifestUrl = resolveUrl(frameManifestRel, this.registryAbsUrl);
          if (!manifestUrl) return;
          const frameId = frame.frame_id || '';
          const key = `${datasetName}::${sceneId}::${frameId}`;
          const entry = {
            key,
            dataset: datasetName,
            scene_id: sceneId,
            source_scene_id: sourceSceneId,
            frame_id: frameId,
            sceneLabel,
            manifestUrl,
            frameManifestUrl,
          };
          frames.push(entry);
          this._frameByKey.set(key, entry);
          this._frameByManifestUrl.set(manifestUrl, entry);
        });
      });
      if (frames.length > 0) {
        this._framesByDataset.set(datasetName, frames);
        this._datasetOrder.push(datasetName);
      }
    });
  }

  _renderDatasets() {
    if (!this.elDatasets) return;
    this.elDatasets.innerHTML = '';
    this._datasetOrder.forEach((dataset) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dataset-dock__chip';
      btn.textContent = dataset;
      btn.addEventListener('click', () => {
        if (dataset === this._activeDataset) return;
        this._setActiveDataset(dataset, { preserveSelection: false });
      });
      this.elDatasets.appendChild(btn);
    });
    this._syncDatasetChips();
  }

  _setActiveDataset(dataset, { preserveSelection }) {
    this._activeDataset = dataset;
    this._syncDatasetChips();
    this._renderFramesForDataset(dataset);
    const frames = this._framesByDataset.get(dataset) || [];
    if (!preserveSelection || !this._selectedFrameKey) {
      const first = frames[0];
      if (first) this._setSelectedFrame(first.key, { navigate: false });
    } else if (this._selectedFrameKey && this._frameByKey.get(this._selectedFrameKey)?.dataset !== dataset) {
      const first = frames[0];
      if (first) this._setSelectedFrame(first.key, { navigate: false });
    }
  }

  _syncDatasetChips() {
    if (!this.elDatasets) return;
    const chips = Array.from(this.elDatasets.children);
    chips.forEach((chip) => {
      const name = chip.textContent || '';
      chip.classList.toggle('is-selected', name === this._activeDataset);
    });
  }

  _renderFramesForDataset(dataset) {
    if (!this.elStrip) return;
    this.elStrip.innerHTML = '';
    const frames = this._framesByDataset.get(dataset) || [];
    frames.forEach((frame) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dataset-dock__tile';
      btn.dataset.frameKey = frame.key;
    btn.title = `${frame.sceneLabel || frame.scene_id} - ${frame.frame_id}`;

      const img = document.createElement('img');
      img.className = 'dataset-dock__thumb';
      img.alt = btn.title;
      img.loading = 'lazy';
      img.dataset.frameKey = frame.key;

      const placeholder = document.createElement('div');
      placeholder.className = 'dataset-dock__placeholder';
      placeholder.textContent = frame.frame_id || 'frame';

      btn.appendChild(img);
      btn.appendChild(placeholder);

      btn.addEventListener('click', () => {
        this._setSelectedFrame(frame.key, { navigate: true });
      });

      this.elStrip.appendChild(btn);
    });

    this._setupIntersectionObserver();
    this._syncSelection();
    this._updateLabel();
    this._updateNavButtons();
  }

  _setupIntersectionObserver() {
    if (!this.elStrip) return;
    this._io?.disconnect?.();
    this._io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          const key = img.dataset.frameKey;
          if (!key) return;
          const frame = this._frameByKey.get(key);
          if (frame) this._ensureThumbnail(frame, img);
          this._io?.unobserve?.(img);
        });
      },
      {
        root: this.elStrip,
        rootMargin: '200px',
        threshold: 0.01,
      }
    );

    const imgs = this.elStrip.querySelectorAll('.dataset-dock__thumb');
    imgs.forEach((img) => this._io.observe(img));
  }

  _setSelectedFrame(frameKey, { navigate }) {
    if (!frameKey) return;
    this._selectedFrameKey = frameKey;
    this._syncSelection();
    this._updateLabel();
    this._updateNavButtons();
    this._scrollSelectedIntoView();
    if (navigate) this._navigateTo(frameKey);
  }

  _syncSelection() {
    if (!this.elStrip) return;
    const tiles = this.elStrip.querySelectorAll('.dataset-dock__tile');
    tiles.forEach((tile) => {
      const key = tile.dataset.frameKey || '';
      tile.classList.toggle('is-selected', key === this._selectedFrameKey);
    });
  }

  _updateLabel() {
    if (!this.elLabel) return;
    const frame = this._frameByKey.get(this._selectedFrameKey);
    if (!frame) {
      this.elLabel.textContent = '';
      return;
    }
    const scene = frame.sceneLabel || frame.scene_id || '';
    const frameId = frame.frame_id || '';
    this.elLabel.textContent = `${scene} - ${frameId}`.trim();
  }

  _updateNavButtons() {
    if (!this.elPrev || !this.elNext) return;
    const frames = this._framesByDataset.get(this._activeDataset) || [];
    const idx = frames.findIndex((f) => f.key === this._selectedFrameKey);
    this.elPrev.disabled = idx <= 0;
    this.elNext.disabled = idx < 0 || idx >= frames.length - 1;
  }

  _stepFrame(delta) {
    const frames = this._framesByDataset.get(this._activeDataset) || [];
    const idx = frames.findIndex((f) => f.key === this._selectedFrameKey);
    if (idx < 0) return;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= frames.length) return;
    const next = frames[nextIdx];
    if (next) this._setSelectedFrame(next.key, { navigate: true });
  }

  _scrollSelectedIntoView() {
    if (!this.elStrip) return;
    const selected = this.elStrip.querySelector('.dataset-dock__tile.is-selected');
    if (!selected) return;
    selected.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  _navigateTo(frameKey) {
    const frame = this._frameByKey.get(frameKey);
    if (!frame || !frame.manifestUrl) return;

    const currentParam = new URL(window.location.href).searchParams.get('scene');
    const currentAbs = currentParam ? resolveUrl(currentParam, window.location.href) : null;
    if (currentAbs && currentAbs === frame.manifestUrl) return;

    if (this.onNavigate) {
      this.onNavigate(frame.manifestUrl, frame);
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('scene', frame.manifestUrl);
    window.location.href = url.toString();
  }

  async _ensureThumbnail(frame, imgEl) {
    if (!frame || !imgEl) return;
    if (imgEl.dataset.thumbLoaded === '1') return;

    let thumbUrl = frame.thumbUrl;
    if (!thumbUrl && frame.frameManifestUrl) {
      thumbUrl = this._thumbCache.get(frame.frameManifestUrl);
    }

    if (!thumbUrl && frame.frameManifestUrl) {
      let manifest = this._frameManifestCache.get(frame.frameManifestUrl);
      if (!manifest) {
        try {
          manifest = await fetchJson(frame.frameManifestUrl);
          this._frameManifestCache.set(frame.frameManifestUrl, manifest);
        } catch (err) {
          console.warn('Failed to load frame manifest:', frame.frameManifestUrl, err);
        }
      }
      const images = manifest?.modalities?.images;
      const files =
        images?.scaled_files ||
        images?.files ||
        null;
      const camKey = pickCameraKey(images?.camera_order || manifest?.camera_names || Object.keys(files || {}));
      const rel = files ? files[camKey] : null;
      if (rel) {
        const frameRoot = resolveUrl('..', frame.frameManifestUrl);
        thumbUrl = resolveUrl(rel, frameRoot || frame.frameManifestUrl);
        if (thumbUrl) this._thumbCache.set(frame.frameManifestUrl, thumbUrl);
      }
    }

    if (thumbUrl) {
      imgEl.src = thumbUrl;
      imgEl.dataset.thumbLoaded = '1';
      const placeholder = imgEl.nextElementSibling;
      if (placeholder && placeholder.classList.contains('dataset-dock__placeholder')) {
        placeholder.style.display = 'none';
      }
    }
  }
}
