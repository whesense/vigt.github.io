/**
 * Point cloud loader (same schema as interactive_pointcloud_js)
 */

export async function loadPointCloudData(jsonPath) {
  console.log(`Loading point cloud metadata from: ${jsonPath}`);

  const response = await fetch(jsonPath);
  if (!response.ok) {
    throw new Error(`Failed to load metadata: ${response.status} ${response.statusText}`);
  }
  const metadata = await response.json();

  const jsonUrl = new URL(jsonPath, window.location.href);
  const binUrl = new URL(metadata.points_file, jsonUrl);

  console.log(`Loading point cloud binary: ${binUrl.toString()}`);
  const binResponse = await fetch(binUrl);
  if (!binResponse.ok) {
    const hint = binResponse.status === 404
      ? ' (404). Start your HTTP server from `interactive_compare_js/` (or from the repo root and open `/interactive_compare_js/`).'
      : '';
    throw new Error(
      `Failed to load binary file (${binUrl.toString()}): ${binResponse.status} ${binResponse.statusText}${hint}`
    );
  }

  const arrayBuffer = await binResponse.arrayBuffer();
  const floats = new Float32Array(arrayBuffer);

  const count = Number(metadata.count ?? 0);
  const inferredCount = Math.floor(floats.length / 3);
  const finalCount = count > 0 ? count : inferredCount;
  if (floats.length < finalCount * 3) {
    throw new Error(
      `Pointcloud binary too small: got ${floats.length} float32 values, expected at least ${finalCount * 3}.`
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

