/**
 * Data loader for scene JSON files
 */

import { ForwardAttentionVisualizer } from './forwardAttention.js';
import { orderCameraNamesForUi } from '../../shared/cameraOrder.js';
import { loadAttentionAsFloat32 } from '../../shared/attentionDecode.js?v=2026-02-10-attn-decode-v2';

function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

/**
 * Load scene data from JSON file
 *
 * @param {string} jsonPath - Path to JSON scene file
 * @param {Object} options
 * @param {string} options.attnPrecision - auto|int8|int4|fp32
 * @returns {Promise<Object>} Loaded scene data with visualizer
 */
export async function loadSceneData(jsonPath, options = {}) {
    console.log(`Loading scene data from: ${jsonPath}`);

    // Resolve relative to the current page (works on GitHub Pages under /<repo>/)
    // and handles URL encoding (spaces, parentheses) safely.
    const jsonUrl = new URL(jsonPath, window.location.href);

    const response = await fetch(jsonUrl);
    if (!response.ok) {
        throw new Error(`Failed to load scene: ${response.statusText}`);
    }
    
    const text = await response.text();
    const data = JSON.parse(text);
    
    const metadata = data.metadata || {};
    const resolveBevBase = (src) => {
        if (!src) return '';
        try {
            return new URL(src, jsonUrl).toString();
        } catch (err) {
            return src;
        }
    };
    if (metadata.bev_base_image) {
        metadata.bev_base_image = resolveBevBase(metadata.bev_base_image);
    }
    if (metadata.bev_base_images && typeof metadata.bev_base_images === 'object') {
        const resolved = {};
        Object.entries(metadata.bev_base_images).forEach(([key, value]) => {
            if (value) resolved[key] = resolveBevBase(value);
        });
        metadata.bev_base_images = resolved;
    }
    const gridSize = metadata.grid_size || 32;
    const patchSize = metadata.patch_size || 14;
    const bevRange = metadata.bev_range || [-40, 40, -40, 40];
    const hasClsTokens = metadata.has_cls_tokens !== undefined ? metadata.has_cls_tokens : true;
    
    // Load images
    let cameraImages, originalImages;
    if (Array.isArray(data.image_files) && data.image_files.length > 0) {
        cameraImages = await Promise.all(
            data.image_files.map((path) => loadImageFromUrl(new URL(path, jsonUrl).toString()))
        );
        if (Array.isArray(data.original_image_files) && data.original_image_files.length > 0) {
            originalImages = await Promise.all(
                data.original_image_files.map((path) => loadImageFromUrl(new URL(path, jsonUrl).toString()))
            );
        } else {
            originalImages = cameraImages;
        }
    } else {
        throw new Error(
            'Canonical manifest required: expected image_files (and optional original_image_files) in scene JSON.'
        );
    }
    
    // Load attention weights from manifest-linked binary variants only.
    const loaded = await loadAttentionAsFloat32(
        data,
        jsonUrl,
        options.attnPrecision || 'auto'
    );
    const attnWeights = loaded.float32;
    const attnWeightsShape = loaded.shape;
    if (loaded.fallbackUsed) {
        console.warn(
            `Attention precision fallback used (requested=${loaded.requestedPrecision}, selected=${loaded.selectedPrecision}).`
        );
    }
    
    const lidarPts = data.lidar_pts || null;
    
    const visualizer = new ForwardAttentionVisualizer(
        attnWeights,
        cameraImages,
        data.image_names,
        {
            gridSize,
            patchSize,
            bevRange,
            hasClsTokens,
            originalImages,
            attnWeightsShape
        }
    );
    
    // Display order
    const datasetHint = metadata.dataset || metadata.dataset_name || metadata.datasetName || null;
    const helperOrder = orderCameraNamesForUi(data.image_names, datasetHint);
    const helperReordered =
        Array.isArray(helperOrder)
        && helperOrder.length === data.image_names.length
        && helperOrder.some((name, idx) => name !== data.image_names[idx]);

    let imageDisplayOrder = null;
    if (helperReordered) {
        imageDisplayOrder = helperOrder;
    } else if (Array.isArray(metadata.image_display_order) && metadata.image_display_order.length > 0) {
        const baseOrder = metadata.image_display_order.filter((name) => data.image_names.includes(name));
        const missing = data.image_names.filter((name) => !baseOrder.includes(name));
        imageDisplayOrder = [...baseOrder, ...missing];
    } else {
        imageDisplayOrder = data.image_names;
    }
    
    return {
        visualizer,
        imageNames: data.image_names,
        imageDisplayOrder,
        originalImages,
        lidarPts,
        metadata
    };
}
