/**
 * Frustum drawing + hit-testing for BEV overlays.
 *
 * Ported from `attention_viz/camera_conuses.py`:
 * - BEV convention: display_x = -world_y, display_y = world_x
 * - Forward direction from quaternion -> rotation matrix -> axis=2 (R[:,2])
 * - Wedge = triangle(origin, origin+rotate(fwd,+half_fov)*L, origin+rotate(fwd,-half_fov)*L)
 */

/**
 * @typedef {{
 *  t: [number, number, number],
 *  q: [number, number, number, number], // (w,x,y,z) by default
 *  fov: number
 * }} CameraPose
 */

/**
 * @typedef {{
 *  xmin: number,
 *  xmax: number,
 *  ymin: number,
 *  ymax: number
 * }} Bounds2D
 */

export const DEFAULT_BEV_BOUNDS = /** @type {Bounds2D} */ ({
  xmin: -40,
  xmax: 40,
  ymin: -40,
  ymax: 40,
});

/**
 * Small alignment knobs in case the rendered image is flipped/rotated relative to BEV bounds.
 * Start with defaults (should match your python BEV overlay). If overlay is mirrored, flip.
 */
export const DEFAULT_ORIENTATION = {
  flipX: false,
  flipY: false,
  yawOffsetRad: 0,
};

function rotate2D(v, angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1]];
}

function normalize2(v) {
  const n = Math.hypot(v[0], v[1]) || 1e-8;
  return [v[0] / n, v[1] / n];
}

