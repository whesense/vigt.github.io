import { loadOccupancyData } from './loaders/occupancyLoader.js?v=2026-02-11-bitset-fix2';
import { loadPointCloudData } from './loaders/pointCloudLoader.js?v=2026-02-11-bitset-fix2';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  return await res.json();
}

/**
 * Scene manifest schema (scene.json):
 * {
 *   "images": [{ "name": "...", "url": "images/ring_front_center.jpg" }, ...],
 *   "occupancy": { "url": "occ_frame000121.json" },
 *   // Backward-compat:
 *   "pointcloud": { "url": "vigt_frame000121.json" },
 *   // New (preferred):
 *   "pointclouds": [
 *     { "key": "vigt", "label": "ViGT", "url": "vigt_frame000121.json" },
 *     { "key": "gt", "label": "GT", "url": "gt_frame000121.json" }
 *   ]
 * }
 */
export async function loadCompareScene(sceneJsonPath) {
  const sceneUrl = new URL(sceneJsonPath, window.location.href);
  const manifest = await fetchJson(sceneUrl.toString());

  const images = Array.isArray(manifest.images) ? manifest.images.map((it) => {
    const u = new URL(it.url, sceneUrl);
    return { name: it.name || it.url, url: u.toString() };
  }) : [];

  const occUrl = new URL(manifest?.occupancy?.url, sceneUrl).toString();
  const legacyPcUrl = manifest?.pointcloud?.url ? new URL(manifest.pointcloud.url, sceneUrl).toString() : null;

  const pointclouds = Array.isArray(manifest?.pointclouds)
    ? manifest.pointclouds
      .filter((it) => it && typeof it.url === 'string' && it.url.length > 0)
      .map((it, idx) => {
        const url = new URL(it.url, sceneUrl).toString();
        const key = typeof it.key === 'string' && it.key.length > 0 ? it.key : `pc_${idx}`;
        const label = typeof it.label === 'string' && it.label.length > 0 ? it.label : key;
        return { key, label, url };
      })
    : (legacyPcUrl ? [{ key: 'pointcloud', label: 'Point cloud', url: legacyPcUrl }] : []);

  const [occupancy, pointcloud0] = await Promise.all([
    loadOccupancyData(occUrl),
    pointclouds[0]?.url ? loadPointCloudData(pointclouds[0].url) : Promise.resolve(null),
  ]);

  return {
    manifest,
    images,
    occupancy,
    // Backward-compat: keep `pointcloud` for existing codepaths.
    pointcloud: pointcloud0,
    // New normalized list for UI.
    pointclouds,
  };
}
