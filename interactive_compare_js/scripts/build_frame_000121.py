#!/usr/bin/env python3
"""
Build a portable compare-scene bundle for frame 121:
- Copies ring camera images
- Converts occupancy NPZ -> (json + bin) without numpy
- Converts VIGT PLY -> (json + bin) by calling the pointcloud exporter
- Writes a scene.json manifest consumed by interactive_compare_js

Outputs:
interactive_compare_js/data/scenes/frame_000121/
  scene.json
  images/*.jpg
  occ_frame000121.json + occ_frame000121.bin
  vigt_frame000121.json + vigt_frame000121.bin
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import sys
import zipfile
from ast import literal_eval
from pathlib import Path


def _read_npy_header_from_file(f) -> tuple[str, tuple[int, ...], bool, int]:
    """
    Returns: (dtype_str, shape, fortran_order, header_total_bytes)
    Leaves f positioned at start of raw data.
    """
    magic = f.read(6)
    if magic != b"\x93NUMPY":
        raise ValueError("Not a .npy file (bad magic)")
    major, minor = f.read(2)
    major = int(major)
    minor = int(minor)
    if (major, minor) not in [(1, 0), (2, 0), (3, 0)]:
        raise ValueError(f"Unsupported .npy version {(major, minor)}")

    if major in (1, 2):
        header_len = struct.unpack("<H", f.read(2))[0]
        header_total = 6 + 2 + 2 + header_len
    else:
        header_len = struct.unpack("<I", f.read(4))[0]
        header_total = 6 + 2 + 4 + header_len

    header_bytes = f.read(header_len)
    header = literal_eval(header_bytes.decode("latin1"))
    dtype_str = header["descr"]
    fortran_order = bool(header["fortran_order"])
    shape = tuple(int(x) for x in header["shape"])

    # f is now at data start
    return dtype_str, shape, fortran_order, header_total


def _read_small_npy_array(zf: zipfile.ZipFile, member: str) -> list[float]:
    with zf.open(member, "r") as f:
        dtype_str, shape, fortran_order, _ = _read_npy_header_from_file(f)
        if fortran_order:
            raise ValueError(f"{member}: fortran_order not supported for metadata arrays")
        # read entire payload (small arrays only)
        payload = f.read()

    # Support small float64/float32/int arrays; only used for bounds/voxel_size/grid_shape
    # Shape may be () or (n,)
    n = 1
    for s in shape:
        n *= s
    if n == 0:
        return []

    if dtype_str == "<f8":
        fmt = "<" + "d" * n
    elif dtype_str == "<f4":
        fmt = "<" + "f" * n
    elif dtype_str in ("<i8", "<u8"):
        fmt = "<" + ("q" if dtype_str == "<i8" else "Q") * n
    elif dtype_str in ("<i4", "<u4"):
        fmt = "<" + ("i" if dtype_str == "<i4" else "I") * n
    else:
        raise ValueError(f"{member}: unsupported dtype {dtype_str} for metadata")

    vals = list(struct.unpack(fmt, payload[: struct.calcsize(fmt)]))
    return [float(v) for v in vals]


def convert_occupancy_npz_to_bin_json(npz_path: Path, outdir: Path, stem: str) -> tuple[Path, Path]:
    npz_path = Path(npz_path)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    bin_path = outdir / f"{stem}.bin"
    json_path = outdir / f"{stem}.json"

    with zipfile.ZipFile(npz_path, "r") as zf:
        names = set(zf.namelist())
        occ_member = None
        for cand in ("occupancy.npy", "arr_0.npy"):
            if cand in names:
                occ_member = cand
                break
        if occ_member is None:
            raise ValueError(f"No occupancy.npy/arr_0.npy in {npz_path}")

        # Optional metadata members
        def get2(name, default=None):
            m = f"{name}.npy"
            return _read_small_npy_array(zf, m) if m in names else default

        x_bounds = get2("x_bounds", None)
        y_bounds = get2("y_bounds", None)
        z_bounds = get2("z_bounds", None)
        voxel_size_arr = get2("voxel_size", None)
        grid_shape_arr = get2("grid_shape", None)

        with zf.open(occ_member, "r") as f:
            dtype_str, shape, fortran_order, _ = _read_npy_header_from_file(f)
            if fortran_order:
                raise ValueError(f"{occ_member}: fortran_order not supported")

            # Expect (nx, ny, nz)
            if len(shape) != 3:
                raise ValueError(f"{occ_member}: expected 3D array, got shape {shape}")
            nx, ny, nz = shape
            expected_count = nx * ny * nz

            # Determine bounds/voxel_size defaults similar to occupancy converter
            x0, x1 = (x_bounds or [-40.0, 40.0])[:2]
            y0, y1 = (y_bounds or [-40.0, 40.0])[:2]
            z0, z1 = (z_bounds or [-1.0, 5.4])[:2]
            voxel_size = float((voxel_size_arr or [0.2])[0])
            grid_shape = [int(v) for v in (grid_shape_arr or [nx, ny, nz])[:3]]

            if dtype_str != "<f4":
                raise ValueError(
                    f"{occ_member}: occupancy dtype {dtype_str} not supported by numpy-free converter. "
                    f"Please re-export occupancy as float32 little-endian."
                )

            # Stream copy to bin while computing min/max
            import array

            min_v = float("inf")
            max_v = float("-inf")
            bytes_expected = expected_count * 4
            bytes_read = 0

            with bin_path.open("wb") as out:
                while bytes_read < bytes_expected:
                    chunk = f.read(min(4 * 262144, bytes_expected - bytes_read))
                    if not chunk:
                        break
                    out.write(chunk)
                    bytes_read += len(chunk)

                    a = array.array("f")
                    a.frombytes(chunk)
                    if a:
                        cmin = min(a)
                        cmax = max(a)
                        min_v = min(min_v, cmin)
                        max_v = max(max_v, cmax)

            if bytes_read != bytes_expected:
                raise ValueError(
                    f"{occ_member}: unexpected EOF reading occupancy payload: {bytes_read} bytes, expected {bytes_expected}"
                )

    metadata = {
        "occupancy_file": bin_path.name,
        "grid_shape": grid_shape,
        "bounds": {"x": [float(x0), float(x1)], "y": [float(y0), float(y1)], "z": [float(z0), float(z1)]},
        "voxel_size": float(voxel_size),
        "occupancy_range": [float(min_v), float(max_v)],
    }
    json_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {json_path}")
    print(f"Wrote {bin_path} ({bin_path.stat().st_size / (1024 * 1024):.2f} MB)")
    return json_path, bin_path


def copy_images(src_dir: Path, out_dir: Path) -> list[dict]:
    src_dir = Path(src_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    imgs = sorted(src_dir.glob("ring_*.jpg"))
    if not imgs:
        raise FileNotFoundError(f"No ring_*.jpg found in {src_dir}")

    out = []
    for p in imgs:
        dst = out_dir / p.name
        shutil.copy2(p, dst)
        # name: ring_front_center.jpg -> ring front center
        label = p.stem.replace("ring_", "").replace("_", " ")
        out.append({"name": label, "url": f"images/{p.name}"})
    return out


def run_pointcloud_exporter(ply_path: Path, outdir: Path, name: str) -> None:
    exporter = Path("interactive_pointcloud_js/scripts/convert_ply_to_bin_json.py")
    if not exporter.exists():
        raise FileNotFoundError(f"Missing pointcloud exporter: {exporter}")
    import subprocess

    cmd = [
        sys.executable,
        str(exporter),
        str(ply_path),
        "--outdir",
        str(outdir),
        "--name",
        name,
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frame", type=int, default=121, help="Frame index (default: 121)")
    ap.add_argument("--outroot", type=str, default="interactive_compare_js/data/scenes", help="Output scenes root")
    ap.add_argument("--images", type=str, default="data_raw/frame_121", help="Input images directory")
    ap.add_argument("--occ", type=str, default="data_raw/occ_av2_121_400x400x32.npz", help="Input occupancy npz")
    ap.add_argument("--vigt_ply", type=str, default="data_raw/frame_000121/vigt_frame000121.ply", help="Input ViGT ply")
    ap.add_argument("--gt_ply", type=str, default="data_raw/frame_000121/gt_frame000121.ply", help="Input GT ply")
    ap.add_argument("--renderocc_ply", type=str, default="data_raw/frame_000121/renderocc_frame000121.ply", help="Input RenderOcc ply")
    ap.add_argument("--cut3r_ply", type=str, default="data_raw/frame_000121/cut3r_frame000121.ply", help="Input Cut3r ply")
    ap.add_argument("--vggt_ply", type=str, default="data_raw/frame_000121/vggt_frame000121.ply", help="Input VGGT ply")
    args = ap.parse_args()

    frame_dir = Path(args.outroot) / "frame_000121"
    frame_dir.mkdir(parents=True, exist_ok=True)

    images_dir = frame_dir / "images"
    images = copy_images(Path(args.images), images_dir)

    occ_json, occ_bin = convert_occupancy_npz_to_bin_json(
        npz_path=Path(args.occ),
        outdir=frame_dir,
        stem="occ_frame000121",
    )

    # Point clouds (export all available sources)
    pointclouds = [
        ("vigt", "ViGT", Path(args.vigt_ply), "vigt_frame000121"),
        ("gt", "GT", Path(args.gt_ply), "gt_frame000121"),
        ("renderocc", "RenderOcc", Path(args.renderocc_ply), "renderocc_frame000121"),
        ("cut3r", "Cut3r", Path(args.cut3r_ply), "cut3r_frame000121"),
        ("vggt", "VGGT", Path(args.vggt_ply), "vggt_frame000121"),
    ]

    for key, label, ply_path, out_name in pointclouds:
        if not ply_path.exists():
            raise FileNotFoundError(f"Missing pointcloud source ({key}): {ply_path}")
        run_pointcloud_exporter(
            ply_path=ply_path,
            outdir=frame_dir,
            name=out_name,
        )

    scene = {
        "frame": int(args.frame),
        "images": images,
        "occupancy": {"url": occ_json.name},
        # Backward-compat (legacy single pointcloud)
        "pointcloud": {"url": "vigt_frame000121.json"},
        # New multi-pointcloud list (used by compare selectors)
        "pointclouds": [
            {"key": key, "label": label, "url": f"{out_name}.json"}
            for (key, label, _ply, out_name) in pointclouds
        ],
    }
    (frame_dir / "scene.json").write_text(json.dumps(scene, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {frame_dir / 'scene.json'}")


if __name__ == "__main__":
    main()

