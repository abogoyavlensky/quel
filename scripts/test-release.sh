#!/usr/bin/env bash
# Tests for the release scripts, with stand-ins for Apple's tools: no
# certificate, keychain or Apple account is touched, and no real submission
# is made, so it runs on Linux too.
#
#   bash scripts/test-release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fails=0
pass() { echo "  ok: $1"; }
fail() { echo "  FAIL: $1" >&2; fails=$((fails + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

# --- stand-ins -------------------------------------------------------------
stubs="$(mktemp -d)"
trap 'rm -rf "$stubs" "${proj:-}"' EXIT
stub() { printf '#!/usr/bin/env bash\n%s\n' "$2" >"$stubs/$1"; chmod +x "$stubs/$1"; }
# Every call is appended to $STUB_LOG.
stub uname 'case "$1" in -s) echo Darwin ;; -m) echo arm64 ;; *) /usr/bin/uname "$@" ;; esac'
stub security 'echo "security $*" >>"$STUB_LOG"
if [[ -n "${STUB_IDENTITY:-}" ]]; then echo "  1) ABCDEF \"$STUB_IDENTITY\""; echo "     1 valid identities found"
else echo "     0 valid identities found"; fi'
stub codesign 'echo "codesign $*" >>"$STUB_LOG"'
stub spctl 'echo "spctl $*" >>"$STUB_LOG"; echo "accepted" >&2; echo "source=Notarized Developer ID" >&2'
stub ditto 'echo "ditto $*" >>"$STUB_LOG"
if [[ "$1" == -c ]]; then src="${@: -2:1}"; out="${@: -1}"; (cd "$(dirname "$src")" && zip -qr "$out" "$(basename "$src")")
else cp -R "$1" "$2"; fi'
stub xcrun 'echo "xcrun $*" >>"$STUB_LOG"
case "$1 $2" in
"notarytool history") [[ "${STUB_PROFILE:-ok}" == ok ]] ;;
"notarytool submit") echo "{\"id\":\"sub-1\",\"status\":\"${STUB_NOTARY:-Accepted}\",\"message\":\"done\"}" ;;
"notarytool log") echo "{\"issues\":[{\"message\":\"stub rejection\"}]}" ;;
"stapler staple"|"stapler validate") ;;
*) echo "unexpected xcrun $*" >&2; exit 1 ;;
esac'

# --- a throwaway project with an unsigned bundle ---------------------------
new_project() {
    proj="$(mktemp -d)"
    mkdir -p "$proj/scripts" "$proj/dist/Quel.app/Contents/MacOS"
    cp "$ROOT"/scripts/macos-common.sh "$ROOT"/scripts/sign-macos.sh "$proj/scripts/"
    printf '0.1.0\n' >"$proj/VERSION"
    printf 'not really mach-o\n' >"$proj/dist/Quel.app/Contents/MacOS/quel"
    STUB_LOG="$proj/calls.log"
    : >"$STUB_LOG"
}
archive=quel_0.1.0_darwin_arm64.zip
id="Developer ID Application: Test Person (TEAM123456)"
# sign [VAR=value...]: run sign-macos.sh with the stand-ins; output in $out, status in $rc.
sign() {
    set +e
    out="$(cd "$proj" && env PATH="$stubs:$PATH" STUB_LOG="$STUB_LOG" "$@" bash scripts/sign-macos.sh 2>&1)"
    rc=$?
    set -e
}
no_artifact() { [[ ! -e "$proj/dist/$archive" && ! -e "$proj/dist/checksums.txt" ]]; }

echo "==> sign-macos.sh"

new_project
sign APPLE_NOTARY_PROFILE=p
check "no identity: fails" '[[ $rc -ne 0 && "$out" == *"set APPLE_SIGNING_IDENTITY"* ]]'
check "no identity: nothing written" no_artifact

new_project
sign APPLE_SIGNING_IDENTITY="Apple Development: Test Person (TEAM123456)" APPLE_NOTARY_PROFILE=p
check "an Apple Development identity is refused" '[[ $rc -ne 0 && "$out" == *"must be a Developer ID Application identity"* ]]'

new_project
sign APPLE_SIGNING_IDENTITY="$id"
check "no notary profile: fails" '[[ $rc -ne 0 && "$out" == *"set APPLE_NOTARY_PROFILE"* ]]'

new_project
sign APPLE_SIGNING_IDENTITY="$id" APPLE_NOTARY_PROFILE=p
check "identity not in the keychain: fails" '[[ $rc -ne 0 && "$out" == *"no signing identity"* ]]'
check "identity not in the keychain: nothing signed" '! grep -q "^codesign" "$STUB_LOG"'

new_project
sign APPLE_SIGNING_IDENTITY="$id" APPLE_NOTARY_PROFILE=p STUB_IDENTITY="$id" STUB_PROFILE=bad
check "rejected notary profile: fails before signing" '[[ $rc -ne 0 && "$out" == *"notary profile"* ]] && ! grep -q "^codesign" "$STUB_LOG"'

new_project
printf 'stale\n' >"$proj/dist/$archive"
printf 'stale\n' >"$proj/dist/checksums.txt"
sign APPLE_SIGNING_IDENTITY="$id" APPLE_NOTARY_PROFILE=p STUB_IDENTITY="$id" STUB_NOTARY=Invalid
check "rejected notarization: fails" '[[ $rc -ne 0 && "$out" == *"notarization was not accepted (Invalid)"* ]]'
check "rejected notarization: prints Apple's log" '[[ "$out" == *"stub rejection"* ]]'
check "rejected notarization: no archive, the stale one removed" no_artifact
check "rejected notarization: nothing stapled" '! grep -q "stapler staple" "$STUB_LOG"'

