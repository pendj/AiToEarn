#!/bin/sh
set -eu
install -o redis -g redis -m 400 /run/private/redis.conf /tmp/redis.conf
exec /usr/local/bin/docker-entrypoint.sh redis-server /tmp/redis.conf