function normalize4(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1e-8;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/**
 * Quaternion (w,x,y,z) -> 3x3 rotation matrix.
 * Matches python `_quat_to_rotation_matrix` for quat_convention='wxyz'.
 */
function quatWxyzToMat3(qWxyz) {
  const [w, x, y, z] = normalize4(qWxyz);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

/**
 * Forward vector from rotation matrix using axis=2 like python `R[:, axis]`.
 */
function forwardFromMat3(R, axis = 2) {
  const fwd = [R[0][axis], R[1][axis], R[2][axis]];
  const n = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1e-8;
  return [fwd[0] / n, fwd[1] / n, fwd[2] / n];
}

/**
 * World xy -> BEV xy with python convention: [-y, x]
 */
function worldToBev(worldXY) {
  return [-worldXY[1], worldXY[0]];
}

function rayIntersectBounds2D(origin, dir, bounds) {
  // Returns intersection point of ray origin + t*dir with AABB bounds, for smallest t>0.
  // If no valid intersection, returns null.
  const { xmin, xmax, ymin, ymax } = bounds;
  const ox = origin[0];
  const oy = origin[1];
  const dx = dir[0];
  const dy = dir[1];

  /** @type {{t:number, x:number, y:number}[]} */
  const candidates = [];

  const eps = 1e-10;
  if (Math.abs(dx) > eps) {
    // x = xmin
    let t = (xmin - ox) / dx;
    if (t > 0) {
      const y = oy + t * dy;
      if (y >= ymin - 1e-6 && y <= ymax + 1e-6) candidates.push({ t, x: xmin, y });
    }
    // x = xmax
    t = (xmax - ox) / dx;
    if (t > 0) {
      const y = oy + t * dy;
      if (y >= ymin - 1e-6 && y <= ymax + 1e-6) candidates.push({ t, x: xmax, y });
    }
  }

  if (Math.abs(dy) > eps) {
    // y = ymin
    let t = (ymin - oy) / dy;
    if (t > 0) {
      const x = ox + t * dx;
      if (x >= xmin - 1e-6 && x <= xmax + 1e-6) candidates.push({ t, x, y: ymin });
    }
    // y = ymax
    t = (ymax - oy) / dy;
    if (t > 0) {
      const x = ox + t * dx;
      if (x >= xmin - 1e-6 && x <= xmax + 1e-6) candidates.push({ t, x, y: ymax });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.t - b.t);
  const best = candidates[0];
  return [best.x, best.y];
}

function applyOrientationToPx(px, py, w, h, orient) {
  let x = px;
  let y = py;
  if (orient.flipX) x = w - x;
  if (orient.flipY) y = h - y;
  return [x, y];
}

/**
 * Convert BEV coords to pixel coords on a canvas.
 * We treat BEV bounds as an (x,y) extent with y increasing upward (matplotlib origin='lower').
 * Canvas has y downward, so y is inverted.
 */
export function bevToPixel(bevXY, canvasW, canvasH, bounds = DEFAULT_BEV_BOUNDS, orient = DEFAULT_ORIENTATION) {
  const { xmin, xmax, ymin, ymax } = bounds;
  const x01 = (bevXY[0] - xmin) / (xmax - xmin);
  const y01 = (bevXY[1] - ymin) / (ymax - ymin);
  const px = x01 * canvasW;
  const py = canvasH - y01 * canvasH;
  return applyOrientationToPx(px, py, canvasW, canvasH, orient);
}

/**
 * Build a wedge polygon in pixel coords for a camera.
 * @returns {{ cam: string, poly: [number,number][], originPx: [number,number], fwdPx: [number,number] }}
 */
export function buildCameraWedgePx(camName, pose, canvasW, canvasH, opts) {
  const { bounds, orient, lengthMeters, quatConvention } = opts;

  const t = pose.t;
  const q = pose.q;
  const fov = pose.fov;

  let R;
  if (quatConvention === "wxyz") {
    R = quatWxyzToMat3(q);
  } else {
    // fallback: treat input as xyzw and convert to wxyz
    const [x, y, z, w] = q;
    R = quatWxyzToMat3([w, x, y, z]);
  }

  const fwdWorld = forwardFromMat3(R, 2);
  const fwd2 = normalize2([fwdWorld[0], fwdWorld[1]]);

  const originBev = worldToBev([t[0], t[1]]);
  let fwdBev = worldToBev(fwd2);
  fwdBev = normalize2(fwdBev);

  const yawOffset = orient.yawOffsetRad || 0;
  if (yawOffset !== 0) {
    fwdBev = normalize2(rotate2D(fwdBev, yawOffset));
  }

  const half = fov / 2;
  const dirLeft = normalize2(rotate2D(fwdBev, +half));
  const dirRight = normalize2(rotate2D(fwdBev, -half));

  // Push wedge to the BEV bounds (image border). Fallback to fixed length if needed.
  const hitLeft = rayIntersectBounds2D(originBev, dirLeft, bounds);
  const hitRight = rayIntersectBounds2D(originBev, dirRight, bounds);

  const p0 = originBev;
  const p1 = hitLeft ?? [originBev[0] + dirLeft[0] * lengthMeters, originBev[1] + dirLeft[1] * lengthMeters];
  const p2 = hitRight ?? [originBev[0] + dirRight[0] * lengthMeters, originBev[1] + dirRight[1] * lengthMeters];

  const poly = [p0, p1, p2].map((p) => bevToPixel(p, canvasW, canvasH, bounds, orient));
  const originPx = poly[0];

  const fwdTipBev = [originBev[0] + fwdBev[0] * Math.min(3, lengthMeters), originBev[1] + fwdBev[1] * Math.min(3, lengthMeters)];
  const fwdPx = bevToPixel(fwdTipBev, canvasW, canvasH, bounds, orient);

  return { cam: camName, poly, originPx, fwdPx };
}

function pointInTri(p, a, b, c) {
  // Barycentric technique (works for any triangle orientation).
  const v0 = [c[0] - a[0], c[1] - a[1]];
  const v1 = [b[0] - a[0], b[1] - a[1]];
  const v2 = [p[0] - a[0], p[1] - a[1]];

  const dot00 = v0[0] * v0[0] + v0[1] * v0[1];
  const dot01 = v0[0] * v1[0] + v0[1] * v1[1];
  const dot02 = v0[0] * v2[0] + v0[1] * v2[1];
  const dot11 = v1[0] * v1[0] + v1[1] * v1[1];
  const dot12 = v1[0] * v2[0] + v1[1] * v2[1];

  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-12) return false;
  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

export function hitTestWedges(wedges, px, py) {
  const p = [px, py];
  for (const w of wedges) {
    const [a, b, c] = w.poly;
    if (pointInTri(p, a, b, c)) return w.cam;
  }
  return null;
}

function pathForWedge(ctx, wdg) {
  ctx.beginPath();
  ctx.moveTo(wdg.poly[0][0], wdg.poly[0][1]);
  ctx.lineTo(wdg.poly[1][0], wdg.poly[1][1]);
  ctx.lineTo(wdg.poly[2][0], wdg.poly[2][1]);
  ctx.closePath();
}

function pathForPoly(ctx, poly) {
  if (!Array.isArray(poly) || poly.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i][0], poly[i][1]);
  }
  ctx.closePath();
}

function clipPolygonAgainstHalfPlane(poly, isInside, intersect) {
  if (!Array.isArray(poly) || poly.length === 0) return [];
  const out = [];
  let prev = poly[poly.length - 1];
  let prevInside = isInside(prev);
  for (const cur of poly) {
    const curInside = isInside(cur);
    if (curInside) {
      if (!prevInside) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevInside) {
      out.push(intersect(prev, cur));
    }
    prev = cur;
    prevInside = curInside;
  }
  return out;
}

function clipPolygonToRect(poly, w, h) {
  let p = poly;
  const eps = 1e-9;
  p = clipPolygonAgainstHalfPlane(
    p,
    (v) => v[0] >= -eps,
    (a, b) => {
      const t = (0 - a[0]) / ((b[0] - a[0]) || 1e-12);
      return [0, a[1] + t * (b[1] - a[1])];
    }
  );
  p = clipPolygonAgainstHalfPlane(
    p,
    (v) => v[0] <= w + eps,
    (a, b) => {
      const t = (w - a[0]) / ((b[0] - a[0]) || 1e-12);
      return [w, a[1] + t * (b[1] - a[1])];
    }
  );
  p = clipPolygonAgainstHalfPlane(
    p,
    (v) => v[1] >= -eps,
    (a, b) => {
      const t = (0 - a[1]) / ((b[1] - a[1]) || 1e-12);
      return [a[0] + t * (b[0] - a[0]), 0];
    }
  );
  p = clipPolygonAgainstHalfPlane(
    p,
    (v) => v[1] <= h + eps,
    (a, b) => {
      const t = (h - a[1]) / ((b[1] - a[1]) || 1e-12);
      return [a[0] + t * (b[0] - a[0]), h];
    }
  );
  return p;
}

function coveragePolyToImageBorders(wedge, w, h) {
  if (!wedge || !Array.isArray(wedge.poly) || wedge.poly.length < 3) return null;
  const o = wedge.poly[0];
  const a = wedge.poly[1];
  const b = wedge.poly[2];
  const da = normalize2([a[0] - o[0], a[1] - o[1]]);
  const db = normalize2([b[0] - o[0], b[1] - o[1]]);
  const far = Math.max(w, h) * 4;
  const tri = [
    [o[0], o[1]],
    [o[0] + da[0] * far, o[1] + da[1] * far],
    [o[0] + db[0] * far, o[1] + db[1] * far],
  ];
  const clipped = clipPolygonToRect(tri, w, h);
  if (!Array.isArray(clipped) || clipped.length < 3) return wedge.poly;
  return clipped;
}

/**
 * Dim everything, then punch out a hole for selected wedge.
 * Intended to run in a coordinate system where the canvas origin matches the image top-left.
 */
export function drawDimMaskSelectedNoClear(ctx, wedges, selectedCam, dimAlpha = 0.6, size = null) {
  // Important: callers may translate the context so (0,0) is the displayed-image top-left.
  // In that case, dimming should be limited to the displayed image rect (not the full canvas).
  const w = (size && size.width) || ctx.canvas.width;
  const h = (size && size.height) || ctx.canvas.height;

  // Dim layer
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(1, dimAlpha))})`;
  ctx.fillRect(0, 0, w, h);

  // Punch out observed region
  const sel = wedges.find((x) => x.cam === selectedCam);
  if (sel) {
    const poly = coveragePolyToImageBorders(sel, w, h);
    ctx.globalCompositeOperation = "destination-out";
    // Must be fully opaque for a clean, uniform punch-out.
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    pathForPoly(ctx, poly || sel.poly);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Dim only blind areas by punching out all camera wedges from a full-image dim layer.
 * Intended to run in a coordinate system where the canvas origin matches the image top-left.
 */
export function drawBlindAreaMaskNoClear(ctx, wedges, dimAlpha = 0.6, size = null) {
  const w = (size && size.width) || ctx.canvas.width;
  const h = (size && size.height) || ctx.canvas.height;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(1, dimAlpha))})`;
  ctx.fillRect(0, 0, w, h);

  if (Array.isArray(wedges) && wedges.length > 0) {
    ctx.globalCompositeOperation = "destination-out";
    // Must be fully opaque for a clean, uniform punch-out.
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    for (const wedge of wedges) {
      const poly = coveragePolyToImageBorders(wedge, w, h);
      pathForPoly(ctx, poly || wedge.poly);
      ctx.fill();
    }
  }

  ctx.restore();
}

