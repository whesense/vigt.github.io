# Quick Start Guide

## Step 1: Convert Scene Data to JSON

First, you need to convert your `.npy` scene file to JSON format:

```bash
cd /Users/danya/vigt_viz/interactive_attention

# Convert the scene file
python interactive_attention_js/scripts/convert_scene_to_json.py \
    scenes/scene_av2_\(10,\ 23\).npy \
    -o interactive_attention_js/data/scenes/scene_av2_\(10,\ 23\).json
```

**Note:** Make sure you have the required Python packages:
```bash
pip install numpy pillow
```

## Step 2: Create Data Directory

Make sure the data directory exists:
```bash
mkdir -p interactive_attention_js/data/scenes
```

## Step 3: Start a Local Server

Since the app uses ES6 modules, you need to serve it from a web server (not just open the HTML file directly).

### Option A: Python HTTP Server (Easiest)
```bash
cd interactive_attention_js
python -m http.server 8000
```

### Option B: Node.js http-server
```bash
cd interactive_attention_js
npx http-server -p 8000
```

### Option C: PHP Server
```bash
cd interactive_attention_js
php -S localhost:8000
```

## Step 4: Open in Browser

Open your browser and navigate to:
```
http://localhost:8000
```

The app will automatically try to load `data/scenes/scene_av2_(10, 23).json`.

## Troubleshooting

### "Failed to load scene"
- Make sure you've converted the `.npy` file to JSON (Step 1)
- Check that the JSON file exists in `data/scenes/`
- Open browser console (F12) to see detailed error messages

### "CORS error" or blank page
- Make sure you're using a web server (not opening `file://` directly)
- Check that all files are in the correct directories

### Images not loading
- Verify the JSON file was created correctly
- Check browser console for base64 decoding errors

## Testing the Conversion Script

You can test if the conversion works:
```bash
python interactive_attention_js/scripts/convert_scene_to_json.py \
    scenes/scene_av2_\(10,\ 23\).npy \
    -o interactive_attention_js/data/scenes/test.json
```

This should create a JSON file. Check the file size - it should be similar to or larger than the original `.npy` file.
