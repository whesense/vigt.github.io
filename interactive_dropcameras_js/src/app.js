import {
  DEFAULT_BEV_BOUNDS,
  DEFAULT_ORIENTATION,
  buildCameraWedgePx,
  drawBlindAreaMaskNoClear,
  drawDimMaskSelectedNoClear,
  drawWedgeOutlinesNoClear,
  hitTestWedges,
} from "./frustums.js";
import { InfiniteStrip } from "../../shared/InfiniteStrip.js";
import { DatasetFrameDock } from "../../shared/DatasetFrameDock.js";
import { detectCameraDataset, orderCameraNamesForUi } from "../../shared/cameraOrder.js";

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function displayCamName(cam) {
  return String(cam ?? "");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  return await res.json();
}

function resolveUrl(pathOrUrl, baseUrl) {
  if (!pathOrUrl) return null;
  return new URL(pathOrUrl, baseUrl).toString();
}

function normalizeMetaForFrustums(meta) {
  const out = { ...(meta || {}) };
  const cameras = out.cameras || {};
  const normalized = {};

  for (const [cam, pose] of Object.entries(cameras)) {
    if (!pose || typeof pose !== "object") continue;
    const t = pose.t || pose.translation || pose.sensor2ego_translation;
    const q =
      pose.q ||
      pose.quaternion_wxyz ||
      pose.sensor2ego_quaternion_wxyz ||
      pose.quaternion;
    let fov = pose.fov;
    if (!Number.isFinite(fov)) fov = pose.fovx_rad;
    if (!Number.isFinite(fov) && Number.isFinite(pose.fovx_deg)) fov = (pose.fovx_deg * Math.PI) / 180;

    if (
      Array.isArray(t) &&
      t.length >= 2 &&
      Array.isArray(q) &&
      q.length === 4 &&
      Number.isFinite(fov)
    ) {
      normalized[cam] = { t, q, fov };
    }
  }

  out.cameras = normalized;
  if (!Array.isArray(out.viz_camera_order) || out.viz_camera_order.length === 0) {
    out.viz_camera_order = Object.keys(normalized);
  }
  if (!Array.isArray(out.camera_order) || out.camera_order.length === 0) {
    out.camera_order = Object.keys(normalized);
  }
  if (!out.quat_convention) out.quat_convention = "wxyz";
  return out;
}

function setCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { width: w, height: h, dpr };
}

function getPointerInCanvas(ev, canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = (ev.clientX - rect.left) * dpr;
  const y = (ev.clientY - rect.top) * dpr;
  return { x, y };
}

function getContainedImageRectCss(imgEl, stageWidthCss, stageHeightCss) {
  const iw = imgEl.naturalWidth || 1;
  const ih = imgEl.naturalHeight || 1;
  const scale = Math.min(stageWidthCss / iw, stageHeightCss / ih);
  const w = iw * scale;
  const h = ih * scale;
  const x = (stageWidthCss - w) / 2;
  const y = (stageHeightCss - h) / 2;
  return { x, y, width: w, height: h };
}

class DropCamerasApp {
  constructor() {
    this.cameraStripEl = $("camera-strip");
    this.imgAll = $("img-all");
    this.imgSelected = $("img-selected");
    this.overlayAll = $("overlay-all");
    this.overlaySelected = $("overlay-selected");
    this.selectedLabel = $("selected-label");

    /** @type {any} */
    this.meta = null;
    /** @type {string[]} */
    this.cams = [];
    /** @type {string} */
    this.selectedCam = "";
    /** @type {InfiniteStrip|null} */
    this.strip = null;

    this.lengthMeters = 15.0;
    this.bounds = DEFAULT_BEV_BOUNDS;
    this.dimAlpha = 0.50;

    // If overlays appear mirrored, tweak these.
    this.orient = { ...DEFAULT_ORIENTATION };

    this._wedgesAll = [];
    this._wedgesSelected = [];
    this._rectAll = null; // device px rect of displayed image within overlay canvas
    this._rectSelected = null;

    this._resizeObserver = null;

    this.sceneConfig = {
      allImage: null,
      cameraMetaFile: null,
      cameraImages: {},
      cameraThumbImages: {},
      cameraOverlayMap: {},
      cameraOrder: null,
    };
    this.dock = null;
  }

