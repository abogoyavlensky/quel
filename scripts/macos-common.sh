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
