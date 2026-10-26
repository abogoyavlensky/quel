#!/usr/bin/env bash
# CI's wrapper around sign-macos.sh: put the Developer ID certificate and
# the notary credentials into a temporary keychain, sign and notarize, then
# delete the keychain and restore the keychain search list, whether signing
# passed or not.
#
# Takes its inputs from the environment (GitHub secrets):
#   APPLE_CERTIFICATE_P12_BASE64  the .p12 export, base64-encoded
#   APPLE_CERTIFICATE_PASSWORD    the .p12 password
#   APPLE_SIGNING_IDENTITY        "Developer ID Application: Name (TEAMID)"
#   APPLE_TEAM_ID, APPLE_ID       the notarization account
#   APPLE_APP_SPECIFIC_PASSWORD   its app-specific password
# No value is printed; a missing one is named and nothing is created.
set -euo pipefail
source "$(dirname "$0")/macos-common.sh"

missing=""
for name in APPLE_CERTIFICATE_P12_BASE64 APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY \
    APPLE_TEAM_ID APPLE_ID APPLE_APP_SPECIFIC_PASSWORD; do
    [[ -n "${!name:-}" ]] || missing="$missing $name"
done
[[ -z "$missing" ]] || die "missing secrets:$missing"
require_apple_silicon

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/quel-signing.XXXXXX")"
keychain="$work/signing.keychain-db"
profile="quel-ci"
# The search list as it was, to restore on exit. ${original[@]+...}: bash
# 3.2 (macOS) treats an empty array as unset under set -u.
original=()
while IFS= read -r k; do
    [[ -n "$k" ]] && original+=("$k")
done < <(security list-keychains -d user | sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//')
created=""
cleanup() {
    if [[ -n "$created" ]]; then
        security list-keychains -d user -s ${original[@]+"${original[@]}"} ||
            echo "could not restore the keychain search list" >&2
        security delete-keychain "$keychain" || echo "could not delete $keychain" >&2
    fi
    rm -rf "$work"
}
trap cleanup EXIT

echo "==> Temporary keychain"
keychain_password="$(openssl rand -hex 32)"
security create-keychain -p "$keychain_password" "$keychain"
created=1
# Locks after 6 hours instead of the default 5 minutes of inactivity.
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
printf '%s' "$APPLE_CERTIFICATE_P12_BASE64" | base64 --decode >"$work/certificate.p12" ||
    die "APPLE_CERTIFICATE_P12_BASE64 is not valid base64"
# The .p12 and app-specific passwords go in as arguments: neither tool takes
# them any other way without a prompt. Other processes could read them, which
# is acceptable on GitHub's single-use hosted runners; logs mask secrets.
security import "$work/certificate.p12" -k "$keychain" -f pkcs12 \
    -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null ||
    die "could not import the certificate: check APPLE_CERTIFICATE_P12_BASE64 and APPLE_CERTIFICATE_PASSWORD"
rm -f "$work/certificate.p12"
# Lets codesign use the key without a confirmation dialog.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
# codesign finds the certificate chain through the search list.
security list-keychains -d user -s "$keychain" ${original[@]+"${original[@]}"}
echo "  certificate imported"

xcrun notarytool store-credentials "$profile" --keychain "$keychain" \
    --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" >/dev/null ||
    die "could not store the notary credentials: check APPLE_ID, APPLE_TEAM_ID and APPLE_APP_SPECIFIC_PASSWORD"
echo "  notary profile stored"

APPLE_KEYCHAIN="$keychain" APPLE_NOTARY_PROFILE="$profile" bash "$(dirname "$0")/sign-macos.sh"