  async init() {
    await this._loadSceneConfigFromUrl();

    // Images
    this.imgAll.src = this.sceneConfig.allImage;

    // Metadata: generated from metadata.npz.npy by python script
    const metaUrl = this.sceneConfig.cameraMetaFile;
    this.meta = normalizeMetaForFrustums(await fetchJson(metaUrl));

    this.cams =
      (Array.isArray(this.sceneConfig.cameraOrder) && this.sceneConfig.cameraOrder.length > 0
        ? this.sceneConfig.cameraOrder
        : null) ||
      (Array.isArray(this.meta.viz_camera_order) ? this.meta.viz_camera_order : Object.keys(this.meta.cameras || {}));

    const datasetHint =
      this.meta?.dataset || this.meta?.dataset_name || this.meta?.datasetName || detectCameraDataset(this.cams);
    const helperOrder = orderCameraNamesForUi(this.cams, datasetHint);
    const helperReordered =
      Array.isArray(helperOrder) &&
      helperOrder.length === this.cams.length &&
      helperOrder.some((name, idx) => name !== this.cams[idx]);
    if (helperReordered) {
      this.cams = helperOrder;
    }

    if (this.cams.length === 0) throw new Error("No cameras found in metadata.json");
    const missingCameraImages = this.cams.filter((cam) => !this.sceneConfig.cameraImages?.[cam]);
    if (missingCameraImages.length > 0) {
      throw new Error(
        `Missing camera_images entries for: ${missingCameraImages.join(", ")}`
      );
    }

    // Optional bounds override from metadata.json
    if (this.meta.bounds?.x && this.meta.bounds?.y) {
      const [x0, x1] = this.meta.bounds.x;
      const [y0, y1] = this.meta.bounds.y;
      // Note: bounds are in BEV coords after world->bev mapping. For symmetric [-40,40] it's same.
      this.bounds = { xmin: x0, xmax: x1, ymin: y0, ymax: y1 };
    }

    // Default selection: front center if present; else first.
    this.selectedCam = this.cams.includes("ring_front_center") ? "ring_front_center" : this.cams[0];
    this._applySelection();
    this._initCameraStrip();

    // Ensure overlays are always aligned with the rendered image area.
    this._setupResizeHandling();

    // Frustum click interaction on both panels
    this.overlayAll.addEventListener("click", (ev) =>
      this._onOverlayClick(ev, this.overlayAll, this._wedgesAll, this._rectAll)
    );
    this.overlaySelected.addEventListener("click", (ev) =>
      this._onOverlayClick(ev, this.overlaySelected, this._wedgesSelected, this._rectSelected)
    );

    // Redraw once images have dimensions
    this.imgAll.addEventListener("load", () => this.renderOverlays());
    this.imgSelected.addEventListener("load", () => this.renderOverlays());

    // First draw
    this.renderOverlays();
  }

  _setupResizeHandling() {
    const redraw = () => this.renderOverlays();
    window.addEventListener("resize", redraw);

    // ResizeObserver gives tighter alignment when panels change size
    if ("ResizeObserver" in window) {
      this._resizeObserver = new ResizeObserver(() => redraw());
      this._resizeObserver.observe(this.overlayAll);
      this._resizeObserver.observe(this.overlaySelected);
    }
  }

  _buildCameraStrip() {
    // Deprecated in favor of InfiniteStrip-based _initCameraStrip().
  }

  _initCameraStrip() {
    const items = this.cams.map((cam) => ({
      key: cam,
      src: this._cameraThumbSrc(cam),
      label: displayCamName(cam),
    }));

    // Clear and rebuild
    this.cameraStripEl.innerHTML = "";
    this.strip?.destroy?.();

    this.strip = new InfiniteStrip(this.cameraStripEl, items, {
      key: (it) => it.key,
      itemClass: "cameraButton",
      selectedClass: "cameraButton--selected",
      // Requested: drop app should stay finite (no infinite wrap).
      alwaysPannable: false,
      wheelPan: false,
      maxSegments: 1,
      enableInfinite: false,
      createItemContainer: (it) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = it.key;
        return btn;
      },
      onItemClick: (it) => {
        if (it.key === this.selectedCam) return;
        this.selectedCam = it.key;
        this._applySelection();
        this.strip?.setSelected(this.selectedCam);
        this.renderOverlays();
      },
      renderMainItem: (el, it) => {
        const img = document.createElement("img");
        img.className = "cameraButton__img";
        img.alt = `Camera ${it.label}`;
        img.loading = "lazy";
        img.decoding = "async";
        img.fetchPriority = "low";
        img.src = it.src;

        const label = document.createElement("div");
        label.className = "cameraButton__label";
        label.textContent = it.label;

        el.appendChild(img);
        el.appendChild(label);
      },
    });