export function drawWedgeOutlinesNoClear(ctx, wedges, selectedCam, opts = {}) {
  const selFillAlphaRaw = Number(opts.selectedFillAlpha);
  const selectedFillAlpha = Number.isFinite(selFillAlphaRaw)
    ? Math.max(0, Math.min(1, selFillAlphaRaw))
    : 0.1;
  for (const wdg of wedges) {
    const isSel = wdg.cam === selectedCam;
    ctx.save();
    pathForWedge(ctx, wdg);

    // Keep fill subtle; the dim-mask does the heavy lifting.
    ctx.fillStyle = isSel
      ? `rgba(102, 178, 255, ${selectedFillAlpha.toFixed(3)})`
      : "rgba(255, 255, 255, 0.00)";
    ctx.strokeStyle = isSel ? "rgba(102, 178, 255, 0.95)" : "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = isSel ? 2.0 : 1.2;
    if (isSel && selectedFillAlpha > 0) ctx.fill();
    ctx.stroke();

    // origin dot + forward arrow line (subtle)
    ctx.fillStyle = isSel ? "rgba(255, 209, 102, 0.95)" : "rgba(255, 255, 255, 0.75)";
    ctx.beginPath();
    ctx.arc(wdg.originPx[0], wdg.originPx[1], isSel ? 3.1 : 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isSel ? "rgba(255, 209, 102, 0.9)" : "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = isSel ? 1.2 : 1.0;
    ctx.beginPath();
    ctx.moveTo(wdg.originPx[0], wdg.originPx[1]);
    ctx.lineTo(wdg.fwdPx[0], wdg.fwdPx[1]);
    ctx.stroke();

    ctx.restore();
  }
}

export function drawWedges(ctx, wedges, selectedCam) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawWedgeOutlinesNoClear(ctx, wedges, selectedCam);
}
