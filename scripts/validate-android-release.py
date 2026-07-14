#!/usr/bin/env python3
"""Normalize and validate Android artifacts produced by the release workflow."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from zipfile import BadZipFile, ZipFile


EXPECTED_APK_ABIS = {
    "app-arm64-release.apk": {"arm64-v8a"},
    "app-x86_64-release.apk": {"x86_64"},
    "app-universal-release.apk": {"arm64-v8a", "x86_64"},
}
EXPECTED_AAB_NAME = "app-universal-release.aab"
EXPECTED_AAB_ABIS = {"arm64-v8a", "x86_64"}


@dataclass(frozen=True)
class PackageMetadata:
    application_id: str
    version_code: str
    version_name: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        type=Path,
        required=True,
        help="Directory containing Android build outputs.",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        help="Optional GitHub Actions step summary file.",
    )
    parser.add_argument(
        "--normalize-apks",
        action="store_true",
        help="Rename Gradle ABI-split APK outputs to the release asset contract.",
    )
    return parser.parse_args()


def fail(message: str) -> None:
    raise SystemExit(f"Android release validation failed: {message}")


def find_exactly_one(root: Path, name: str) -> Path:
    matches = [path for path in root.rglob(name) if path.is_file()]
    if len(matches) != 1:
        fail(f"expected exactly one {name}, found {len(matches)}")
    return matches[0]


def archive_abis(path: Path, *, aab: bool = False) -> set[str]:
    abis: set[str] = set()
    try:
        with ZipFile(path) as archive:
            for name in archive.namelist():
                parts = name.split("/")
                if aab:
                    if (
                        len(parts) >= 4
                        and parts[0] == "base"
                        and parts[1] == "lib"
                        and parts[-1].endswith(".so")
                    ):
                        abis.add(parts[2])
                elif (
                    len(parts) >= 3
                    and parts[0] == "lib"
                    and parts[-1].endswith(".so")
                ):
                    abis.add(parts[1])
    except BadZipFile as error:
        fail(f"{path.name} is not a valid ZIP archive: {error}")
    return abis


def normalize_apks(root: Path) -> None:
    discovered = sorted(path for path in root.rglob("*.apk") if path.is_file())
    expected_names_by_abis = {
        frozenset(abis): name for name, abis in EXPECTED_APK_ABIS.items()
    }
    sources_by_name: dict[str, Path] = {}

    for path in discovered:
        abis = frozenset(archive_abis(path))
        expected_name = expected_names_by_abis.get(abis)
        if expected_name is None:
            fail(f"unexpected APK {path.name} contains ABIs {sorted(abis)}")
        if expected_name in sources_by_name:
            fail(
                f"multiple APKs contain ABIs {sorted(abis)}: "
                f"{sources_by_name[expected_name].name}, {path.name}"
            )
        sources_by_name[expected_name] = path

    missing = sorted(set(EXPECTED_APK_ABIS) - set(sources_by_name))
    if missing:
        fail(f"missing APK outputs for release assets: {missing}")

    pending: list[tuple[Path, Path]] = []
    for index, (expected_name, source) in enumerate(sources_by_name.items()):
        destination = source.with_name(expected_name)
        if source == destination:
            continue
        temporary = source.with_name(f".cfms-normalize-{index}.apk")
        if destination.exists() or temporary.exists():
            fail(f"cannot normalize {source.name}: destination already exists")
        source.rename(temporary)
        pending.append((temporary, destination))

    for temporary, destination in pending:
        temporary.rename(destination)
        print(f"Normalized {temporary.name} to {destination.name}.")


def version_key(path: Path) -> tuple[int, ...]:
    numbers = re.findall(r"\d+", path.name)
    return tuple(int(value) for value in numbers)


def find_android_tool(name: str) -> Path:
    android_home = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not android_home:
        fail("ANDROID_HOME or ANDROID_SDK_ROOT is not set")

    build_tools_root = Path(android_home) / "build-tools"
    if not build_tools_root.is_dir():
        fail(f"Android build-tools directory does not exist: {build_tools_root}")
    versions = sorted(
        (path for path in build_tools_root.iterdir() if path.is_dir()),
        key=version_key,
    )
    if not versions:
        fail(f"no Android build-tools installation found under {build_tools_root}")

    for suffix in ("", ".exe", ".bat"):
        candidate = versions[-1] / f"{name}{suffix}"
        if candidate.is_file():
            return candidate
    fail(f"Android tool {name} was not found in {versions[-1]}")


def run_tool(tool: Path, *arguments: str) -> str:
    result = subprocess.run(
        [str(tool), *arguments],
        check=False,
        capture_output=True,
        text=True,
    )
    output = "\n".join(value for value in (result.stdout, result.stderr) if value).strip()
    if result.returncode != 0:
        command = " ".join([tool.name, *arguments])
        fail(f"{command} exited with {result.returncode}: {output}")
    return output


def read_package_metadata(aapt: Path, apk: Path) -> PackageMetadata:
    output = run_tool(aapt, "dump", "badging", str(apk))
    package_line = next((line for line in output.splitlines() if line.startswith("package: ")), None)
    if package_line is None:
        fail(f"aapt did not report package metadata for {apk.name}")

    def attribute(name: str) -> str:
        match = re.search(rf"\b{name}='([^']*)'", package_line)
        if match is None:
            fail(f"aapt did not report {name} for {apk.name}")
        return match.group(1)

    return PackageMetadata(
        application_id=attribute("name"),
        version_code=attribute("versionCode"),
        version_name=attribute("versionName"),
    )


def certificate_sha256_digests(output: str) -> frozenset[str]:
    certificate_bodies = re.findall(
        r"-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----",
        output,
        flags=re.DOTALL,
    )
    if not certificate_bodies:
        raise ValueError("no PEM signing certificates were reported")

    digests: set[str] = set()
    for index, body in enumerate(certificate_bodies, start=1):
        encoded = "".join(body.split())
        try:
            certificate = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError(f"signing certificate {index} contains invalid PEM data") from error
        if not certificate:
            raise ValueError(f"signing certificate {index} is empty")
        digests.add(hashlib.sha256(certificate).hexdigest())

    return frozenset(digests)


def read_signer_digests(apksigner: Path, apk: Path) -> frozenset[str]:
    output = run_tool(apksigner, "verify", "--verbose", "--print-certs-pem", str(apk))
    try:
        return certificate_sha256_digests(output)
    except ValueError as error:
        fail(f"could not read signing certificates for {apk.name}: {error}")


def format_size(size: int) -> str:
    return f"{size / (1024 * 1024):.2f} MiB"


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        fail(f"artifact root does not exist: {root}")

    if args.normalize_apks:
        normalize_apks(root)

    apks = {name: find_exactly_one(root, name) for name in EXPECTED_APK_ABIS}
    aab = find_exactly_one(root, EXPECTED_AAB_NAME)

    expected_apks = {path.resolve() for path in apks.values()}
    expected_aabs = {aab.resolve()}
    discovered_apks = {path.resolve() for path in root.rglob("*.apk") if path.is_file()}
    discovered_aabs = {path.resolve() for path in root.rglob("*.aab") if path.is_file()}
    if discovered_apks != expected_apks:
        unexpected = sorted(path.name for path in discovered_apks - expected_apks)
        fail(f"unexpected APK artifacts found: {unexpected}")
    if discovered_aabs != expected_aabs:
        unexpected = sorted(path.name for path in discovered_aabs - expected_aabs)
        fail(f"unexpected AAB artifacts found: {unexpected}")

    for name, expected_abis in EXPECTED_APK_ABIS.items():
        actual_abis = archive_abis(apks[name])
        if actual_abis != expected_abis:
            fail(f"{name} contains ABIs {sorted(actual_abis)}, expected {sorted(expected_abis)}")

    actual_aab_abis = archive_abis(aab, aab=True)
    if actual_aab_abis != EXPECTED_AAB_ABIS:
        fail(
            f"{EXPECTED_AAB_NAME} contains ABIs {sorted(actual_aab_abis)}, "
            f"expected {sorted(EXPECTED_AAB_ABIS)}"
        )

    universal_size = apks["app-universal-release.apk"].stat().st_size
    for name in ("app-arm64-release.apk", "app-x86_64-release.apk"):
        if apks[name].stat().st_size >= universal_size:
            fail(f"{name} is not smaller than app-universal-release.apk")

    aapt = find_android_tool("aapt")
    apksigner = find_android_tool("apksigner")
    metadata = {name: read_package_metadata(aapt, path) for name, path in apks.items()}
    signer_digests = {name: read_signer_digests(apksigner, path) for name, path in apks.items()}
    if len(set(metadata.values())) != 1:
        fail(f"APK package metadata differs: {metadata}")
    if len(set(signer_digests.values())) != 1:
        fail(f"APK signing certificates differ: {signer_digests}")

    reference_metadata = next(iter(metadata.values()))
    rows = []
    for name, path in apks.items():
        size = path.stat().st_size
        reduction = (1 - size / universal_size) * 100 if size < universal_size else 0
        rows.append((name, ", ".join(sorted(EXPECTED_APK_ABIS[name])), size, reduction))

    print(
        "Validated Android release artifacts for "
        f"{reference_metadata.application_id} {reference_metadata.version_name} "
        f"(versionCode {reference_metadata.version_code})."
    )
    for name, abis, size, reduction in rows:
        print(f"- {name}: {format_size(size)}, ABIs={abis}, reduction={reduction:.1f}%")
    print(f"- {EXPECTED_AAB_NAME}: {format_size(aab.stat().st_size)}, ABIs=arm64-v8a, x86_64")

    summary = args.summary
    if summary is not None:
        with summary.open("a", encoding="utf-8") as output:
            output.write("## Android release artifacts\n\n")
            output.write(
                f"Package `{reference_metadata.application_id}`, version "
                f"`{reference_metadata.version_name}` (`{reference_metadata.version_code}`).\n\n"
            )
            output.write("| Artifact | ABIs | Size | Reduction vs universal |\n")
            output.write("|---|---|---:|---:|\n")
            for name, abis, size, reduction in rows:
                output.write(f"| `{name}` | {abis} | {format_size(size)} | {reduction:.1f}% |\n")
            output.write(
                f"| `{EXPECTED_AAB_NAME}` | arm64-v8a, x86_64 | "
                f"{format_size(aab.stat().st_size)} | n/a |\n\n"
            )


if __name__ == "__main__":
    main()