    this.strip.setSelected(this.selectedCam);
  }

  _applySelection() {
    const overlay = this.sceneConfig.cameraOverlayMap?.[this.selectedCam];
    this.imgSelected.src = overlay || this._cameraImageSrc(this.selectedCam);
    this.selectedLabel.textContent = displayCamName(this.selectedCam);
  }

  _cameraImageSrc(cam) {
    const src = this.sceneConfig.cameraImages?.[cam];
    if (!src) {
      throw new Error(`Missing camera image for '${cam}' in dropcameras scene manifest.`);
    }
    return src;
  }

  _cameraThumbSrc(cam) {
    return this.sceneConfig.cameraThumbImages?.[cam] || this._cameraImageSrc(cam);
  }

  async _loadSceneConfigFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const sceneManifestPath = params.get("scene");
    if (!sceneManifestPath) {
      throw new Error(
        "No canonical scene manifest provided. Pass ?scene=../artifacts/.../manifests/dropcameras.scene.json or choose a scene from the dock."
      );
    }

    const manifestUrl = new URL(sceneManifestPath, window.location.href);
    const scene = await fetchJson(manifestUrl.toString());
    if (!scene.all_image || !scene.camera_meta_file) {
      throw new Error(
        "Invalid dropcameras scene manifest: expected all_image and camera_meta_file."
      );
    }

    const resolvedCameraImages = {};
    for (const [cam, p] of Object.entries(scene.camera_images || {})) {
      resolvedCameraImages[cam] = resolveUrl(p, manifestUrl);
    }
    if (Object.keys(resolvedCameraImages).length === 0) {
      throw new Error("Invalid dropcameras scene manifest: camera_images is required.");
    }

    const resolvedThumbImages = {};
    for (const [cam, p] of Object.entries(scene.camera_thumb_images || {})) {
      resolvedThumbImages[cam] = resolveUrl(p, manifestUrl);
    }

    const resolvedOverlayMap = {};
    for (const [cam, p] of Object.entries(scene.camera_overlay_map || {})) {
      resolvedOverlayMap[cam] = resolveUrl(p, manifestUrl);
    }

    this.sceneConfig = {
      allImage: resolveUrl(scene.all_image, manifestUrl),
      cameraMetaFile: resolveUrl(scene.camera_meta_file, manifestUrl),
      cameraImages: resolvedCameraImages,
      cameraThumbImages: resolvedThumbImages,
      cameraOverlayMap: resolvedOverlayMap,
      cameraOrder: Array.isArray(scene.camera_order) ? scene.camera_order : null,
    };
  }

  _onOverlayClick(ev, canvas, wedges, rect) {
    if (!rect) return;
    const { x, y } = getPointerInCanvas(ev, canvas);
    // Convert to local coords inside the displayed image rectangle (object-fit: contain)
    const lx = x - rect.x;
    const ly = y - rect.y;
    if (lx < 0 || ly < 0 || lx > rect.width || ly > rect.height) return;

    const cam = hitTestWedges(wedges, lx, ly);
    if (!cam) return;
    if (cam === this.selectedCam) return;
    this.selectedCam = cam;
    this._applySelection();
    this.strip?.setSelected(this.selectedCam);
    this.renderOverlays();
  }

  _computeWedgesForCanvas(canvas, imgEl) {
    const { width, height, dpr } = setCanvasToDisplaySize(canvas);
    // Compute the actual displayed image rectangle in the stage (CSS px), then convert to device px.
    const rectCss = getContainedImageRectCss(imgEl, canvas.clientWidth || 1, canvas.clientHeight || 1);
    const rect = {
      x: rectCss.x * dpr,
      y: rectCss.y * dpr,
      width: rectCss.width * dpr,
      height: rectCss.height * dpr,
    };

    const quatConvention = this.meta.quat_convention || "wxyz";
    const wedges = [];
    for (const cam of this.cams) {
      const pose = this.meta.cameras?.[cam];
      if (!pose) continue;
      wedges.push(
        buildCameraWedgePx(cam, pose, rect.width, rect.height, {
          bounds: this.bounds,
          orient: this.orient,
          lengthMeters: this.lengthMeters,
          quatConvention,
        })
      );
    }
    return { wedges, rect, canvasSize: { width, height } };
  }

  renderOverlays() {
    // Keep overlays aligned: set canvas internal size to CSS size * dpr.
    const all = this._computeWedgesForCanvas(this.overlayAll, this.imgAll);
    const sel = this._computeWedgesForCanvas(this.overlaySelected, this.imgSelected);
    this._wedgesAll = all.wedges;
    this._rectAll = all.rect;
    this._wedgesSelected = sel.wedges;
    this._rectSelected = sel.rect;

    const ctxAll = this.overlayAll.getContext("2d");
    const ctxSel = this.overlaySelected.getContext("2d");
    if (!ctxAll || !ctxSel) return;

    // Clear full canvas then draw wedges *only over the displayed image area*
    ctxAll.setTransform(1, 0, 0, 1, 0, 0);
    ctxAll.clearRect(0, 0, ctxAll.canvas.width, ctxAll.canvas.height);
    ctxAll.save();
    ctxAll.translate(this._rectAll.x, this._rectAll.y);
    // Dim only blind areas on full surround (outside camera coverage).
    drawBlindAreaMaskNoClear(ctxAll, this._wedgesAll, this.dimAlpha, {
      width: this._rectAll.width,
      height: this._rectAll.height,
    });
    drawWedgeOutlinesNoClear(ctxAll, this._wedgesAll, this.selectedCam, { selectedFillAlpha: 0 });
    ctxAll.restore();

    ctxSel.setTransform(1, 0, 0, 1, 0, 0);
    ctxSel.clearRect(0, 0, ctxSel.canvas.width, ctxSel.canvas.height);
    ctxSel.save();
    ctxSel.translate(this._rectSelected.x, this._rectSelected.y);
    // Limit dimming to the displayed image rect; otherwise letterbox space below gets extra dim.
    drawDimMaskSelectedNoClear(ctxSel, this._wedgesSelected, this.selectedCam, this.dimAlpha, {
      width: this._rectSelected.width,
      height: this._rectSelected.height,
    });
    drawWedgeOutlinesNoClear(ctxSel, this._wedgesSelected, this.selectedCam);
    ctxSel.restore();
  }
}

