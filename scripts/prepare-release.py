#!/usr/bin/env python3
"""Render a secret-free Compose environment from reviewed image pins."""

import argparse
import json
import os
from pathlib import Path
import re

parser = argparse.ArgumentParser()
parser.add_argument("--release", required=True)
parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
args = parser.parse_args()
if not re.fullmatch(r"[a-f0-9]{40}", args.release):
    raise SystemExit("Release must be a full Git commit SHA")
root = args.root.resolve()
lock = json.loads((root / "images.lock.json").read_text())
lines = []
for variable, image in lock["images"].items():
    if not re.fullmatch(r"[a-z0-9/._-]+@sha256:[a-f0-9]{64}", image):
        raise SystemExit("Unpinned or invalid image")
    lines.append(f"{variable}={image}")
lines.extend([f"RELEASE_ID={args.release}", f"DEPLOY_UID={os.getuid()}", f"DEPLOY_GID={os.getgid()}"])
content = "\n".join(lines) + "\n"
path = root / ".env"
if path.exists():
    previous = path.read_text()
    if previous == content:
        print("Release environment unchanged")
        raise SystemExit(0)
    match = re.search(r"^RELEASE_ID=([a-f0-9]{40})$", previous, re.M)
    if not match:
        raise SystemExit("Existing environment has no valid release; refusing replacement")
    backup = root / ".runtime/releases" / (match.group(1) + ".env")
    backup.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not backup.exists():
        backup.write_text(previous)
        backup.chmod(0o600)
temporary = root / ".env.pending"
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w") as output:
    output.write(content)
temporary.replace(path)
print("Prepared pinned release environment; previous environment preserved when applicable")