new_project
sign APPLE_SIGNING_IDENTITY="$id" APPLE_NOTARY_PROFILE=p STUB_IDENTITY="$id"
check "accepted: succeeds" '[[ $rc -eq 0 ]]' || echo "$out" >&2
check "accepted: archive and checksums written" '[[ -s "$proj/dist/$archive" && -s "$proj/dist/checksums.txt" ]]'
check "accepted: checksums.txt matches the archive" '(cd "$proj/dist" && shasum -a 256 -c checksums.txt >/dev/null)'
check "accepted: signed with hardened runtime and a timestamp" 'grep -q -- "--options runtime --timestamp --sign $id" "$STUB_LOG"'
check "accepted: submitted once, waiting for the result" '[[ $(grep -c "notarytool submit" "$STUB_LOG") -eq 1 ]] && grep -q "notarytool submit.*--wait" "$STUB_LOG"'
check "accepted: stapled before archiving" 'awk "/stapler staple/ {s=NR} /ditto -c.*$archive/ {a=NR} END {exit !(s && a && s < a)}" "$STUB_LOG"'
check "accepted: the unsigned dist/Quel.app is not signed" '! grep -q "^codesign.*$proj/dist/Quel.app" "$STUB_LOG"'

new_project
sign APPLE_SIGNING_IDENTITY="$id" APPLE_NOTARY_PROFILE=p STUB_IDENTITY="$id" APPLE_KEYCHAIN=/tmp/ci.keychain-db
check "APPLE_KEYCHAIN reaches security, codesign and notarytool" \
    'grep -q "^security find-identity.*/tmp/ci.keychain-db" "$STUB_LOG" && grep -q "^codesign.*--keychain /tmp/ci.keychain-db" "$STUB_LOG" && grep -q "notarytool submit.*--keychain /tmp/ci.keychain-db" "$STUB_LOG"'

echo "==> generate-cask.sh"

sha_a="$(printf 'a%.0s' {1..64})"
sha_b="$(printf 'b%.0s' {1..64})"
# cask VERSION CHECKSUMS_CONTENT: run generate-cask.sh; output in $out, status in $rc.
cask() {
    printf '%s' "$2" >"$stubs/checksums.txt"
    set +e
    out="$(bash "$ROOT/scripts/generate-cask.sh" "$1" "$stubs/checksums.txt" 2>&1)"
    rc=$?
    set -e
}
# The cask's url with #{version} expanded the way Homebrew does.
cask_url() {
    local v
    v="$(sed -n 's/^  version "\(.*\)"$/\1/p' <<<"$out")"
    sed -n 's/^  url "\(.*\)"$/\1/p' <<<"$out" | sed "s/#{version}/$v/g"
}

cask 1.2.3 "$sha_b  quel_1.2.2_darwin_arm64.zip
$sha_a  quel_1.2.3_darwin_arm64.zip
"
check "valid: succeeds" '[[ $rc -eq 0 ]]' || echo "$out" >&2
check "valid: the version is the input" 'grep -qx "  version \"1.2.3\"" <<<"$out"'
check "valid: the checksum of this version's archive" 'grep -qx "  sha256 \"$sha_a\"" <<<"$out"'
check "valid: the url is the release asset" \
    '[[ "$(cask_url)" == "https://github.com/abogoyavlensky/quel/releases/download/v1.2.3/quel_1.2.3_darwin_arm64.zip" ]]'
check "valid: Apple Silicon and macOS 15+ only" 'grep -q "depends_on arch: :arm64" <<<"$out" && grep -q "depends_on macos: \">= :sequoia\"" <<<"$out"'
check "valid: installs Quel.app" 'grep -qx "  app \"Quel.app\"" <<<"$out"'

cask 1.2.3 "$sha_a  quel_1.2.2_darwin_arm64.zip
"
check "no archive for the version: fails" '[[ $rc -ne 0 && "$out" == *"no checksum for quel_1.2.3_darwin_arm64.zip"* ]]'

cask 1.2.3 "$sha_a  quel_1.2.3_darwin_arm64.zip
$sha_b  quel_1.2.3_darwin_arm64.zip
"
check "duplicate archive entry: fails" '[[ $rc -ne 0 && "$out" == *"more than one checksum"* ]]'

for bad in "${sha_a:1}" "${sha_a}a" "$(tr a A <<<"$sha_a")" "$(printf 'g%.0s' {1..64})"; do
    cask 1.2.3 "$bad  quel_1.2.3_darwin_arm64.zip
"
    check "malformed hash ${bad:0:6}... (${#bad} chars): fails" '[[ $rc -ne 0 && "$out" == *"malformed checksum"* ]]'
done

for bad in v1.2.3 1.2 1.2.3-rc1 01.2.3 ""; do
    cask "$bad" "$sha_a  quel_${bad}_darwin_arm64.zip
"
    check "invalid version '$bad': fails" '[[ $rc -ne 0 && "$out" == *"VERSION must be MAJOR.MINOR.PATCH"* ]]'
done

set +e
out="$(bash "$ROOT/scripts/generate-cask.sh" 1.2.3 "$stubs/missing.txt" 2>&1)"
rc=$?
set -e
check "missing checksums file: fails" '[[ $rc -ne 0 && "$out" == *"checksums file not found"* ]]'

if [[ $fails -gt 0 ]]; then
    echo "$fails check(s) failed" >&2
    exit 1
fi
echo "All release script tests passed."
