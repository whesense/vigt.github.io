/**
 * Main application for interactive point cloud viewer
 */

import { loadPointCloudData } from './pointCloudLoader.js';
import { PointCloudRenderer } from './pointCloudRenderer.js';
import { DatasetFrameDock } from '../../shared/DatasetFrameDock.js';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  return await res.json();
}

function resolveUrl(pathOrUrl, baseUrl) {
  if (!pathOrUrl) return null;
  try {
    return new URL(pathOrUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizePointCloudOptions(sceneManifest, sceneUrl) {
  if (!sceneManifest || typeof sceneManifest !== 'object') return [];

  if (Array.isArray(sceneManifest.pointclouds) && sceneManifest.pointclouds.length > 0) {
    return sceneManifest.pointclouds
      .filter((it) => it && typeof it.url === 'string' && it.url.length > 0)
      .map((it, idx) => {
        const key = (typeof it.key === 'string' && it.key.length > 0) ? it.key : `pc_${idx}`;
        const label = (typeof it.label === 'string' && it.label.length > 0) ? it.label : key;
        return { key, label, url: new URL(it.url, sceneUrl).toString() };
      });
  }

  const items = sceneManifest?.modalities?.pointclouds?.items;
  if (items && typeof items === 'object') {
    return Object.entries(items)
      .map(([key, item]) => {
        const rel = item?.json || item?.url || null;
        const url = resolveUrl(rel, sceneUrl);
        if (!url) return null;
        const label = (typeof item?.label === 'string' && item.label.length > 0) ? item.label : key;
        return { key, label, url };
      })
      .filter(Boolean);
  }

  if (sceneManifest?.pointcloud?.url) {
    return [{
      key: 'pointcloud',
      label: 'Point cloud',
      url: new URL(sceneManifest.pointcloud.url, sceneUrl).toString(),
    }];
  }

  return [];
}

class App {
  static VERSION = '2026-02-17-pointcloud-switch-v1';

  constructor() {
    this.loadingEl = null;
    this.errorEl = null;
    this.errorMsgEl = null;
    this.mainEl = null;
    this.canvas = null;
    this.contextDockEl = null;
    this.sceneMenuToggleBtnEl = null;
    this.pcSwitchEl = null;
    this.pcModelBtnGtEl = null;
    this.pcModelBtnVigtEl = null;

    this.renderer = null;
    this.dock = null;
    this.scenePath = '';
    this.pcOptions = [];
    this.pcCacheByUrl = new Map();
    this.activeModelKey = '';
    this.isSceneMenuVisible = true;
  }

  async init() {
    this.loadingEl = document.getElementById('loading');
    this.errorEl = document.getElementById('error');
    this.errorMsgEl = document.getElementById('error-message');
    this.mainEl = document.getElementById('main');
    this.canvas = document.getElementById('gl-canvas');
    this.contextDockEl = document.getElementById('context-dock');
    this.sceneMenuToggleBtnEl = document.getElementById('scene-menu-toggle-btn');
    this.pcSwitchEl = document.getElementById('pc-model-switch');
    this.pcModelBtnGtEl = document.getElementById('pc-model-btn-gt');
    this.pcModelBtnVigtEl = document.getElementById('pc-model-btn-vigt');

    const urlParams = new URLSearchParams(window.location.search);
    const defaultScene = 'data/pointclouds/vigt_frame000121.json';
    const sceneMenuParam =
      urlParams.get('sceneMenu') ??
      urlParams.get('scene_menu') ??
      '';
    const normalizedSceneMenuParam = String(sceneMenuParam).trim().toLowerCase();
    const initialSceneMenuVisible = normalizedSceneMenuParam
      ? !['0', 'false', 'off', 'hide', 'hidden', 'no'].includes(normalizedSceneMenuParam)
      : true;
    this._bindSceneMenuToggle();

    const dockContainer = this.contextDockEl;
    const initDock = async () => {
      if (!dockContainer) return null;
      try {
        const dock = new DatasetFrameDock(dockContainer, { demoKey: 'pointcloud' });
        await dock.init();
        return dock;
      } catch (err) {
        console.warn('Dataset dock init failed:', err);
        return null;
      }
    };

    this.dock = await initDock();
    this._setSceneMenuVisible(initialSceneMenuVisible, { syncQuery: false });
    this._setSceneMenuToggleEnabled(!!this.dock);

    let scenePath = urlParams.get('scene');
    if (scenePath) {
      this.dock?.setSelectedBySceneUrl(scenePath);
    } else {
      const def = this.dock?.getDefaultSceneUrl?.() || null;
      if (def) {
        const url = new URL(window.location.href);
        url.searchParams.set('scene', def);
        window.history.replaceState({}, '', url.toString());
        scenePath = def;
        this.dock?.setSelectedBySceneUrl(def);
      } else {
        scenePath = defaultScene;
      }
    }
    this.scenePath = scenePath;

    try {
      this.showLoading();

      const preferredKey = urlParams.get('pc') || urlParams.get('pointcloud') || null;
      const { options, selectedKey } = await this._resolveModelOptions(scenePath, preferredKey);
      this.pcOptions = options;
      this.activeModelKey = selectedKey;

      const pc = await this._loadPointCloudByKey(selectedKey);

      this.hideLoading();
      this.showMain();

      await new Promise((r) => requestAnimationFrame(r));

      if (!this.canvas) {
        throw new Error('Missing #gl-canvas element.');
      }
      this.renderer = new PointCloudRenderer(this.canvas, pc);
      this._bindModelSwitcher();
      this._updateModelQueryParam(this.activeModelKey);

    } catch (err) {
      console.error(err);
      this.showError(err?.message || String(err));
    }
  }

  async _resolveModelOptions(scenePath, preferredKey) {
    const absSceneUrl = new URL(scenePath, window.location.href).toString();
    let options = [];

    try {
      const manifest = await fetchJson(absSceneUrl);
      options = normalizePointCloudOptions(manifest, absSceneUrl);
    } catch (err) {
      console.warn('Model options manifest parse failed, falling back to direct point cloud load:', err);
    }

    if (!options.length) {
      return {
        options: [{ key: 'pointcloud', label: 'Point cloud', url: absSceneUrl }],
        selectedKey: 'pointcloud',
      };
    }

    const keySet = new Set(options.map((o) => String(o.key).toLowerCase()));
    if (keySet.has('vigt') && keySet.has('gt')) {
      const gt = options.find((o) => String(o.key).toLowerCase() === 'gt');
      const vigt = options.find((o) => String(o.key).toLowerCase() === 'vigt');
      options = [gt, vigt].filter(Boolean);
    }

    const keys = options.map((o) => o.key);
    const preferredMatch = preferredKey
      ? keys.find((k) => String(k).toLowerCase() === String(preferredKey).toLowerCase())
      : '';
    const picked = preferredMatch || (keys.find((k) => String(k).toLowerCase() === 'vigt') || keys[0]);

    return {
      options,
      selectedKey: picked,
    };
  }

  _bindModelSwitcher() {
    if (!this.pcSwitchEl || !this.pcModelBtnGtEl || !this.pcModelBtnVigtEl) return;

    const gtOpt = this.pcOptions.find((o) => String(o.key).toLowerCase() === 'gt') || null;
    const vigtOpt = this.pcOptions.find((o) => String(o.key).toLowerCase() === 'vigt') || null;
    const fallback = this.pcOptions.slice(0, 2);
    const leftOpt = gtOpt || fallback[0] || null;
    const rightOpt = vigtOpt || fallback[1] || null;
    const slots = [
      { btn: this.pcModelBtnGtEl, opt: leftOpt, modelClass: 'gt' },
      { btn: this.pcModelBtnVigtEl, opt: rightOpt, modelClass: 'vigt' },
    ];

    const setBusy = (busy) => {
      this.pcSwitchEl.classList.toggle('is-busy', busy);
      slots.forEach(({ btn, opt }) => {
        btn.disabled = busy || !opt;
      });
    };

    const render = () => {
      slots.forEach(({ btn, opt, modelClass }) => {
        if (!opt) {
          btn.hidden = true;
          btn.dataset.key = '';
          btn.classList.remove('is-active');
          btn.setAttribute('aria-pressed', 'false');
          return;
        }
        btn.hidden = false;
        btn.textContent = opt.label || opt.key;
        btn.dataset.key = opt.key;
        btn.dataset.model = modelClass;
        const selected = opt.key === this.activeModelKey;
        btn.classList.toggle('is-active', selected);
        btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    };

    const onClick = async (btn) => {
      const nextKey = btn.dataset.key || '';
      if (!nextKey || nextKey === this.activeModelKey) return;
      const prevKey = this.activeModelKey;
      setBusy(true);
      try {
        const data = await this._loadPointCloudByKey(nextKey);
        this.renderer?.updatePointCloud?.(data);
        this.activeModelKey = nextKey;
        this._updateModelQueryParam(nextKey);
      } catch (err) {
        console.error('Point cloud switch failed:', err);
        this.activeModelKey = prevKey;
      } finally {
        setBusy(false);
        render();
      }
    };

    this.pcModelBtnGtEl.addEventListener('click', () => onClick(this.pcModelBtnGtEl));
    this.pcModelBtnVigtEl.addEventListener('click', () => onClick(this.pcModelBtnVigtEl));

    render();
    setBusy(false);
  }

  async _loadPointCloudByKey(key) {
    const opt = this.pcOptions.find((o) => o.key === key) || null;
    if (!opt) throw new Error(`Unknown pointcloud key: ${key}`);
    const url = opt.url;
    if (this.pcCacheByUrl.has(url)) {
      return this.pcCacheByUrl.get(url);
    }
    const data = await loadPointCloudData(url);
    this.pcCacheByUrl.set(url, data);
    return data;
  }

  _updateModelQueryParam(key) {
    const url = new URL(window.location.href);
    if (!key) {
      url.searchParams.delete('pc');
      url.searchParams.delete('pointcloud');
    } else {
      url.searchParams.set('pc', key);
      url.searchParams.delete('pointcloud');
    }
    window.history.replaceState({}, '', url.toString());
  }

  _bindSceneMenuToggle() {
    if (!this.sceneMenuToggleBtnEl) return;
    this.sceneMenuToggleBtnEl.addEventListener('click', () => {
      this._setSceneMenuVisible(!this.isSceneMenuVisible, { syncQuery: true });
    });
  }

  _setSceneMenuVisible(visible, { syncQuery = true } = {}) {
    const nextVisible = !!visible;
    this.isSceneMenuVisible = nextVisible;
    if (this.contextDockEl) {
      this.contextDockEl.hidden = !nextVisible;
      this.contextDockEl.style.display = nextVisible ? '' : 'none';
    }
    if (this.sceneMenuToggleBtnEl) {
      this.sceneMenuToggleBtnEl.textContent = nextVisible ? 'Hide scenes' : 'Show scenes';
      this.sceneMenuToggleBtnEl.setAttribute('aria-pressed', nextVisible ? 'true' : 'false');
      this.sceneMenuToggleBtnEl.title = nextVisible
        ? 'Hide scene selection menu'
        : 'Show scene selection menu';
    }
    if (syncQuery) {
      this._updateSceneMenuQueryParam(nextVisible);
    }
  }

  _setSceneMenuToggleEnabled(enabled) {
    if (!this.sceneMenuToggleBtnEl) return;
    const canToggle = !!enabled;
    this.sceneMenuToggleBtnEl.disabled = !canToggle;
    if (!canToggle) {
      this.sceneMenuToggleBtnEl.textContent = 'Scenes unavailable';
      this.sceneMenuToggleBtnEl.setAttribute('aria-pressed', 'false');
    }
  }

  _updateSceneMenuQueryParam(visible) {
    const url = new URL(window.location.href);
    url.searchParams.set('sceneMenu', visible ? '1' : '0');
    url.searchParams.delete('scene_menu');
    window.history.replaceState({}, '', url.toString());
  }

  showLoading() {
    this.loadingEl && this.loadingEl.classList.remove('hidden');
    this.mainEl && this.mainEl.classList.add('hidden');
    this.errorEl && this.errorEl.classList.add('hidden');
  }

  hideLoading() {
    this.loadingEl && this.loadingEl.classList.add('hidden');
  }

  showMain() {
    this.mainEl && this.mainEl.classList.remove('hidden');
  }

  showError(msg) {
    this.loadingEl && this.loadingEl.classList.add('hidden');
    this.mainEl && this.mainEl.classList.add('hidden');
    this.errorEl && this.errorEl.classList.remove('hidden');
    this.errorMsgEl && (this.errorMsgEl.textContent = msg);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
