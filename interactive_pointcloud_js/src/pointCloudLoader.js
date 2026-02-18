/**
 * Data loader for point cloud files (JSON metadata + BIN payload)
 */

/**
 * Expected JSON schema (minimal):
 * - points_file: string (relative path to binary, relative to JSON URL)
 * - count: number
 * - bounds: { x:[min,max], y:[min,max], z:[min,max] }
 * - stride_bytes: 12 (float32 xyz)
 * - convention: { up_axis:"Z", xy_swap:true, data_is_swapped:true }
 */
function resolveUrl(pathOrUrl, baseUrl) {
  if (!pathOrUrl) return null;
  try {
    return new URL(pathOrUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function pickPointCloudFromManifest(metadata, jsonUrl, preferredKey) {
  if (metadata?.pointcloud?.url) {
    return resolveUrl(metadata.pointcloud.url, jsonUrl);
  }

  if (Array.isArray(metadata?.pointclouds) && metadata.pointclouds.length > 0) {
    const preferred = preferredKey
      ? metadata.pointclouds.find((p) => p.key === preferredKey)
      : null;
    const entry = preferred || metadata.pointclouds[0];
    return resolveUrl(entry?.url, jsonUrl);
  }

  const items = metadata?.modalities?.pointclouds?.items;
  if (items && typeof items === 'object') {
    const keys = Object.keys(items);
    if (keys.length === 0) return null;
    const key = preferredKey && items[preferredKey] ? preferredKey : keys[0];
    const entry = items[key];
    return resolveUrl(entry?.json || entry?.url, jsonUrl);
  }

  return null;
}

export async function loadPointCloudData(jsonPath, options = {}) {
  const preferredKey = options.preferredKey || null;
  console.log(`Loading point cloud metadata from: ${jsonPath}`);

  const response = await fetch(jsonPath);
  if (!response.ok) {
    throw new Error(`Failed to load metadata: ${response.status} ${response.statusText}`);
  }
  const metadata = await response.json();

  const jsonUrl = new URL(jsonPath, window.location.href);

  if (!metadata.points_file) {
    const next = pickPointCloudFromManifest(metadata, jsonUrl, preferredKey);
    if (next) {
      return await loadPointCloudData(next, { preferredKey });
    }
    throw new Error('Unrecognized point cloud manifest format.');
  }

  const binUrl = new URL(metadata.points_file, jsonUrl);

  console.log(`Loading point cloud binary: ${binUrl.toString()}`);
  const binResponse = await fetch(binUrl);
  if (!binResponse.ok) {
    const hint = binResponse.status === 404
      ? ' (404). This usually means your HTTP server is running from the wrong directory. Start it from `interactive_pointcloud_js/` (or from the repo root and open `/interactive_pointcloud_js/`).'
      : '';
    throw new Error(
      `Failed to load binary file (${binUrl.toString()}): ${binResponse.status} ${binResponse.statusText}${hint}`
    );
  }

  const arrayBuffer = await binResponse.arrayBuffer();
  const floats = new Float32Array(arrayBuffer);

  const count = Number(metadata.count ?? 0);
  if (!Number.isFinite(count) || count <= 0) {
    // Fall back to length/3 for convenience
    console.warn('Metadata missing/invalid count; inferring from binary length.');
  }

  const inferredCount = Math.floor(floats.length / 3);
  const finalCount = count > 0 ? count : inferredCount;

  if (floats.length < finalCount * 3) {
    throw new Error(
      `Binary too small: got ${floats.length} float32 values, expected at least ${finalCount * 3}.`
    );
  }

  return {
    points: floats,
    count: finalCount,
    bounds: metadata.bounds,
    strideBytes: Number(metadata.stride_bytes ?? 12),
    convention: metadata.convention ?? { up_axis: 'Z', xy_swap: true, data_is_swapped: true },
    source: { jsonPath, binUrl: binUrl.toString() },
  };
}
