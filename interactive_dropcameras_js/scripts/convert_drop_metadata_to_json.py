"""
Convert `metadata.npz.npy` (pickled numpy object) into a browser-friendly JSON file.

Input (current): data/drop_scenes/<scene>/metadata.npz.npy
Output:          data/drop_scenes/<scene>/metadata.json

The input is produced by something like:
np.save('.../metadata.npz', { 'viz_camera_order': ..., 'camera_order': ..., 'tr_quat_fovs': ... })

Note: the saved filename is `metadata.npz.npy` due to np.save behavior.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict

import numpy as np


def _to_py(x: Any) -> Any:
    if isinstance(x, (np.floating, np.integer)):
        return x.item()
    if isinstance(x, np.ndarray):
        return x.tolist()
    return x


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python convert_drop_metadata_to_json.py <scene_dir>")
        print("Example: python convert_drop_metadata_to_json.py ../data/drop_scenes/av2_(10,23)")
        return 2

    scene_dir = Path(sys.argv[1]).expanduser().resolve()
    inp = scene_dir / "metadata.npz.npy"
    out = scene_dir / "metadata.json"

    if not inp.exists():
        raise FileNotFoundError(f"Missing input file: {inp}")

    d = np.load(inp, allow_pickle=True).item()

    viz_order = list(d.get("viz_camera_order", []))
    cam_order = list(d.get("camera_order", []))
    tr_quat_fovs = list(d.get("tr_quat_fovs", []))

    cameras: Dict[str, Dict[str, Any]] = {}
    # Assume tr_quat_fovs aligned with camera_order
    for name, tqf in zip(cam_order, tr_quat_fovs):
        tr, quat, fov = tqf
        cameras[str(name)] = {
            "t": _to_py(tr),
            "q": _to_py(quat),
            "fov": _to_py(fov),
        }

    payload = {
        "viz_camera_order": viz_order if viz_order else list(cameras.keys()),
        "camera_order": cam_order if cam_order else list(cameras.keys()),
        # Keep convention explicit; your python overlay defaults to wxyz.
        "quat_convention": "wxyz",
        # BEV bounds (meters). For your current occupancy renders this is [-40,40]x[-40,40].
        # Stored as x/y for convenience; JS assumes these are BEV coords after world->bev mapping.
        "bounds": {"x": [-40.0, 40.0], "y": [-40.0, 40.0]},
        "cameras": cameras,
    }

    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

