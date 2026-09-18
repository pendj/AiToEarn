#!/usr/bin/env python3
"""Move only this project's initial private origins, preserving all secrets."""

import json
import os
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
changes = []
for name in ["gateway.json", "server.yaml", "ai.yaml"]:
    path = root / ".private" / name
    value = json.loads(path.read_text())
    if name == "gateway.json":
        expected = ["http://127.0.0.1:18080", "http://localhost:18080"]
        target = ["http://127.0.0.1:18880", "http://localhost:18880"]
        if value["origins"] == target:
            continue
        if value["origins"] != expected:
            raise SystemExit("Unexpected origins; refusing automatic migration")
        value["origins"] = target
    else:
        expected = "http://127.0.0.1:18080/oss"
        target = "http://127.0.0.1:18880/oss"
        if value["assets"]["cdnEndpoint"] == target:
            continue
        if value["assets"]["cdnEndpoint"] != expected:
            raise SystemExit("Unexpected asset origin; refusing automatic migration")
        value["assets"]["cdnEndpoint"] = target
        if name == "server.yaml":
            if value["channel"]["shortLink"]["baseUrl"] != "http://127.0.0.1:18080/api/shortLink/":
                raise SystemExit("Unexpected short-link origin; refusing automatic migration")
            value["channel"]["shortLink"]["baseUrl"] = "http://127.0.0.1:18880/api/shortLink/"
    changes.append((path, value))

backup = root / ".runtime/private-port-backup"
backup.mkdir(mode=0o700, parents=True, exist_ok=True)
for path, value in changes:
    old = backup / path.name
    if not old.exists():
        shutil.copy2(path, old)
        old.chmod(0o600)
    pending = path.with_name(path.name + ".port-pending")
    descriptor = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output, indent=2)
        output.write("\n")
    pending.replace(path)
print(f"Updated {len(changes)} private origin files; credentials preserved and previous files backed up.")
