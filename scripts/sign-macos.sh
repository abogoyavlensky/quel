#!/usr/bin/env bash
# Sign dist/Quel.app with Developer ID, notarize and staple it, then write
# the release archive and checksums.txt to dist/. The unsigned dist/Quel.app
# is left as it is: a fresh copy is signed each run. Nothing is written to
# dist/ unless every step passes, and an earlier archive is removed first.
#
#   APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" \
#   APPLE_NOTARY_PROFILE=quel-notary lgx sign-macos
#
# APPLE_NOTARY_PROFILE names credentials saved with `xcrun notarytool
# store-credentials`. APPLE_KEYCHAIN, when set, is the keychain holding the
# identity and the profile (CI's temporary one); otherwise the default
# keychains are searched. No secret passes through this script.
set -euo pipefail
source "$(dirname "$0")/macos-common.sh"

require_apple_silicon
version="$(read_version)"
archive="$(archive_name "$version")"
rm -f "$DIST/$archive" "$CHECKSUMS"

identity="${APPLE_SIGNING_IDENTITY:-}"
profile="${APPLE_NOTARY_PROFILE:-}"
[[ -n "$identity" ]] || die "set APPLE_SIGNING_IDENTITY to your Developer ID Application identity (security find-identity -v -p codesigning)"
[[ "$identity" == "Developer ID Application: "* ]] ||
    die "APPLE_SIGNING_IDENTITY must be a Developer ID Application identity, got '$identity'"
[[ -n "$profile" ]] || die "set APPLE_NOTARY_PROFILE to a profile saved with xcrun notarytool store-credentials"
[[ -d "$APP" ]] || die "$APP is missing: run lgx package-macos"

# ${keychain[@]+...} below: bash 3.2 (macOS) treats an empty array as unset under set -u.
keychain=()
if [[ -n "${APPLE_KEYCHAIN:-}" ]]; then keychain=(--keychain "$APPLE_KEYCHAIN"); fi

echo "==> Preflight"
identities="$(security find-identity -v -p codesigning ${APPLE_KEYCHAIN:+"$APPLE_KEYCHAIN"} || true)"
[[ "$identities" == *"\"$identity\""* ]] || die "no signing identity '$identity' in the keychain"
xcrun notarytool history --keychain-profile "$profile" ${keychain[@]+"${keychain[@]}"} >/dev/null 2>&1 ||
    die "notary profile '$profile' is missing or its credentials are rejected"
echo "  identity and notary profile found"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
app="$work/$APP_NAME.app"
ditto "$APP" "$app"

echo "==> Signing"
sign() {
    codesign --force --options runtime --timestamp --sign "$identity" \
        ${keychain[@]+"${keychain[@]}"} "$1"
}
# Nested Mach-O files first, deepest first; then the bundle, which signs its
# main executable. Today the bundle has none, but a helper added later must
# not ship unsigned.
find "$app/Contents" -type f ! -path "$app/Contents/MacOS/$EXECUTABLE" |
    awk -F/ '{print NF "\t" $0}' | sort -rn | cut -f2- |
    while IFS= read -r f; do
        if file -b "$f" | grep -q '^Mach-O'; then
            echo "  nested: ${f#"$app/"}"
            sign "$f"
        fi
    done
sign "$app"
codesign --verify --deep --strict "$app" || die "the signed app does not verify"

echo "==> Notarizing (this waits for Apple, usually a few minutes)"
submission="$work/submission.zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$submission"
out="$(xcrun notarytool submit "$submission" --keychain-profile "$profile" \
    ${keychain[@]+"${keychain[@]}"} --wait --output-format json 2>"$work/submit.err" || true)"
field() { printf '%s' "$out" | sed -n "s/.*\"$1\" *: *\"\\([^\"]*\\)\".*/\\1/p" | head -1; }
id="$(field id)"
status="$(field status)"
echo "  submission ${id:-?}: ${status:-no status}"
if [[ "$status" != "Accepted" ]]; then
    cat "$work/submit.err" >&2
    if [[ -n "$id" ]]; then
        echo "--- notarization log" >&2
        xcrun notarytool log "$id" --keychain-profile "$profile" \
            ${keychain[@]+"${keychain[@]}"} >&2 || true
    fi
    die "notarization was not accepted (${status:-no status}); nothing was written to dist/"
fi

echo "==> Stapling"
stapler_retry staple "$app" || die "could not staple the notarization ticket; nothing was written to dist/"
stapler_retry validate "$app" || die "the stapled ticket does not validate; nothing was written to dist/"
echo "  ticket stapled"
assessment="$(spctl --assess --type execute -vv "$app" 2>&1)" ||
    { echo "$assessment" >&2; die "Gatekeeper rejects the notarized app"; }
[[ "$assessment" == *"source=Notarized Developer ID"* ]] ||
    { echo "$assessment" >&2; die "Gatekeeper does not see a notarized Developer ID app"; }

echo "==> Archive"
ditto -c -k --sequesterRsrc --keepParent "$app" "$work/$archive"
# The in-app updater takes a zip with one top-level entry; --sequesterRsrc
# would add __MACOSX/ beside Quel.app if the bundle had extended attributes.
top="$(unzip -Z1 "$work/$archive" | cut -d/ -f1 | sort -u)"
[[ "$top" == "$APP_NAME.app" ]] ||
    die "the release zip must hold only $APP_NAME.app at its top level, found: $(echo $top)"
(cd "$work" && shasum -a 256 "$archive" >checksums.txt)
mv "$work/$archive" "$DIST/$archive"
mv "$work/checksums.txt" "$CHECKSUMS"
cat "$CHECKSUMS"
echo "Signed and notarized $DIST/$archive. Check it with lgx verify-macos --distribution."
