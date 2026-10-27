# shellcheck shell=bash disable=SC2034
# Shared by the macOS packaging scripts: the app's identity, its minimum
# macOS and the release version. Sourced, not run.

MACOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Quel"
BUNDLE_ID="io.github.abogoyavlensky.quel"
EXECUTABLE="quel"
# One value for the compiler and linker flags, Info.plist and the cask.
MACOS_MIN="15.0"
DIST="$MACOS_ROOT/dist"
APP="$DIST/$APP_NAME.app"
CHECKSUMS="$DIST/checksums.txt"

die() { echo "${0##*/}: $1" >&2; exit 1; }

# Only a stable MAJOR.MINOR.PATCH is a release version.
valid_version() {
    [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
}

# The release version: VERSION with surrounding whitespace trimmed.
read_version() {
    local v
    [[ -f "$MACOS_ROOT/VERSION" ]] || die "VERSION is missing"
    v="$(tr -d '[:space:]' <"$MACOS_ROOT/VERSION")"
    valid_version "$v" || die "VERSION must be MAJOR.MINOR.PATCH, got '$v'"
    echo "$v"
}

require_apple_silicon() {
    [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] ||
        die "needs an Apple Silicon Mac (this is $(uname -s) $(uname -m))"
}

# The release archive's file name for a version.
archive_name() { echo "quel_$1_darwin_arm64.zip"; }

# xcrun stapler ACTION APP (staple or validate), up to STAPLER_ATTEMPTS
# times (default 3), STAPLER_RETRY_DELAY seconds apart (default 15).
# stapler talks to Apple's servers, and a CI runner's request sometimes
# fails although the ticket is fine. stapler reports why on stdout, so each
# failed attempt prints the end of its output.
stapler_retry() {
    local action="$1" target="$2" attempts="${STAPLER_ATTEMPTS:-3}" n out
    for ((n = 1; ; n++)); do
        if out="$(xcrun stapler "$action" -v "$target" 2>&1)"; then
            return 0
        fi
        echo "  stapler $action failed (attempt $n of $attempts):" >&2
        printf '%s\n' "$out" | tail -n 20 | sed 's/^/    /' >&2
        ((n < attempts)) || return 1
        sleep "${STAPLER_RETRY_DELAY:-15}"
    done
}
