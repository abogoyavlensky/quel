#!/usr/bin/env bash
# Print the release version from VERSION. With a tag, also require the tag
# to be exactly v plus that version, so a release never publishes an app
# that reports another version.
#
#   bash scripts/release-version.sh          # 0.1.0
#   bash scripts/release-version.sh v0.1.0   # 0.1.0, or fails on a mismatch
set -euo pipefail
source "$(dirname "$0")/macos-common.sh"

[[ $# -le 1 ]] || die "usage: release-version.sh [TAG]"
version="$(read_version)"
if [[ $# -eq 1 && "$1" != "v$version" ]]; then
    die "tag '$1' does not match VERSION $version (expected v$version)"
fi
echo "$version"
