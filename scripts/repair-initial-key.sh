#!/bin/sh
set -eu
if LC_ALL=C grep -q '[^A-Za-z0-9+/=]' /run/private/replica.key; then
  printf '%s\n' 'Replacement is not valid base64' >&2
  exit 1
fi
if ! LC_ALL=C grep -q '[^A-Za-z0-9+/=]' /data/configdb/replica.key; then
  printf '%s\n' 'Refusing to replace an already valid database key' >&2
  exit 1
fi
install -o mongodb -g mongodb -m 400 /run/private/replica.key /data/configdb/replica.key
printf '%s\n' 'Installed valid key into the stopped initial database volume; no data removed.'
