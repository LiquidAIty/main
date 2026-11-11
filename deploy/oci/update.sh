#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' 'The old Git-pull/systemd updater is retired. No checkout, service or data changes were made.' >&2
printf '%s\n' 'Use reviewed immutable image tags/digests and the existing Docker overlay. Follow deploy/oci/README.md before an explicitly authorized update.' >&2
exit 2
