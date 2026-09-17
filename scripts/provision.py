#!/usr/bin/env python3
"""Create project-local private configuration without disclosing secret values."""

import argparse
import base64
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import shutil


def private_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write(content)


def create_config(root, check_resources=True):
    root = root.resolve()
    if check_resources and shutil.disk_usage(root).free < 12 * 1024**3:
        raise SystemExit("At least 12 GiB free disk is required before provisioning")
    private = root / ".private"
    private.mkdir(mode=0o700, exist_ok=True)
    private.chmod(0o700)
    master_path = private / "secrets.json"
    if master_path.exists():
        existing = json.loads(master_path.read_text())
        if not existing.get("complete"):
            raise SystemExit("Incomplete provisioning: preserve files and inspect before recovery")
        print("Existing private configuration preserved; no secrets rotated.")
        return
    if any(private.iterdir()):
        raise SystemExit("Private directory is not empty; refusing to overwrite existing state")

    password = secrets.token_urlsafe(24)
    salt = secrets.token_bytes(16)
    values = {
        "mongoRootPassword": secrets.token_hex(32),
        "mongoAppPassword": secrets.token_hex(32),
        "redisPassword": secrets.token_hex(32),
        "storageAccessKey": secrets.token_hex(12),
        "storageSecretKey": secrets.token_hex(32),
        "jwtSecret": secrets.token_hex(48),
        "internalToken": secrets.token_hex(48),
        "sessionKey": secrets.token_hex(32),
        "operatorId": secrets.token_hex(12),
        "sessionEpoch": secrets.token_hex(16),
    }
    origins = ["http://127.0.0.1:18080", "http://localhost:18080"]
    mongo_uri = f"mongodb://aitoearn:{values['mongoAppPassword']}@mongodb:27017/?authSource=admin&replicaSet=rs0"
    redis = {"host": "redis", "port": 6379, "username": "default", "password": values["redisPassword"]}
    assets = {
        "region": "us-east-1", "accessKeyId": values["storageAccessKey"],
        "secretAccessKey": values["storageSecretKey"], "bucketName": "luxsabers-social",
        "endpoint": "http://storage:9000", "cdnEndpoint": origins[0] + "/oss",
        "publicEndpoint": "http://127.0.0.1:19000", "signExpires": 300,
        "forcePathStyle": True, "provider": "s3", "maxSize": 50 * 1024**2,
    }
    common = {
        "enableConfigLogging": False, "enableBadRequestDetails": False,
        "logger": {"console": {"enable": True, "level": "warn", "pretty": False}},
        "appDomain": "127.0.0.1", "auth": {"secret": values["jwtSecret"], "internalToken": values["internalToken"]},
        "redis": redis, "mongodb": {"uri": mongo_uri, "dbName": "aitoearn"},
        "redlock": {"redis": redis, "ttl": 300, "retryDelay": 1000, "retryCount": 3},
        "assets": assets,
    }
    server = {
        **common, "port": 3002, "environment": "production", "apiKey": {"prefix": "ai_"},
        "aiClient": {"baseUrl": "http://ai:3010", "token": values["internalToken"]},
        "channel": {"channelDb": {"uri": mongo_uri, "dbName": "aitoearn_channel"},
                    "shortLink": {"baseUrl": origins[0] + "/api/shortLink/"}},
    }
    disabled_provider = {"apiKey": "", "baseUrl": "http://127.0.0.1:9"}
    ai = {
        **common, "port": 3010, "serverClient": {"baseUrl": "http://server:3002"},
        "ai": {
            "models": {"chat": [], "image": {"generation": [], "edit": []}, "video": {"generation": []}},
            "openai": {**disabled_provider, "timeout": 10000}, "gemini": disabled_provider,
            "grok": disabled_provider, "dashscope": disabled_provider, "anthropic": disabled_provider,
            "volcengine": {**disabled_provider, "accessKeyId": "", "secretAccessKey": "", "spaceName": "", "playbackBaseUrl": "", "urlAuthPrimaryKey": ""},
            "draftGeneration": {"planner": {"defaultModel": "disabled"}, "queue": {"lowPriorityMinPriority": 1000, "lowPriorityConcurrency": 1}, "imageModels": []},
        },
        "agent": {**disabled_provider, "models": ["disabled"], "defaultModel": "disabled", "backgroundModel": "disabled", "thinkModel": "disabled", "taskTimeoutMs": 60000},
    }
    gateway = {
        "origins": origins, "secureCookie": False,
        "username": "luxsabers", "operatorId": values["operatorId"],
        "passwordSalt": salt.hex(), "passwordHash": hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64).hex(),
        "jwtSecret": values["jwtSecret"], "sessionKey": values["sessionKey"], "sessionEpoch": values["sessionEpoch"],
        "webOrigin": "http://web:3000", "serverOrigin": "http://server:3002", "aiOrigin": "http://ai:3010",
        "storage": {"endpoint": "http://storage:9000", "accessKey": values["storageAccessKey"], "secretKey": values["storageSecretKey"], "bucket": "luxsabers-social"},
    }
    mongo_init = {key: values[key] for key in ["mongoRootPassword", "mongoAppPassword", "operatorId"]}
    for name, config in [("server.yaml", server), ("ai.yaml", ai), ("gateway.json", gateway), ("mongodb.json", mongo_init)]:
        private_write(private / name, json.dumps(config, indent=2) + "\n")
    private_write(private / "mongo-root-password", values["mongoRootPassword"])
    private_write(private / "replica.key", base64.b64encode(secrets.token_bytes(512)).decode("ascii"))
    private_write(private / "operator-password.txt", password + "\n")
    private_write(private / "redis.conf", "bind 0.0.0.0\nprotected-mode yes\nappendonly yes\nappendfsync everysec\nmaxmemory 128mb\nmaxmemory-policy noeviction\nrequirepass " + values["redisPassword"] + "\n")
    private_write(private / "redis.env", "REDISCLI_AUTH=" + values["redisPassword"] + "\n")
    private_write(private / "storage.env", "RUSTFS_ACCESS_KEY=" + values["storageAccessKey"] + "\nRUSTFS_SECRET_KEY=" + values["storageSecretKey"] + "\nRUSTFS_CONSOLE_ENABLE=false\n")
    values["complete"] = True
    private_write(master_path, json.dumps(values, indent=2) + "\n")
    print("Created private configuration; no credentials printed; model calls and publishing disabled.")


def repair_initial_key(root):
    path = root.resolve() / ".private/replica.key"
    existing = path.read_text()
    if re.fullmatch(r"[A-Za-z0-9+/=]{6,1024}", existing):
        print("Replica key already has valid base64 format; no rotation performed")
        return
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,1024}", existing):
        raise SystemExit("Unexpected key format; refusing automatic repair")
    replacement = path.with_name("replica.key.replacement")
    private_write(replacement, base64.b64encode(secrets.token_bytes(512)).decode("ascii"))
    replacement.replace(path)
    print("Replaced invalid initial replica key; value not printed. Install into the stopped initial MongoDB volume with the guarded repair script.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--repair-initial-key", action="store_true")
    args = parser.parse_args()
    if args.repair_initial_key:
        repair_initial_key(args.root)
    else:
        create_config(args.root)