// Boot
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const app = new DropCamerasApp();
    const dockContainer = document.getElementById("context-dock");
    if (dockContainer) {
      try {
        app.dock = new DatasetFrameDock(dockContainer, { demoKey: "dropcameras" });
        await app.dock.init();
      } catch (err) {
        console.warn("Dataset dock init failed:", err);
        app.dock = null;
      }
    }

    const urlParams = new URLSearchParams(window.location.search);
    let scenePath = urlParams.get("scene");
    if (scenePath) {
      app.dock?.setSelectedBySceneUrl(scenePath);
    } else {
      const def = app.dock?.getDefaultSceneUrl?.() || null;
      if (def) {
        const url = new URL(window.location.href);
        url.searchParams.set("scene", def);
        window.history.replaceState({}, "", url.toString());
        scenePath = def;
        app.dock?.setSelectedBySceneUrl(def);
      } else {
        throw new Error(
          "No canonical scene manifest provided. Pass ?scene=../artifacts/.../manifests/dropcameras.scene.json or configure a default in the dock."
        );
      }
    }

    await app.init();
    // Expose for quick debugging/tweaks in console:
    window.__dropcams = app;
  } catch (err) {
    console.error(err);
    const div = document.createElement("div");
    div.style.padding = "14px";
    div.style.color = "white";
    div.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
    div.textContent = `Error: ${err?.message || String(err)}`;
    document.body.appendChild(div);
  }
});
