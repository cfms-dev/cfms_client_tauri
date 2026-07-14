from __future__ import annotations

import base64
import hashlib
import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "validate-android-release.py"
SPEC = importlib.util.spec_from_file_location("validate_android_release", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load {SCRIPT_PATH}")
VALIDATOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = VALIDATOR
SPEC.loader.exec_module(VALIDATOR)


def pem(certificate: bytes) -> str:
    encoded = base64.b64encode(certificate).decode("ascii")
    return f"-----BEGIN CERTIFICATE-----\n{encoded}\n-----END CERTIFICATE-----"


class CertificateDigestTests(unittest.TestCase):
    def test_hashes_pem_instead_of_human_readable_signer_labels(self) -> None:
        certificate = b"release certificate"
        output = "\n".join(
            (
                "Signer (minSdkVersion=28, maxSdkVersion=35) certificate SHA-256 digest: ignored",
                pem(certificate),
            )
        )

        self.assertEqual(
            VALIDATOR.certificate_sha256_digests(output),
            frozenset((hashlib.sha256(certificate).hexdigest(),)),
        )

    def test_multiple_certificates_are_order_independent(self) -> None:
        first = b"first certificate"
        second = b"second certificate"
        expected = frozenset(
            (hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest())
        )

        self.assertEqual(
            VALIDATOR.certificate_sha256_digests(f"{pem(first)}\n{pem(second)}"),
            expected,
        )
        self.assertEqual(
            VALIDATOR.certificate_sha256_digests(f"{pem(second)}\n{pem(first)}"),
            expected,
        )

    def test_missing_certificate_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "no PEM signing certificates"):
            VALIDATOR.certificate_sha256_digests("Number of signers: 1")

    def test_invalid_certificate_encoding_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid PEM data"):
            VALIDATOR.certificate_sha256_digests(
                "-----BEGIN CERTIFICATE-----\nnot base64!\n-----END CERTIFICATE-----"
            )


if __name__ == "__main__":
    unittest.main()
