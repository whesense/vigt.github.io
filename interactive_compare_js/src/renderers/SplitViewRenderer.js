/**
 * Two-canvas compare renderer (robust across browsers):
 * - left canvas: occupancy voxels (with controls)
 * - right canvas: point cloud (camera pose synced from left every frame)
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { turboColormap, normalizeHeight } from '../utils/turboColormap.js';

const FLIP_LEFT_RIGHT = true;

function sizeCanvasRenderer(renderer, canvas) {
  const rect = canvas.getBoundingClientRect();
  const wCss = Math.max(1, Math.floor(rect.width));
  const hCss = Math.max(1, Math.floor(rect.height));
  renderer.setSize(wCss, hCss, false);
  return { wCss, hCss };
}

function visualizeOccupancyWithCubes(occupancy, gridShape, bounds, threshold = 0.01) {
  const [nx, ny, nz] = gridShape;
  const [xMin, xMax] = bounds.x;
  const [yMin, yMax] = bounds.y;
  const [zMin, zMax] = bounds.z;

  const zFilterMin = -1.0;
  const zFilterMax = 3.5;

  const voxelSizeX = (xMax - xMin) / nx;
  const voxelSizeY = (yMax - yMin) / ny;
  const voxelSizeZ = (zMax - zMin) / nz;

  const binSize = 0.1;
  const voxelsByZBin = new Map();

  // CORRECT INDEXING: z + y*nz + x*nz*ny
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const idx = z + y * nz + x * nz * ny;
        const p = occupancy[idx];
        if (p <= threshold) continue;

        const worldZ = zMin + (z + 0.5) * voxelSizeZ;
        if (worldZ < zFilterMin || worldZ > zFilterMax) continue;

        const zBin = Math.floor(worldZ / binSize);
        let arr = voxelsByZBin.get(zBin);
        if (!arr) {
          arr = [];
          voxelsByZBin.set(zBin, arr);
        }
        arr.push({ x, y, z, worldZ });
      }
    }
  }

  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Matrix4();

  voxelsByZBin.forEach((voxels, zBin) => {
    const cubeCount = voxels.length;
    if (!cubeCount) return;

    const avgWorldZ = voxels[0].worldZ;
    const t = Math.max(0, Math.min(1, (avgWorldZ - zFilterMin) / (zFilterMax - zFilterMin)));
    const [r, g, b] = turboColormap(t);

    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(r, g, b),
      side: THREE.DoubleSide,
    });

    const instanced = new THREE.InstancedMesh(geometry, material, cubeCount);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < cubeCount; i++) {
      const { x, y, z, worldZ } = voxels[i];

      // Match occupancy 3D convention: swap X/Y for BEV yx view.
      const worldX = yMin + (y + 0.5) * voxelSizeY;
      const worldY = xMin + (x + 0.5) * voxelSizeX;

      matrix.makeScale(voxelSizeY, voxelSizeX, voxelSizeZ);
      matrix.setPosition(worldX, worldY, worldZ);
      instanced.setMatrixAt(i, matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
    group.add(instanced);
  });

  return group;
}

function buildPointCloud(points, count, bounds) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));

  // Keep a height color attribute around for later; for now render in a distinct flat color
  // so it's visually obvious this panel is point-based (not voxels).
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
    // Pixel-sized points so they stay visible regardless of camera distance.
    size: 2.0,
    sizeAttenuation: false,
    // Use a distinct flat color for clarity; we can switch back to vertexColors later.
    color: 0x66ccff,
    vertexColors: false,
    transparent: true,
    opacity: 0.95,
  });

  const pts = new THREE.Points(geometry, material);
  if (FLIP_LEFT_RIGHT) {
    pts.scale.x = -1;
  }
  return pts;
}

export class SplitViewRenderer {
  constructor(canvasLeft, canvasRight, occupancyData, pointCloudData) {
    this.canvasLeft = canvasLeft;
    this.canvasRight = canvasRight;
    this.occ = occupancyData;
    this.pc = pointCloudData;

    this.rendererLeft = null;
    this.rendererRight = null;

    this.cameraLeft = null;
    this.cameraRight = null;
    this.controls = null; // attached to left canvas

    this.sceneOcc = new THREE.Scene();
    this.scenePc = new THREE.Scene();

    this.animationId = null;
    this._resizeObserver = null;
    this._resizeRaf = 0;
    this._lastCssSizes = { lW: 0, lH: 0, rW: 0, rH: 0 };

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
    this.rendererLeft = new THREE.WebGLRenderer({
      canvas: this.canvasLeft,
      antialias: true,
      // Opaque canvases avoid accidental visual blending if layout ever overlaps.
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.rendererLeft.setPixelRatio(window.devicePixelRatio || 1);
    this.rendererLeft.setClearColor(0x1a1a1a, 1.0);

    this.rendererRight = new THREE.WebGLRenderer({
      canvas: this.canvasRight,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.rendererRight.setPixelRatio(window.devicePixelRatio || 1);
    this.rendererRight.setClearColor(0x1a1a1a, 1.0);

    this.sceneOcc.background = new THREE.Color(0x1a1a1a);
    this.scenePc.background = new THREE.Color(0x1a1a1a);

    // Camera based on occupancy bounds (shared convention with xy swap)
    const { bounds } = this.occ;
    const centerX = (bounds.x[0] + bounds.x[1]) / 2;
    const centerY = (bounds.y[0] + bounds.y[1]) / 2;

    const sizeX = bounds.x[1] - bounds.x[0];
    const sizeY = bounds.y[1] - bounds.y[0];
    const sizeZ = bounds.z[1] - bounds.z[0];
    const maxSize = Math.max(sizeX, sizeY, sizeZ);

    this.cameraLeft = new THREE.PerspectiveCamera(50, 1, 0.1, maxSize * 20 + 100);
    this.cameraLeft.up.set(0, 0, 1);

    this.cameraRight = new THREE.PerspectiveCamera(50, 1, 0.1, maxSize * 20 + 100);
    this.cameraRight.up.set(0, 0, 1);

    const eyeHeight = 1.5;
    this.cameraLeft.position.set(centerY, centerX, eyeHeight);
    this.cameraLeft.lookAt(centerY, centerX + sizeX * 0.3, eyeHeight);

    this.cameraRight.position.copy(this.cameraLeft.position);
    this.cameraRight.quaternion.copy(this.cameraLeft.quaternion);

    this.controls = new OrbitControls(this.cameraLeft, this.rendererLeft.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(centerY, centerX + sizeX * 0.3, eyeHeight);
    this.controls.enableRotate = true;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;

    // Build scenes
    const occGroup = visualizeOccupancyWithCubes(
      this.occ.occupancy,
      this.occ.gridShape,
      this.occ.bounds,
      0.01
    );
    if (FLIP_LEFT_RIGHT) {
      occGroup.scale.x = -1;
    }
    this.sceneOcc.add(occGroup);

    const pcObj = buildPointCloud(this.pc.points, this.pc.count, this.pc.bounds);
    this.scenePc.add(pcObj);
    console.log('Pointcloud:', { count: this.pc.count, bounds: this.pc.bounds, source: this.pc.source });

    // Add axes so it's obvious where the camera is looking.
    this.sceneOcc.add(new THREE.AxesHelper(5));
    this.scenePc.add(new THREE.AxesHelper(5));

    // Key listeners
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
    this.animate();
  }

  _installResizeObserver() {
    // In iframes, element size changes often do NOT trigger window.resize inside the iframe.
    // ResizeObserver makes WebGL sizing robust to embed/layout changes.
    if (!('ResizeObserver' in window)) return;
    const schedule = () => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = 0;
        this.onResize();
      });
    };
    this._resizeObserver = new ResizeObserver(() => schedule());
    this._resizeObserver.observe(this.canvasLeft);
    this._resizeObserver.observe(this.canvasRight);
    if (this.canvasLeft.parentElement) this._resizeObserver.observe(this.canvasLeft.parentElement);
    if (this.canvasRight.parentElement) this._resizeObserver.observe(this.canvasRight.parentElement);
  }

  onResize() {
    const left = sizeCanvasRenderer(this.rendererLeft, this.canvasLeft);
    const right = sizeCanvasRenderer(this.rendererRight, this.canvasRight);

    this.cameraLeft.aspect = left.wCss / left.hCss;
    this.cameraLeft.updateProjectionMatrix();
    this.cameraRight.aspect = right.wCss / right.hCss;
    this.cameraRight.updateProjectionMatrix();

    this._lastCssSizes = { lW: left.wCss, lH: left.hCss, rW: right.wCss, rH: right.hCss };
  }

  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    // Fallback safety: if embed/layout changes slip past ResizeObserver, resize here.
    // This is cheap because it only triggers when CSS sizes actually changed.
    const lRect = this.canvasLeft.getBoundingClientRect();
    const rRect = this.canvasRight.getBoundingClientRect();
    const lW = Math.max(1, Math.floor(lRect.width));
    const lH = Math.max(1, Math.floor(lRect.height));
    const rW = Math.max(1, Math.floor(rRect.width));
    const rH = Math.max(1, Math.floor(rRect.height));
    const s = this._lastCssSizes;
    if (lW !== s.lW || lH !== s.lH || rW !== s.rW || rH !== s.rH) {
      this.onResize();
    }

    const direction = new THREE.Vector3();
    const right = new THREE.Vector3();
    this.cameraLeft.getWorldDirection(direction);
    right.crossVectors(direction, this.cameraLeft.up).normalize();

    if (this.keys.ArrowUp || this.keys.KeyW) {
      this.cameraLeft.position.addScaledVector(direction, this.moveSpeed);
      this.controls.target.addScaledVector(direction, this.moveSpeed);
    }
    if (this.keys.ArrowDown || this.keys.KeyS) {
      this.cameraLeft.position.addScaledVector(direction, -this.moveSpeed);
      this.controls.target.addScaledVector(direction, -this.moveSpeed);
    }
    if (this.keys.ArrowLeft || this.keys.KeyA) {
      this.cameraLeft.position.addScaledVector(right, -this.moveSpeed);
      this.controls.target.addScaledVector(right, -this.moveSpeed);
    }
    if (this.keys.ArrowRight || this.keys.KeyD) {
      this.cameraLeft.position.addScaledVector(right, this.moveSpeed);
      this.controls.target.addScaledVector(right, this.moveSpeed);
    }
    if (this.keys.KeyQ || this.keys.KeyE) {
      const upAxis = this.cameraLeft.up;
      const angle = this.keys.KeyQ ? this.rotateSpeed : -this.rotateSpeed;
      const lookOffset = new THREE.Vector3().subVectors(this.controls.target, this.cameraLeft.position);
      lookOffset.applyAxisAngle(upAxis, angle);
      this.controls.target.copy(this.cameraLeft.position).add(lookOffset);
    }

    this.controls.update();

    // Sync right camera pose from left (shared controls feel).
    this.cameraRight.position.copy(this.cameraLeft.position);
    this.cameraRight.quaternion.copy(this.cameraLeft.quaternion);

    this.rendererLeft.render(this.sceneOcc, this.cameraLeft);
    this.rendererRight.render(this.scenePc, this.cameraRight);
  }
}
