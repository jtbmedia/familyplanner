#!/bin/sh
# Entrypoint: /data-Permissions zur Laufzeit korrigieren, dann als node-User starten.
# Notwendig, weil Docker beim Mounten eines named Volume die Image-Permissions überschreibt.
set -e
chown -R node:node /data
exec gosu node "$@"
