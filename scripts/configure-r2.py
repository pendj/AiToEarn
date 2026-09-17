#!/usr/bin/env python3
"""Record dedicated R2 S3 credentials without printing them or changing the app."""

import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys


def save_credentials(root, access_key, secret_key):
    if not re.fullmatch(r"[a-f0-9]{32}", access_key) or not re.fullmatch(r"[a-f0-9]{64}", secret_key):
        raise ValueError("Use the R2 Access Key ID and Secret Access Key, not an API token")
    private = root / ".private"
    if private.is_symlink():
        raise ValueError("Private directory must not be a symbolic link")
    private.mkdir(mode=0o700, parents=True, exist_ok=True)
    if private.stat().st_mode & 0o077:
        raise ValueError("Private directory permissions must be 0700")
    config = {
        "provider": "r2", "region": "auto",
        "endpoint": "https://08c44086c81cc0cea32aa0288236416f.r2.cloudflarestorage.com",
        "bucket": "luxsabers-social-media", "accessKey": access_key, "secretKey": secret_key,
    }
    descriptor = os.open(private / "r2.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write(json.dumps(config, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise SystemExit("Use an interactive terminal; credentials must not be passed in command arguments")
    print("Enter a dedicated Object Read & Write token restricted to luxsabers-social-media. Input is hidden.")
    try:
        save_credentials(args.root.resolve(), getpass.getpass("Access Key ID: "), getpass.getpass("Secret Access Key: "))
    except FileExistsError:
        raise SystemExit("Existing R2 configuration preserved; no credential rotation performed") from None
    except (ValueError, OSError):
        raise SystemExit("Could not save private R2 credentials; check key format and private file permissions") from None
    print("Saved private R2 credentials (0600). No network request, upload or application switch occurred.")


if __name__ == "__main__":
    main()
