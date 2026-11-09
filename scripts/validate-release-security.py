#!/usr/bin/env python3
"""Validate security-relevant release settings and Windows PE mitigations."""

from __future__ import annotations

import argparse
import struct
import xml.etree.ElementTree as ET
from pathlib import Path

IMAGE_DLLCHARACTERISTICS_HIGH_ENTROPY_VA = 0x0020
IMAGE_DLLCHARACTERISTICS_DYNAMIC_BASE = 0x0040
IMAGE_DLLCHARACTERISTICS_NX_COMPAT = 0x0100
IMAGE_GUARD_CF_INSTRUMENTED = 0x00000100
ANDROID_NS = "http://schemas.android.com/apk/res/android"


def fail(message: str) -> None:
    raise SystemExit(f"Release security validation failed: {message}")


def validate_frontend_dist(path: Path) -> None:
    if not path.is_dir():
        fail(f"frontend distribution does not exist: {path}")
    maps = sorted(item for item in path.rglob("*.map") if item.is_file())
    if maps:
        fail(f"source maps must not be distributed: {[str(item) for item in maps]}")


def validate_android_manifest(path: Path) -> None:
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError) as error:
        fail(f"could not read Android manifest {path}: {error}")
    application = root.find("application")
    if application is None:
        fail("Android manifest does not contain an application element")
    if application.get(f"{{{ANDROID_NS}}}allowBackup") != "false":
        fail("Android application must explicitly set android:allowBackup=\"false\"")
    if application.get(f"{{{ANDROID_NS}}}debuggable") == "true":
        fail("Android application must not be debuggable")


def read_u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def read_u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def rva_to_offset(data: bytes, section_table: int, sections: int, rva: int) -> int:
    for index in range(sections):
        offset = section_table + index * 40
        virtual_size = read_u32(data, offset + 8)
        virtual_address = read_u32(data, offset + 12)
        raw_size = read_u32(data, offset + 16)
        raw_offset = read_u32(data, offset + 20)
        if virtual_address <= rva < virtual_address + max(virtual_size, raw_size):
            return raw_offset + (rva - virtual_address)
    fail(f"PE RVA 0x{rva:x} is not covered by a section")


def validate_windows_pe(path: Path) -> None:
    try:
        data = path.read_bytes()
        pe = read_u32(data, 0x3C)
        if data[pe : pe + 4] != b"PE\0\0":
            fail(f"{path} has no valid PE signature")
        coff = pe + 4
        sections = read_u16(data, coff + 2)
        optional_size = read_u16(data, coff + 16)
        optional = coff + 20
        if read_u16(data, optional) != 0x20B:
            fail("Windows release binary must be PE32+ (64-bit)")
        dll_characteristics = read_u16(data, optional + 70)
        required = (
            IMAGE_DLLCHARACTERISTICS_HIGH_ENTROPY_VA
            | IMAGE_DLLCHARACTERISTICS_DYNAMIC_BASE
            | IMAGE_DLLCHARACTERISTICS_NX_COMPAT
        )
        missing = required & ~dll_characteristics
        if missing:
            fail(f"Windows PE is missing required DLL characteristics 0x{missing:04x}")

        load_config_rva = read_u32(data, optional + 112 + 10 * 8)
        if load_config_rva == 0:
            fail("Windows PE has no load configuration directory")
        section_table = optional + optional_size
        load_config = rva_to_offset(data, section_table, sections, load_config_rva)
        guard_flags = read_u32(data, load_config + 0x90)
        if not guard_flags & IMAGE_GUARD_CF_INSTRUMENTED:
            fail("Windows PE is not instrumented for Control Flow Guard")
    except (OSError, IndexError, struct.error) as error:
        fail(f"could not parse Windows PE {path}: {error}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frontend-dist", type=Path)
    parser.add_argument("--android-manifest", type=Path)
    parser.add_argument("--windows-binary", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not any((args.frontend_dist, args.android_manifest, args.windows_binary)):
        fail("at least one artifact or manifest must be supplied")
    if args.frontend_dist:
        validate_frontend_dist(args.frontend_dist)
    if args.android_manifest:
        validate_android_manifest(args.android_manifest)
    if args.windows_binary:
        validate_windows_pe(args.windows_binary)
    print("Release security validation passed.")


if __name__ == "__main__":
    main()
