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
 * Convert HSV to RGB in [0,1].
 * h in degrees [0, 360), s,v in [0,1]
 */
export function hsvToRgb(h, s, v) {
    const hh = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = v - c;
    
    let rp = 0, gp = 0, bp = 0;
    if (hh < 60)       { rp = c; gp = x; bp = 0; }
    else if (hh < 120) { rp = x; gp = c; bp = 0; }
    else if (hh < 180) { rp = 0; gp = c; bp = x; }
    else if (hh < 240) { rp = 0; gp = x; bp = c; }
    else if (hh < 300) { rp = x; gp = 0; bp = c; }
    else               { rp = c; gp = 0; bp = x; }
    
    return [rp + m, gp + m, bp + m];
}

/**
 * Saturated colormap that stays vivid at high values.
 * 0 -> blue, 1 -> red (full saturation, full value).
 */
export function saturatedColormap(value) {
    const t = Math.max(0, Math.min(1, value));
    const hue = 240 * (1 - t); // 240 (blue) -> 0 (red)
    return hsvToRgb(hue, 1.0, 1.0);
}

/**
 * Convert RGB [0, 1] to CSS color string
 */
export function rgbToCss(rgb) {
    const [r, g, b] = rgb;
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
