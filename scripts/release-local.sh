#!/usr/bin/env bash
# Cut installers for all three platforms from this Mac.
#
# The vendored scripts/ pair comes from stoatworks-backend/release/ and must be
# re-vendored FROM there, never merged with another repo's copy — two variants
# of release-lib.sh exist in the fleet and "syncing" the odd one out deletes
# functions that are in use.
#
#   ./scripts/release-local.sh                 patch bump, build only
#   ./scripts/release-local.sh --version 0.2.0 --upload
set -euo pipefail
RE_NAME="atem-scopes"
RE_SLUG="atem-scopes"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-electron.sh"
