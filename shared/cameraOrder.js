/**
 * Shared camera UI ordering helpers.
 *
 * UI order is decoupled from model/feature-map order.
 */

const UI_ORDER = {
  av2: [
    'ring_rear_left',
    'ring_side_left',
    'ring_front_left',
    'ring_front_center',
    'ring_front_right',
    'ring_side_right',
    'ring_rear_right',
  ],
  nuscenes: [
    'cam_back_left',
    'cam_front_left',
    'cam_front',
    'cam_front_right',
    'cam_back_right',
    'cam_back',
  ],
  waymo: [
    'left',
    'front_left',
    'front',
    'front_right',
    'right',
  ],
  once: [
    'cam05',
    'cam06',
    'cam01',
    'cam07',
    'cam08',
    'cam09',
  ],
};

const WAYMO_SET = new Set(['front', 'front_left', 'front_right', 'left', 'right']);

const AV2_ALIAS = {
  front_center: 'ring_front_center',
  front: 'ring_front_center',
  front_left: 'ring_front_left',
  front_right: 'ring_front_right',
  side_left: 'ring_side_left',
  side_right: 'ring_side_right',
  rear_left: 'ring_rear_left',
  rear_right: 'ring_rear_right',
  back_left: 'ring_rear_left',
  back_right: 'ring_rear_right',
};

const NUSCENES_ALIAS = {
  front: 'cam_front',
  front_left: 'cam_front_left',
  front_right: 'cam_front_right',
  back: 'cam_back',
  back_left: 'cam_back_left',
  back_right: 'cam_back_right',
};

const WAYMO_ALIAS = {
  front_center: 'front',
  side_left: 'left',
  side_right: 'right',
};

function normalizeForDataset(nameCanon, dataset) {
  if (!nameCanon) return '';
  const ds = (dataset || '').toLowerCase();
  if (ds === 'av2') {
    if (nameCanon.startsWith('ring_')) return nameCanon;
    return AV2_ALIAS[nameCanon] || nameCanon;
  }
  if (ds === 'nuscenes') {
    if (nameCanon.startsWith('cam_')) return nameCanon;
    return NUSCENES_ALIAS[nameCanon] || nameCanon;
  }
  if (ds === 'waymo') {
    return WAYMO_ALIAS[nameCanon] || nameCanon;
  }
  if (ds === 'once') {
    if (/^cam_\d+$/i.test(nameCanon)) return nameCanon.replace('cam_', 'cam');
  }
  return nameCanon;
}

function canonicalizeName(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
}

function canonicalizeUrl(url) {
  if (!url) return '';
  let raw = String(url);
  try {
    raw = new URL(raw, window.location.href).pathname || raw;
  } catch (err) {
    // Fall back to raw string
  }
  raw = raw.split('?')[0].split('#')[0];
  const parts = raw.split('/');
  const file = parts[parts.length - 1] || raw;
  const base = file
    .replace(/\.(jpg|jpeg|png|webp)$/i, '')
    .replace(/__scaled$/i, '');
  return canonicalizeName(base);
}

function detectDatasetFromCanonical(namesCanon) {
  if (!Array.isArray(namesCanon) || namesCanon.length === 0) return null;

  let bestDataset = null;
  let bestMatches = 0;

  Object.keys(UI_ORDER).forEach((dataset) => {
    const desired = UI_ORDER[dataset];
    if (!desired) return;
    let matches = 0;
    namesCanon.forEach((name) => {
      const key = normalizeForDataset(name, dataset);
      if (desired.includes(key)) matches += 1;
    });
    if (matches > bestMatches) {
      bestDataset = dataset;
      bestMatches = matches;
    }
  });

  if (bestMatches === 0) return null;
  return bestDataset;
}

export function orderCameraNamesForUi(names, datasetHint = null) {
  const list = Array.isArray(names) ? names : [];
  if (list.length === 0) return [];

  const namesCanon = list.map((n) => canonicalizeName(n));
  const hint = datasetHint ? String(datasetHint).toLowerCase() : '';
  const datasets = [];
  if (hint && UI_ORDER[hint]) datasets.push(hint);
  Object.keys(UI_ORDER).forEach((ds) => {
    if (!datasets.includes(ds)) datasets.push(ds);
  });

  let best = null;
  datasets.forEach((dataset) => {
    const desired = UI_ORDER[dataset];
    if (!desired) return;
    const canon = namesCanon.map((name) => normalizeForDataset(name, dataset));
    const used = new Array(list.length).fill(false);
    const ordered = [];
    let matchCount = 0;

    for (const want of desired) {
      const idx = canon.findIndex((n, i) => !used[i] && n === want);
      if (idx >= 0) {
        ordered.push(list[idx]);
        used[idx] = true;
        matchCount += 1;
      }
    }

    list.forEach((name, i) => {
      if (!used[i]) ordered.push(name);
    });

    if (!best || matchCount > best.matchCount) {
      best = { ordered, matchCount };
    }
  });

  const minMatches = hint ? 1 : 2;
  if (best && best.matchCount >= minMatches) return best.ordered;
  return [...list];
}

export function orderCameraItemsForUi(items, datasetHint = null) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const nameCanon = list.map((it) => {
    if (it && typeof it.name === 'string' && it.name.trim()) return canonicalizeName(it.name);
    return '';
  });
  const urlCanon = list.map((it) => {
    if (it && typeof it.url === 'string') return canonicalizeUrl(it.url);
    return '';
  });

  const detectPool = [];
  for (let i = 0; i < list.length; i += 1) {
    if (nameCanon[i]) detectPool.push(nameCanon[i]);
    if (urlCanon[i]) detectPool.push(urlCanon[i]);
  }

  const hint = datasetHint ? String(datasetHint).toLowerCase() : '';
  const datasets = [];
  if (hint && UI_ORDER[hint]) datasets.push(hint);
  Object.keys(UI_ORDER).forEach((ds) => {
    if (!datasets.includes(ds)) datasets.push(ds);
  });

  let best = null;
  datasets.forEach((dataset) => {
    const desired = UI_ORDER[dataset];
    if (!desired) return;
    const canon = list.map((_, i) => {
      const nameKey = normalizeForDataset(nameCanon[i], dataset);
      const urlKey = normalizeForDataset(urlCanon[i], dataset);
      if (desired.includes(nameKey)) return nameKey;
      if (desired.includes(urlKey)) return urlKey;
      return nameKey || urlKey || '';
    });

    const used = new Array(list.length).fill(false);
    const ordered = [];
    let matchCount = 0;

    for (const want of desired) {
      const idx = canon.findIndex((n, i) => !used[i] && n === want);
      if (idx >= 0) {
        ordered.push(list[idx]);
        used[idx] = true;
        matchCount += 1;
      }
    }

    list.forEach((item, i) => {
      if (!used[i]) ordered.push(item);
    });

    if (!best || matchCount > best.matchCount) {
      best = { ordered, matchCount };
    }
  });

  const minMatches = hint ? 1 : 2;
  if (best && best.matchCount >= minMatches) return best.ordered;
  return [...list];
}

export function detectCameraDataset(namesOrItems) {
  if (!Array.isArray(namesOrItems) || namesOrItems.length === 0) return null;
  const canon = namesOrItems.map((it) => {
    if (typeof it === 'string') return canonicalizeName(it);
    if (it && typeof it.name === 'string' && it.name.trim()) return canonicalizeName(it.name);
    if (it && typeof it.url === 'string') return canonicalizeUrl(it.url);
    return '';
  });
  return detectDatasetFromCanonical(canon);
}
