#!/usr/bin/env python3
"""Inspect only this Compose project, redacting locally configured secrets."""

import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SERVICES = {"mongodb", "mongo-init", "redis", "storage", "storage-init", "ai", "server", "web", "gateway"}
parser = argparse.ArgumentParser()
parser.add_argument("--logs", choices=sorted(SERVICES))
args = parser.parse_args()
hidden = set()


def collect(value, key=""):
    if isinstance(value, dict):
        for name, item in value.items():
            collect(item, name)
    elif isinstance(value, str) and len(value) >= 8 and re.search(r"secret|password|token|salt|hash|key|operatorId|sessionEpoch|uri", key, re.I):
        hidden.add(value)


for name in ["secrets.json", "gateway.json", "server.yaml", "ai.yaml"]:
    path = ROOT / ".private" / name
    if path.exists():
        collect(json.loads(path.read_text()))
for name in ["operator-password.txt", "replica.key", "mongo-root-password"]:
    secret_file = ROOT / ".private" / name
    if secret_file.exists():
        hidden.add(secret_file.read_text().strip())
command = ["docker", "compose", "logs", "--no-color", "--tail", "80", args.logs] if args.logs else ["docker", "compose", "ps", "-a"]
result = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
output = result.stdout
output = re.sub(r'(invalid char in key file [^:]+:)[^"\n]+', r'\1 [REDACTED]', output)
for value in sorted(hidden, key=len, reverse=True):
    output = output.replace(value, "[REDACTED]")
output = re.sub(r"Bearer\s+[A-Za-z0-9_.~-]+", "Bearer [REDACTED]", output)
output = re.sub(r"(https?://[^\s?]+)\?[^\s]+", r"\1?[REDACTED]", output)
print(output, end="")
raise SystemExit(result.returncode)
