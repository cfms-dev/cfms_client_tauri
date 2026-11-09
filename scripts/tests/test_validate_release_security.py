from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).parents[1] / "validate-release-security.py"
SPEC = importlib.util.spec_from_file_location("validate_release_security", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load {SCRIPT_PATH}")
VALIDATOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = VALIDATOR
SPEC.loader.exec_module(VALIDATOR)


class ReleaseSecurityTests(unittest.TestCase):
    def test_frontend_source_map_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory)
            (dist / "app.js.map").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "source maps"):
                VALIDATOR.validate_frontend_dist(dist)

    def test_android_backup_must_be_explicitly_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "AndroidManifest.xml"
            manifest.write_text(
                '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
                '<application android:allowBackup="false" />'
                "</manifest>",
                encoding="utf-8",
            )
            VALIDATOR.validate_android_manifest(manifest)

            manifest.write_text(
                '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
                "<application />"
                "</manifest>",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "allowBackup"):
                VALIDATOR.validate_android_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
