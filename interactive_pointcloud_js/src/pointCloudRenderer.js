/**
 * Three.js point cloud renderer (aligned with compare demo point rendering).
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { turboColormap, normalizeHeight } from './utils/turboColormap.js';

const FLIP_LEFT_RIGHT = true;
const BASE_VFOV_DEG = 50;
const BASE_ASPECT = 16 / 9;
const BASE_HFOV_RAD = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_VFOV_DEG) / 2) * BASE_ASPECT);

function sizeCanvasRenderer(renderer, canvas) {
  const rect = canvas.getBoundingClientRect();
  const wCss = Math.max(1, Math.floor(rect.width));
  const hCss = Math.max(1, Math.floor(rect.height));
  renderer.setSize(wCss, hCss, false);
  return { wCss, hCss };
}

function applyCameraFov(camera, aspect) {
  if (!camera || !Number.isFinite(aspect) || aspect <= 0) return;
  const safeAspect = Math.max(0.01, aspect);
  const vFovRad = 2 * Math.atan(Math.tan(BASE_HFOV_RAD / 2) / safeAspect);
  camera.fov = THREE.MathUtils.radToDeg(vFovRad);
  camera.aspect = safeAspect;
  camera.updateProjectionMatrix();
}

function getBoundsOrFallback(bounds, points, count) {
  if (bounds?.x && bounds?.y && bounds?.z) return bounds;

  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = points[i * 3 + 0];
    const y = points[i * 3 + 1];
    const z = points[i * 3 + 2];
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }
  return { x: [xMin, xMax], y: [yMin, yMax], z: [zMin, zMax] };
}

function normalizePointCloudForRender(data) {
  const count = data.count;
  const points = data.points;
  const conv = data.convention || {};
  const wantsSwap = !!conv.xy_swap;
  const dataIsSwapped = conv.data_is_swapped !== false;

  let positions = points;
  let bounds = getBoundsOrFallback(data.bounds, points, count);
  if (wantsSwap && !dataIsSwapped) {
    const tmp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      tmp[i * 3 + 0] = points[i * 3 + 1];
      tmp[i * 3 + 1] = points[i * 3 + 0];
      tmp[i * 3 + 2] = points[i * 3 + 2];
    }
    positions = tmp;
    if (data.bounds?.x && data.bounds?.y && data.bounds?.z) {
      bounds = { x: bounds.y, y: bounds.x, z: bounds.z };
    } else {
      bounds = getBoundsOrFallback(null, positions, count);
    }
  }

  const centerX = (bounds.x[0] + bounds.x[1]) / 2;
  const centerY = (bounds.y[0] + bounds.y[1]) / 2;
  const sizeX = bounds.x[1] - bounds.x[0];
  const sizeY = bounds.y[1] - bounds.y[0];
  const sizeZ = bounds.z[1] - bounds.z[0];
  const maxSize = Math.max(sizeX, sizeY, sizeZ);

  return {
    count,
    positions,
    bounds,
    centerX,
    centerY,
    sizeX,
    maxSize,
  };
}

function buildPointCloud(points, count, bounds, opts = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));

  // Keep a height color attribute around for quick debugging.
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = points[i * 3 + 2];
    const t = normalizeHeight(z, bounds.z);
    const [r, g, b] = turboColormap(t);
    colors[i * 3 + 0] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.PointsMaterial({
    size: Number(opts.size ?? 2.0),
    sizeAttenuation: false,
    color: opts.color ?? 0x66ccff,
    vertexColors: Boolean(opts.vertexColors ?? false),
    transparent: true,
    opacity: 0.95,
  });

  const pts = new THREE.Points(geometry, material);
  if (FLIP_LEFT_RIGHT) {
    pts.scale.x = -1;
  }
  pts.frustumCulled = false;
  return pts;
}

export class PointCloudRenderer {
  constructor(canvas, pointCloudData) {
    this.canvas = canvas;
    this.data = pointCloudData;

    this.scene = new THREE.Scene();
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    this.pointsObject = null;
    this.pointSize = 2.0;

    this.animationId = null;
    this._resizeObserver = null;
    this._resizeRaf = 0;
    this._lastCssSizes = { w: 0, h: 0 };

    this.moveSpeed = 0.5;
    this.rotateSpeed = 0.02;
    this.keys = {
      ArrowUp: false,
      ArrowDown: false,
      ArrowLeft: false,
      ArrowRight: false,
      KeyW: false,
      KeyA: false,
      KeyS: false,
      KeyD: false,
      KeyQ: false,
      KeyE: false,
    };

    this.init();
  }

  init() {
    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      console.warn('WebGLRenderer init failed (high-performance). Retrying with minimal options.', err);
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          antialias: false,
          alpha: false,
        });
      } catch (err2) {
        console.warn('WebGLRenderer init failed (minimal).', err2);
      }
    }
    if (!renderer) {
      throw new Error('WebGL context could not be created. Check browser WebGL settings.');
    }
    this.renderer = renderer;
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setClearColor(0x1a1a1a, 1.0);

    this.scene.background = new THREE.Color(0x1a1a1a);

    const view = normalizePointCloudForRender(this.data);
    const { count, positions, bounds, centerX, centerY, sizeX, maxSize } = view;

    this.camera = new THREE.PerspectiveCamera(BASE_VFOV_DEG, 1, 0.1, maxSize * 20 + 100);
    this.camera.up.set(0, 0, 1);

    const eyeHeight = 1.5;
    this.camera.position.set(centerY, centerX, eyeHeight);
    this.camera.lookAt(centerY, centerX + sizeX * 0.3, eyeHeight);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(centerY, centerX + sizeX * 0.3, eyeHeight);
    this.controls.enableRotate = true;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;

    this.pointsObject = buildPointCloud(positions, count, bounds, {
      size: this.pointSize,
      color: 0x66ccff,
      vertexColors: false,
    });
    this.scene.add(this.pointsObject);
    this.scene.add(new THREE.AxesHelper(5));

    // Keyboard listeners (match compare demo)
    this.handleKeyDown = (event) => {
      const key = event.code || event.key;
      if (key in this.keys) {
        this.keys[key] = true;
        event.preventDefault();
      }
    };
    this.handleKeyUp = (event) => {
      const key = event.code || event.key;
      if (key in this.keys) {
        this.keys[key] = false;
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    window.addEventListener('resize', () => this.onResize());
    this._installResizeObserver();
    this.onResize();

    console.log('Point cloud loaded:', {
      count,
      bounds,
      source: this.data.source,
      convention: this.data.convention,
    });

    this.animate();
  }

  _installResizeObserver() {
    if (!('ResizeObserver' in window)) return;
    const schedule = () => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = 0;
        this.onResize();
      });
    };
    this._resizeObserver = new ResizeObserver(() => schedule());
    const observe = (el) => { if (el) this._resizeObserver.observe(el); };
    observe(this.canvas);
    observe(this.canvas?.parentElement);
  }

  setPointSize(v) {
    this.pointSize = v;
    if (this.pointsObject?.material) {
      this.pointsObject.material.size = v;
      this.pointsObject.material.needsUpdate = true;
    }
  }

  updatePointCloud(nextData) {
    if (!nextData) return;
    this.data = nextData;
    const view = normalizePointCloudForRender(nextData);
    const { count, positions, bounds, maxSize } = view;

    const nextPointsObject = buildPointCloud(positions, count, bounds, {
      size: this.pointSize,
      color: 0x66ccff,
      vertexColors: false,
    });

    if (this.pointsObject) {
      this.scene.remove(this.pointsObject);
      this.pointsObject.geometry?.dispose?.();
      this.pointsObject.material?.dispose?.();
    }
    this.pointsObject = nextPointsObject;
    this.scene.add(this.pointsObject);

    // Keep camera pose stable, only expand far clip if new data is larger.
    const neededFar = maxSize * 20 + 100;
    if (this.camera && Number.isFinite(neededFar) && neededFar > this.camera.far) {
      this.camera.far = neededFar;
      this.camera.updateProjectionMatrix();
    }

    console.log('Point cloud switched:', {
      count,
      bounds,
      source: nextData.source,
      convention: nextData.convention,
    });
  }

  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    // Cheap per-frame resize check (for iframe/layout edge cases)
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (w !== this._lastCssSizes.w || h !== this._lastCssSizes.h) {
      this.onResize();
    }

    const direction = new THREE.Vector3();
    const right = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    right.crossVectors(direction, this.camera.up).normalize();

    if (this.keys.ArrowUp || this.keys.KeyW) {
      this.camera.position.addScaledVector(direction, this.moveSpeed);
      this.controls.target.addScaledVector(direction, this.moveSpeed);
    }
    if (this.keys.ArrowDown || this.keys.KeyS) {
      this.camera.position.addScaledVector(direction, -this.moveSpeed);
      this.controls.target.addScaledVector(direction, -this.moveSpeed);
    }
    if (this.keys.ArrowLeft || this.keys.KeyA) {
      this.camera.position.addScaledVector(right, -this.moveSpeed);
      this.controls.target.addScaledVector(right, -this.moveSpeed);
    }
    if (this.keys.ArrowRight || this.keys.KeyD) {
      this.camera.position.addScaledVector(right, this.moveSpeed);
      this.controls.target.addScaledVector(right, this.moveSpeed);
    }

    if (this.keys.KeyQ || this.keys.KeyE) {
      const upAxis = this.camera.up;
      const angle = this.keys.KeyQ ? this.rotateSpeed : -this.rotateSpeed;
      const lookOffset = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
      lookOffset.applyAxisAngle(upAxis, angle);
      this.controls.target.copy(this.camera.position).add(lookOffset);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const { wCss, hCss } = sizeCanvasRenderer(this.renderer, this.canvas);
    applyCameraFov(this.camera, wCss / hCss);
    this._lastCssSizes = { w: wCss, h: hCss };
  }
}
