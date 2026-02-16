/**
 * Color utilities for visualization
 */

/**
 * Convert a color name or hex to RGB array [r, g, b] in [0, 1]
 */
export function colorToRgb(color) {
    // Named colors
    const namedColors = {
        'red': [1, 0, 0],
        'green': [0, 1, 0],
        'blue': [0, 0, 1],
        'cyan': [0, 1, 1],
        'orange': [1, 0.5, 0],
        'purple': [0.5, 0, 0.5],
        'magenta': [1, 0, 1],
        'yellow': [1, 1, 0],
        'white': [1, 1, 1],
        'black': [0, 0, 0],
        'grey': [0.5, 0.5, 0.5],
        'gray': [0.5, 0.5, 0.5]
    };
    
    if (namedColors[color.toLowerCase()]) {
        return namedColors[color.toLowerCase()];
    }
    
    // Hex color
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        return [r, g, b];
    }
    
    // Default to red
    return [1, 0, 0];
}

/**
 * Apply hot colormap to a value in [0, 1]
 * Returns RGB array [r, g, b] in [0, 1]
 */
export function hotColormap(value) {
    value = Math.max(0, Math.min(1, value));
    
    let r, g, b;
    if (value < 0.33) {
        r = value * 3;
        g = 0;
        b = 0;
    } else if (value < 0.66) {
        r = 1;
        g = (value - 0.33) * 3;
        b = 0;
    } else {
        r = 1;
        g = 1;
        b = (value - 0.66) * 3;
    }
    
    return [r, g, b];
}

/**
 * Blend multiple RGB colors with weights
 * @param {Array<Array<number>>} colors - Array of RGB arrays [r, g, b]
 * @param {Array<number>} weights - Array of weights (will be normalized)
 * @returns {Array<number>} Blended RGB [r, g, b]
 */
export function blendColors(colors, weights) {
    if (colors.length === 0) return [0, 0, 0];
    if (colors.length === 1) return colors[0];
    
    // Normalize weights
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) return [0, 0, 0];
    
    const normalizedWeights = weights.map(w => w / totalWeight);
    
    // Blend
    const blended = [0, 0, 0];
    colors.forEach((color, i) => {
        const weight = normalizedWeights[i];
        blended[0] += color[0] * weight;
        blended[1] += color[1] * weight;
        blended[2] += color[2] * weight;
    });
    
    // Clamp to [0, 1]
    return [
        Math.max(0, Math.min(1, blended[0])),
        Math.max(0, Math.min(1, blended[1])),
        Math.max(0, Math.min(1, blended[2]))
    ];
}

/**
 * Get a distinct color from a palette
 * 
 * Color Logic:
 * - Colors are assigned sequentially based on totalRegionCount (global across all cameras)
 * - Each new region gets the next color in the palette
 * - Colors cycle through: red, cyan, orange, green, purple, magenta, yellow, blue
 * - This ensures consistent colors across cameras (region 1 is always red, region 2 is always cyan, etc.)
 * - Colors are used for:
 *   - BEV attention overlays
 *   - Camera view region boundaries
 *   - Thumbnail region rectangles
 * 
 * @param {number} index - Color index (0-based, cycles through 8 colors)
 * @returns {string} Color name
 */
export function getDistinctColor(index) {
    const colors = ['red', 'cyan', 'orange', 'green', 'purple', 'magenta', 'yellow', 'blue'];
    return colors[index % colors.length];
}

/**
 * Convert RGB [0, 1] to CSS color string
 */
export function rgbToCss(rgb) {
    const [r, g, b] = rgb;
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
