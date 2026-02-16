#!/usr/bin/env python3
"""
Convert .npy scene files to JSON format for JavaScript web application.

This script converts numpy arrays to JSON-compatible formats:
- Images: base64-encoded PNG
- Attention weights: nested arrays
- Metadata: direct JSON serialization
"""

import numpy as np
import json
import base64
from pathlib import Path
from PIL import Image
import io


def image_to_base64(img_array):
    """
    Convert numpy image array [C, H, W] to base64-encoded PNG string.
    
    Args:
        img_array: numpy array of shape [C, H, W] with values in [0, 255] or [0, 1]
    
    Returns:
        base64 string of PNG image
    """
    # Handle different input formats
    if img_array.max() <= 1.0:
        img_array = (img_array * 255).astype(np.uint8)
    else:
        img_array = img_array.astype(np.uint8)
    
    # Convert [C, H, W] to [H, W, C] for PIL
    if len(img_array.shape) == 3:
        if img_array.shape[0] == 3 or img_array.shape[0] == 1:
            # CHW format
            img_array = np.transpose(img_array, (1, 2, 0))
            if img_array.shape[2] == 1:
                # Grayscale
                img_array = img_array.squeeze(2)
        elif img_array.shape[2] == 3:
            # Already HWC
            pass
        else:
            # Assume HWC
            pass
    
    # Ensure RGB
    if len(img_array.shape) == 2:
        # Grayscale to RGB
        img_array = np.stack([img_array] * 3, axis=2)
    elif img_array.shape[2] == 4:
        # RGBA to RGB
        img_array = img_array[:, :, :3]
    
    # Create PIL Image and convert to base64
    img = Image.fromarray(img_array, mode='RGB')
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    img_bytes = buffer.getvalue()
    img_base64 = base64.b64encode(img_bytes).decode('utf-8')
    
    return img_base64


def numpy_to_list(arr):
    """Convert numpy array to nested Python list."""
    return arr.tolist()


def convert_scene_to_json(npy_path, output_path=None, compress_images=True):
    """
    Convert .npy scene file to JSON format.
    
    Args:
        npy_path: Path to input .npy file
        output_path: Path to output JSON file (default: same name with .json extension)
        compress_images: Whether to base64-encode images (True) or keep as arrays (False)
    
    Returns:
        Dictionary with converted data
    """
    npy_path = Path(npy_path)
    if not npy_path.exists():
        raise FileNotFoundError(f"Scene file not found: {npy_path}")
    
    # Load numpy data
    print(f"Loading {npy_path}...")
    data_dict = np.load(npy_path, allow_pickle=True)
    if isinstance(data_dict, np.ndarray) and data_dict.dtype == object:
        data_dict = data_dict[()]
    
    # Extract data
    image_names = data_dict['image_names']
    scaled_images = data_dict['scaled_images']
    original_images = data_dict['original_images']
    attn_weights = data_dict['attn_weights']
    lidar_pts = data_dict.get('lidar_pts', None)
    
    print(f"Found {len(image_names)} cameras")
    print(f"Attention weights shape: {attn_weights.shape}")
    
    # Convert images
    print("Converting images...")
    if compress_images:
        scaled_images_json = [image_to_base64(img) for img in scaled_images]
        original_images_json = [image_to_base64(img) for img in original_images]
    else:
        scaled_images_json = [numpy_to_list(img) for img in scaled_images]
        original_images_json = [numpy_to_list(img) for img in original_images]
    
    # Convert attention weights - save as separate binary file to avoid JSON parsing issues
    print("Converting attention weights...")
    print(f"  Original shape: {attn_weights.shape}")
    # Flatten to 1D array
    attn_weights_flat = attn_weights.flatten().astype(np.float32)
    attn_weights_shape = list(attn_weights.shape)
    print(f"  Flattened to {len(attn_weights_flat)} elements")
    
    # Save as binary file (much smaller and faster to load)
    if output_path is None:
        attn_bin_path = npy_path.parent / f"{npy_path.stem}_attn.bin"
    else:
        attn_bin_path = Path(output_path).parent / f"{Path(output_path).stem}_attn.bin"
    
    print(f"  Saving binary to {attn_bin_path}...")
    attn_weights_flat.tofile(attn_bin_path)
    attn_bin_size = attn_bin_path.stat().st_size / (1024 * 1024)
    print(f"  Binary file size: {attn_bin_size:.2f} MB")
    
    # Store reference in JSON (not the data itself)
    attn_weights_ref = str(attn_bin_path.name)
    
    # Convert LiDAR points
    lidar_pts_json = None
    if lidar_pts is not None:
        print("Converting LiDAR points...")
        lidar_pts_json = numpy_to_list(lidar_pts)
    
    # Build output dictionary
    output_data = {
        'image_names': image_names,
        'scaled_images': scaled_images_json,
        'original_images': original_images_json,
        'attn_weights_file': attn_weights_ref,  # Reference to binary file
        'attn_weights_shape': attn_weights_shape,  # Shape to reshape back
        'lidar_pts': lidar_pts_json,
        'metadata': {
            'grid_size': 32,  # Default, can be extracted from attn_weights if needed
            'patch_size': 14,  # Default ViT patch size
            'bev_range': [-40, 40, -40, 40],  # Default BEV range in meters
            'has_cls_tokens': True,  # Default assumption
            'image_format': 'base64' if compress_images else 'array'
        }
    }
    
    # Determine output path
    if output_path is None:
        output_path = npy_path.parent / f"{npy_path.stem}.json"
    else:
        output_path = Path(output_path)
    
    # Write JSON file
    print(f"Writing JSON to {output_path}...")
    with open(output_path, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    # Calculate file sizes
    npy_size = npy_path.stat().st_size / (1024 * 1024)  # MB
    json_size = output_path.stat().st_size / (1024 * 1024)  # MB
    
    print(f"Conversion complete!")
    print(f"  Input size:  {npy_size:.2f} MB")
    print(f"  Output size: {json_size:.2f} MB")
    print(f"  Ratio:       {json_size/npy_size:.2f}x")
    
    return output_data


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Convert .npy scene files to JSON')
    parser.add_argument('input', type=str, help='Input .npy file path')
    parser.add_argument('-o', '--output', type=str, default=None, help='Output JSON file path')
    parser.add_argument('--no-compress', action='store_true', help='Keep images as arrays instead of base64')
    
    args = parser.parse_args()
    
    convert_scene_to_json(
        args.input,
        output_path=args.output,
        compress_images=not args.no_compress
    )
