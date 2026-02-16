# Inverse Attention Visualization (JavaScript)

A fully client-side JavaScript web application for exploring inverse attention patterns in Vision Transformer (ViT) models, specifically designed for Bird's Eye View (BEV) autonomous driving models.

## Overview

This is a JavaScript port of the Python Streamlit application, designed to run entirely in the browser and be hosted on GitHub Pages. It provides an interactive interface for visualizing **inverse attention**: given a region in a camera image, which BEV queries attend to that region?

### Key Features

- **Multi-Camera Support**: View and select regions across multiple camera views
- **Interactive Region Selection**: Drag-to-select or manual coordinate input
- **Real-time BEV Visualization**: See attention maps update instantly as you select regions
- **Modern UI**: Clean, responsive design with smooth interactions
- **No Backend Required**: Fully client-side, works with static hosting

## Project Structure

```
interactive_attention_js/
├── index.html              # Main HTML file
├── src/
│   ├── app.js              # Main application logic
│   ├── inverseAttention.js # Core inverse attention computation
│   ├── dataLoader.js       # JSON scene data loading
│   ├── components/
│   │   ├── CameraGallery.js
│   │   ├── CameraView.js
│   │   ├── BEVView.js
│   │   └── Controls.js
│   ├── renderers/
│   │   ├── BEVRenderer.js
│   │   └── CameraRenderer.js
│   └── utils/
│       ├── colorUtils.js
│       └── coordinateUtils.js
├── styles/
│   └── main.css
├── data/
│   └── scenes/             # JSON scene files
├── scripts/
│   └── convert_scene_to_json.py
└── README.md
```

## Setup

### 1. Convert Scene Data

First, convert your `.npy` scene files to JSON format:

```bash
python scripts/convert_scene_to_json.py scenes/scene_av2_(10, 23).npy -o data/scenes/scene_av2_(10, 23).json
```

The conversion script will:
- Convert numpy arrays to nested JavaScript arrays
- Encode images as base64-encoded PNG strings
- Preserve all metadata (grid_size, patch_size, bev_range, etc.)

### 2. Serve the Application

For local development, you can use any static file server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js (if you have http-server installed)
npx http-server -p 8000

# Using PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

### 3. Load a Scene

The app will automatically try to load `data/scenes/scene_av2_(10, 23).json` by default.

You can also specify a scene via URL parameter:
```
http://localhost:8000?scene=data/scenes/your_scene.json
```

## Usage

1. **Select a Camera**: Click on a camera thumbnail in the gallery at the top
2. **Add Regions**: 
   - **Drag-to-select**: Click and drag on the camera image to create a rectangular region
   - **Manual input**: Enter X1, X2, Y1, Y2 coordinates and click "Add Region"
3. **View BEV Attention**: The BEV map on the right updates automatically showing which queries attend to your selected regions
4. **Multiple Regions**: Add regions on different cameras - they'll all be shown on the BEV map with different colors
5. **Manage Regions**: Use the delete buttons or clear buttons to remove regions

## Data Format

Scene JSON files contain:

```json
{
  "image_names": ["FRONT", "FRONT_LEFT", ...],
  "scaled_images": ["base64_png_string", ...],
  "original_images": ["base64_png_string", ...],
  "attn_weights": [[[[...]]]],  // Nested array [1][H][Q][K]
  "lidar_pts": [[x, y, z], ...],
  "metadata": {
    "grid_size": 32,
    "patch_size": 14,
    "bev_range": [-40, 40, -40, 40],
    "has_cls_tokens": true,
    "image_format": "base64"
  }
}
```

## GitHub Pages Deployment

1. Push the `interactive_attention_js` directory to your GitHub repository
2. Enable GitHub Pages in repository settings
3. Set source to the root directory or `/docs` if you move files there
4. The app will be available at `https://yourusername.github.io/repo-name/`

### Notes for GitHub Pages

- All scene data files must be in the repository (they can be large)
- Consider using Git LFS for large JSON files
- The app works entirely client-side, no server configuration needed

## Browser Compatibility

- Modern browsers with ES6+ support
- Canvas API support required
- Fetch API support required

Tested on:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## Performance Considerations

- Large attention tensors (32×32×1024×~2000) can be memory-intensive
- Consider using Web Workers for heavy computations if needed
- JSON scene files can be large (10-50MB+) - consider compression

## Development

The codebase uses ES6 modules. No build step is required, but you can use a bundler if desired:

```bash
# Using esbuild (example)
npx esbuild src/app.js --bundle --outfile=dist/app.js --format=esm
```

## Differences from Python Version

- **No PIL/Streamlit**: Uses native browser APIs for image handling
- **No matplotlib**: Uses HTML5 Canvas for rendering
- **No numpy**: Uses native JavaScript arrays (can be slower for very large tensors)
- **Client-side only**: All computation happens in the browser

## License

[Add your license here]

## Authors

[Add authors here]
