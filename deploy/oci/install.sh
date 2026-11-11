#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' 'The old host/systemd installer is retired. No host changes were made.' >&2
printf '%s\n' 'Use deploy/oci/README.md: build images locally, audit the remote host, then explicitly deploy the Docker overlay with retained state.' >&2
exit 2
