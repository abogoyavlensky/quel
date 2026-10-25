#!/usr/bin/env bash
# Check dist/Quel.app: bundle metadata, architecture, deployment target,
# linkage and build tags; then ad-hoc sign a copy under a path with spaces
# and launch it with isolated data. The launch check is liveness only: the
# process stays up and creates its app database. It does not see the window,
# the frontend or the bridge; that is a manual pass.
#
#   lgx verify-macos     (after lgx package-macos)
set -euo pipefail
source "$(dirname "$0")/macos-common.sh"

require_apple_silicon
version="$(read_version)"
[[ -d "$APP" ]] || die "$APP is missing: run lgx package-macos"
bin="$APP/Contents/MacOS/$EXECUTABLE"
plist="$APP/Contents/Info.plist"

ok() { echo "  ok: $1"; }

echo "==> Bundle"
plutil -lint -s "$plist" || die "Info.plist does not lint"
key() { /usr/libexec/PlistBuddy -c "Print :$1" "$plist" 2>/dev/null || true; }
expect_key() {
    local got
    got="$(key "$1")"
    [[ "$got" == "$2" ]] || die "Info.plist $1 is '$got', expected '$2'"
}
expect_key CFBundleIdentifier "$BUNDLE_ID"
expect_key CFBundleExecutable "$EXECUTABLE"
expect_key CFBundleShortVersionString "$version"
expect_key CFBundleVersion "$version"
expect_key LSMinimumSystemVersion "$MACOS_MIN"
expect_key CFBundleIconFile quel
[[ -s "$APP/Contents/Resources/quel.icns" ]] || die "Resources/quel.icns is missing"
ok "Info.plist: $BUNDLE_ID $version, macOS $MACOS_MIN, icon"

echo "==> Binary"
[[ -x "$bin" ]] || die "$bin is missing or not executable"
archs="$(lipo -archs "$bin")"
[[ "$archs" == "arm64" ]] || die "architectures are '$archs', expected exactly arm64"
ok "arm64 only"

minos="$(otool -l "$bin" | awk '/LC_BUILD_VERSION/ {f=1} f && $1 == "minos" {print $2; exit}')"
[[ "$minos" == "$MACOS_MIN" ]] || die "the binary's minos is '$minos', expected $MACOS_MIN"
ok "minos $minos"

# Only the OS's own libraries: nothing from Homebrew, /usr/local, Xcode or
# an @rpath that exists on the build machine only.
bad="$(otool -L "$bin" | tail -n +2 | awk '{print $1}' |
    grep -Ev '^(/usr/lib/|/System/Library/)' || true)"
[[ -z "$bad" ]] || die "links libraries outside the OS: $bad"
ok "links only /usr/lib and /System/Library"

if command -v go >/dev/null 2>&1; then
    tags="$(go version -m "$bin" | awk '$1 == "build" && $2 ~ /^-tags=/ {sub(/^-tags=/, "", $2); print $2}')"
    [[ ",$tags," == *,production,* ]] || die "build tags are '$tags', expected production"
    [[ ",$tags," != *,server,* ]] || die "build tags include server: '$tags'"
    ok "build tags: $tags"
else
    echo "  skip: build tags (go is not on PATH)"
fi

echo "==> Ad-hoc signed copy, launched with isolated data"
work="$(mktemp -d)"
pid=""
cleanup() {
    if [[ -n "$pid" ]]; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
    fi
    rm -rf "$work"
}
trap cleanup EXIT
copy="$work/Quel check/$APP_NAME.app"
mkdir -p "$(dirname "$copy")"
ditto "$APP" "$copy"
# Ad-hoc: a development check, not distribution signing.
codesign --force --options runtime --sign - "$copy"
codesign --verify --deep --strict "$copy" || die "the ad-hoc signed copy does not verify"
ok "ad-hoc signature verifies (development only)"

data="$work/data"
log="$work/quel.log"
# No dev variables and nothing from the dev toolchain on PATH.
(cd "$work" && exec env -i HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    QUEL_SECRETS=memory QUEL_DATA_DIR="$data" \
    "$copy/Contents/MacOS/$EXECUTABLE") >"$log" 2>&1 &
pid=$!
for _ in $(seq 1 30); do
    [[ -s "$data/quel.db" ]] && break
    kill -0 "$pid" 2>/dev/null || { cat "$log" >&2; die "the app exited during startup"; }
    sleep 1
done
[[ -s "$data/quel.db" ]] || { cat "$log" >&2; die "the app never created its database"; }
sleep 3
kill -0 "$pid" 2>/dev/null || { cat "$log" >&2; die "the app exited after startup"; }
ok "launch (liveness only): running, app database created in an isolated dir"

echo "All checks passed for $APP_NAME $version."
