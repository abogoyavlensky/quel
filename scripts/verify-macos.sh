#!/usr/bin/env bash
# Check Quel's macOS app: bundle metadata, architecture, deployment target,
# linkage and build tags, then launch it with isolated data from a path with
# spaces. The launch check is liveness only: the process stays up and
# creates its app database. It does not see the window, the frontend or the
# bridge; that is a manual pass.
#
#   lgx verify-macos                 dist/Quel.app, as an ad-hoc signed copy
#   lgx verify-macos --distribution  the release archive from sign-macos:
#                                    its checksum, Developer ID signature,
#                                    notarization ticket and Gatekeeper
set -euo pipefail
source "$(dirname "$0")/macos-common.sh"

mode=development
case "${1:-}" in
"") ;;
--distribution) mode=distribution ;;
*) die "unknown argument '$1' (expected nothing or --distribution)" ;;
esac

require_apple_silicon
version="$(read_version)"

ok() { echo "  ok: $1"; }

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
place="$work/Quel check"
mkdir -p "$place"
app="$place/$APP_NAME.app"

if [[ "$mode" == development ]]; then
    [[ -d "$APP" ]] || die "$APP is missing: run lgx package-macos"
    ditto "$APP" "$app"
else
    archive="$(archive_name "$version")"
    [[ -f "$DIST/$archive" ]] || die "$DIST/$archive is missing: run lgx sign-macos"
    [[ -f "$CHECKSUMS" ]] || die "$CHECKSUMS is missing: run lgx sign-macos"
    echo "==> Archive"
    (cd "$DIST" && shasum -a 256 -c checksums.txt >/dev/null) || die "$archive does not match checksums.txt"
    ok "$archive matches checksums.txt"
    ditto -x -k "$DIST/$archive" "$place"
    [[ -d "$app" ]] || die "$archive does not unpack to $APP_NAME.app"
    ok "unpacks to $APP_NAME.app"
fi
bin="$app/Contents/MacOS/$EXECUTABLE"
plist="$app/Contents/Info.plist"

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
[[ -s "$app/Contents/Resources/quel.icns" ]] || die "Resources/quel.icns is missing"
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

echo "==> Signature"
if [[ "$mode" == development ]]; then
    # Ad-hoc: a development check, not distribution signing.
    codesign --force --options runtime --sign - "$app" 2>/dev/null
    codesign --verify --deep --strict "$app" || die "the ad-hoc signed copy does not verify"
    ok "ad-hoc signature verifies (development only)"
else
    codesign --verify --deep --strict --verbose=2 "$app" 2>/dev/null || die "the signature does not verify"
    details="$(codesign -dvv "$app" 2>&1)"
    [[ "$details" == *"Authority=Developer ID Application: "* ]] || die "not signed with a Developer ID Application identity"
    [[ "$details" == *"Authority=Developer ID Certification Authority"* ]] || die "the signature does not chain to Developer ID"
    [[ "$details" == *"Timestamp="* ]] || die "the signature has no secure timestamp"
    [[ "$details" == *"flags="*"(runtime)"* ]] || die "hardened runtime is off"
    ok "Developer ID signature with hardened runtime and a secure timestamp"
    stapler_retry validate "$app" || die "the notarization ticket is not stapled or does not validate"
    ok "notarization ticket stapled"
    assessment="$(spctl --assess --type execute -vv "$app" 2>&1)" ||
        { echo "$assessment" >&2; die "Gatekeeper rejects the app"; }
    [[ "$assessment" == *"source=Notarized Developer ID"* ]] ||
        { echo "$assessment" >&2; die "Gatekeeper does not see a notarized Developer ID app"; }
    ok "Gatekeeper: accepted, Notarized Developer ID"
fi

echo "==> Launch with isolated data"
data="$work/data"
log="$work/quel.log"
# No dev variables and nothing from the dev toolchain on PATH.
(cd "$work" && exec env -i HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    QUEL_SECRETS=memory QUEL_DATA_DIR="$data" \
    "$bin") >"$log" 2>&1 &
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

echo "All $mode checks passed for $APP_NAME $version."
