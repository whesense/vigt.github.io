#!/usr/bin/env python3
"""
Convert a PLY point cloud (binary little-endian, XYZ only) into:
- .bin: little-endian float32 interleaved XYZ
- .json: metadata for the JS viewer

This is intended for local-only exports from data_raw/ into the served JS app tree.

Convention: match current occupancy 3D viewer (X/Y swap), Z-up.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple


@dataclass(frozen=True)
class PlyHeader:
    vertex_count: int
    format: str
    header_bytes: int
    properties: Tuple[Tuple[str, str], ...]  # (type, name)


def _read_ply_header(ply_path: Path) -> PlyHeader:
    with ply_path.open("rb") as f:
        header_lines = []
        header_bytes = 0
        while True:
            line = f.readline()
            if not line:
                raise ValueError("Unexpected EOF while reading PLY header")
            header_bytes += len(line)
            try:
                s = line.decode("ascii").strip()
            except UnicodeDecodeError as e:
                raise ValueError("PLY header is not ASCII-decodable") from e
            header_lines.append(s)
            if s == "end_header":
                break

    if not header_lines or header_lines[0] != "ply":
        raise ValueError("Not a PLY file (missing 'ply' magic)")

    fmt = None
    vertex_count = None
    in_vertex = False
    props: List[Tuple[str, str]] = []

    for s in header_lines:
        if s.startswith("format "):
            fmt = s.split(" ", 1)[1].strip()
        elif s.startswith("element "):
            parts = s.split()
            if len(parts) == 3 and parts[1] == "vertex":
                vertex_count = int(parts[2])
                in_vertex = True
            else:
                in_vertex = False
        elif in_vertex and s.startswith("property "):
            parts = s.split()
            if len(parts) == 3:
                # property <type> <name>
                props.append((parts[1], parts[2]))

    if fmt is None:
        raise ValueError("PLY header missing format")
    if vertex_count is None:
        raise ValueError("PLY header missing vertex count")

    return PlyHeader(
        vertex_count=vertex_count,
        format=fmt,
        header_bytes=header_bytes,
        properties=tuple(props),
    )


def convert_ply_to_bin_json(ply_path: Path, outdir: Path, name: str, xy_swap: bool = True) -> None:
    ply_path = Path(ply_path)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    header = _read_ply_header(ply_path)
    count = int(header.vertex_count)

    # Stream-convert: read PLY payload and write BIN in one pass.
    import struct

    bin_path = outdir / f"{name}.bin"
    json_path = outdir / f"{name}.json"

    x_min = float("inf")
    x_max = float("-inf")
    y_min = float("inf")
    y_max = float("-inf")
    z_min = float("inf")
    z_max = float("-inf")

    prop_types = [t for t, _ in header.properties]
    prop_names = [n for _, n in header.properties]
    if not {"x", "y", "z"}.issubset(set(prop_names)):
        raise ValueError(f"PLY vertex properties must include x,y,z. Got: {prop_names}")
    x_idx = prop_names.index("x")
    y_idx = prop_names.index("y")
    z_idx = prop_names.index("z")

    with ply_path.open("rb") as fin, bin_path.open("wb") as fout:
        fin.seek(header.header_bytes)

        if header.format == "ascii 1.0":
            for i in range(count):
                line = fin.readline()
                if not line:
                    raise ValueError(f"Unexpected EOF in ASCII PLY at vertex {i}/{count}")
                parts = line.decode("ascii").strip().split()
                if len(parts) < len(prop_names):
                    raise ValueError(f"Malformed ASCII vertex line {i}: expected {len(prop_names)} values")
                x = float(parts[x_idx])
                y = float(parts[y_idx])
                z = float(parts[z_idx])
                if xy_swap:
                    x, y = y, x
                x_min = min(x_min, x)
                x_max = max(x_max, x)
                y_min = min(y_min, y)
                y_max = max(y_max, y)
                z_min = min(z_min, z)
                z_max = max(z_max, z)
                fout.write(struct.pack("<fff", x, y, z))
        elif header.format == "binary_little_endian 1.0":
            # Support extra per-vertex properties; extract x/y/z by name.
            ply_to_struct = {
                "char": "b",
                "uchar": "B",
                "int8": "b",
                "uint8": "B",
                "short": "h",
                "ushort": "H",
                "int16": "h",
                "uint16": "H",
                "int": "i",
                "uint": "I",
                "int32": "i",
                "uint32": "I",
                "float": "f",
                "float32": "f",
                "double": "d",
                "float64": "d",
            }
            try:
                record_fmt = "<" + "".join(ply_to_struct[t] for t in prop_types)
            except KeyError as e:
                raise ValueError(f"Unsupported PLY property type in binary mode: {e}") from e

            record_size = struct.calcsize(record_fmt)
            chunk_records = 65536
            remaining = count

            while remaining > 0:
                n = min(remaining, chunk_records)
                buf = fin.read(n * record_size)
                if len(buf) != n * record_size:
                    raise ValueError(
                        f"Unexpected EOF while reading PLY payload: got {len(buf)} bytes, expected {n * record_size}"
                    )
                out = bytearray(n * 12)
                offset = 0
                for rec in struct.iter_unpack(record_fmt, buf):
                    x = float(rec[x_idx])
                    y = float(rec[y_idx])
                    z = float(rec[z_idx])
                    if xy_swap:
                        x, y = y, x
                    x_min = min(x_min, x)
                    x_max = max(x_max, x)
                    y_min = min(y_min, y)
                    y_max = max(y_max, y)
                    z_min = min(z_min, z)
                    z_max = max(z_max, z)
                    struct.pack_into("<fff", out, offset, x, y, z)
                    offset += 12

                fout.write(out)
                remaining -= n
        else:
            raise ValueError(
                f"Unsupported PLY format: {header.format} (expected ascii 1.0 or binary_little_endian 1.0)"
            )

    bounds = {"x": [x_min, x_max], "y": [y_min, y_max], "z": [z_min, z_max]}

    metadata = {
        "points_file": bin_path.name,
        "count": count,
        "stride_bytes": 12,
        "attributes": [
            {"name": "position", "type": "float32", "components": 3, "offset": 0}
        ],
        "bounds": bounds,
        "convention": {
            "up_axis": "Z",
            "xy_swap": bool(xy_swap),
            "data_is_swapped": True,
        },
        "source": {
            "ply": str(ply_path),
            "ply_format": header.format,
            "vertex_count": header.vertex_count,
        },
    }

    json_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    mb = bin_path.stat().st_size / (1024 * 1024)
    print(f"Wrote {json_path}")
    print(f"Wrote {bin_path} ({mb:.2f} MB, {count} points)")


def main() -> None:
    p = argparse.ArgumentParser(description="Convert binary little-endian XYZ PLY to JSON+BIN for JS viewer.")
    p.add_argument("ply", type=str, help="Input PLY path (e.g. data_raw/frame_000121/vigt_frame000121.ply)")
    p.add_argument("--outdir", type=str, required=True, help="Output directory inside the JS app tree")
    p.add_argument("--name", type=str, required=True, help="Base name for output files (no extension)")
    p.add_argument("--no-xy-swap", action="store_true", help="Do NOT swap X/Y (default swaps to match occupancy 3D)")
    args = p.parse_args()

    convert_ply_to_bin_json(
        ply_path=Path(args.ply),
        outdir=Path(args.outdir),
        name=args.name,
        xy_swap=not args.no_xy_swap,
    )


if __name__ == "__main__":
    main()
