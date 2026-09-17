#!/usr/bin/env python3
"""Resolve public ARM64 image metadata; never pull layers or print credentials."""

import json
import sys
import urllib.request

IMAGES = {
    "WEB_IMAGE": ("aitoearn/aitoearn-web", "20260626-8bbf520"),
    "SERVER_IMAGE": ("aitoearn/aitoearn-server", "20260626-8bbf520c"),
    "AI_IMAGE": ("aitoearn/aitoearn-ai", "20260623-e3abc458"),
    "MONGO_IMAGE": ("library/mongo", "8.0"),
    "REDIS_IMAGE": ("library/redis", "7.4-alpine"),
    "STORAGE_IMAGE": ("rustfs/rustfs", "latest"),
    "NODE_IMAGE": ("library/node", "22-alpine"),
}

for variable, (repository, tag) in IMAGES.items():
    if sys.argv[1:] and variable not in sys.argv[1:]:
        continue
    url = f"https://hub.docker.com/v2/repositories/{repository}/tags/{tag}"
    with urllib.request.urlopen(url, timeout=20) as response:
        metadata = json.load(response)
    variants = [
        item for item in metadata["images"]
        if item.get("architecture") == "arm64" and item.get("os") == "linux"
    ]
    if len(variants) != 1:
        raise SystemExit(f"Expected exactly one Linux ARM64 manifest: {repository}:{tag}")
    image = variants[0]
    print(json.dumps({
        "variable": variable, "repository": repository, "tag": tag,
        "digest": image["digest"], "compressed_bytes": image["size"],
        "updated_at": metadata["last_updated"],
    }), flush=True)
