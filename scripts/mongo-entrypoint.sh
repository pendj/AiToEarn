#!/bin/sh
set -eu
if [ ! -f /data/configdb/replica.key ]; then
  install -o mongodb -g mongodb -m 400 /run/private/replica.key /data/configdb/replica.key
fi
exec /usr/local/bin/docker-entrypoint.sh mongod --bind_ip_all --replSet rs0 --keyFile /data/configdb/replica.key --wiredTigerCacheSizeGB 0.3
