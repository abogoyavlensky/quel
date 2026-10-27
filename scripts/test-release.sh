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
case "$1" in
find-identity)
    if [[ -n "${STUB_IDENTITY:-}" ]]; then echo "  1) ABCDEF \"$STUB_IDENTITY\""; echo "     1 valid identities found"
    else echo "     0 valid identities found"; fi ;;
list-keychains)
    [[ "$*" == *" -s"* ]] || printf "    \"%s\"\n" "/Users/runner/Library/Keychains/login.keychain-db" "/Library/Keychains/System Roots.keychain" ;;
import) [[ "${STUB_IMPORT:-ok}" == ok ]] ;;
esac'
stub codesign 'echo "codesign $*" >>"$STUB_LOG"'
stub spctl 'echo "spctl $*" >>"$STUB_LOG"; echo "accepted" >&2; echo "source=Notarized Developer ID" >&2'
stub ditto 'echo "ditto $*" >>"$STUB_LOG"
if [[ "$1" == -c ]]; then src="${@: -2:1}"; out="${@: -1}"; (cd "$(dirname "$src")" && zip -qr "$out" "$(basename "$src")")
else cp -R "$1" "$2"; fi'
stub xcrun 'echo "xcrun $*" >>"$STUB_LOG"
case "$1 $2" in
"notarytool history") [[ "${STUB_PROFILE:-ok}" == ok ]] ;;
"notarytool store-credentials") [[ "${STUB_STORE:-ok}" == ok ]] ;;
"notarytool submit") echo "{\"id\":\"sub-1\",\"status\":\"${STUB_NOTARY:-Accepted}\",\"message\":\"done\"}" ;;
"notarytool log") echo "{\"issues\":[{\"message\":\"stub rejection\"}]}" ;;
"stapler staple"|"stapler validate")
    # flaky: the first call of each action fails; bad: every call does.
    case "${STUB_STAPLE:-ok}" in
    ok) ;;
    flaky) [[ $(grep -c "^xcrun stapler $2" "$STUB_LOG") -gt 1 ]] || { echo "stub: the request timed out"; exit 68; } ;;
    *) echo "stub: the request timed out"; exit 68 ;;
    esac ;;
*) echo "unexpected xcrun $*" >&2; exit 1 ;;
esac'

# gh keeps one release in $STUB_GH: "state" (true for a draft, false once
# published, absent when there is none) and its assets in assets/.
stub gh 'echo "gh $*" >>"$STUB_LOG"
[[ -z "${STUB_GH_DOWN:-}" ]] || { echo "HTTP 502: Bad Gateway" >&2; exit 1; }
case "$1 $2" in
"release view")
    [[ -f "$STUB_GH/state" ]] || { echo "release not found" >&2; exit 1; }
    if [[ "$*" == *assets* ]]; then ls "$STUB_GH/assets"; else cat "$STUB_GH/state"; fi ;;
"release create") echo true >"$STUB_GH/state"; mkdir -p "$STUB_GH/assets" ;;
"release upload")
    for f in "${@:4}"; do [[ "$f" == --* ]] || cp "$f" "$STUB_GH/assets/"; done
    if [[ -n "${STUB_GH_CORRUPT:-}" ]]; then echo corrupt >>"$STUB_GH/assets/$(ls "$STUB_GH/assets" | grep zip)"; fi ;;
"release download")
    dir="${@: -5:1}"; cp "$STUB_GH/assets/${@: -3:1}" "$STUB_GH/assets/${@: -1}" "$dir/" ;;
"release edit") echo false >"$STUB_GH/state" ;;
*) echo "unexpected gh $*" >&2; exit 1 ;;
esac'

# --- a throwaway project with an unsigned bundle ---------------------------
new_project() {
    if [[ -n "${proj:-}" ]]; then rm -rf "$proj"; fi
    proj="$(mktemp -d)"
    mkdir -p "$proj/scripts" "$proj/dist/Quel.app/Contents/MacOS"
    cp "$ROOT"/scripts/macos-common.sh "$ROOT"/scripts/sign-macos.sh "$ROOT"/scripts/ci-sign-macos.sh \
        "$ROOT"/scripts/release-version.sh "$proj/scripts/"
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
sign APPLE_SIGNING_IDENTITY="$id" APPLE_NOTARY_PROFILE=p STUB_IDENTITY="$id" STUB_STAPLE=flaky STAPLER_RETRY_DELAY=0
check "stapler fails once: retried, succeeds" '[[ $rc -eq 0 && $(grep -c "stapler staple" "$STUB_LOG") -eq 2 && $(grep -c "stapler validate" "$STUB_LOG") -eq 2 ]]' || echo "$out" >&2
check "stapler fails once: its output is shown" '[[ "$out" == *"stapler staple failed (attempt 1 of 3)"* && "$out" == *"the request timed out"* ]]'

new_project
sign APPLE_SIGNING_IDENTITY="$id" APPLE_NOTARY_PROFILE=p STUB_IDENTITY="$id" STUB_STAPLE=bad STAPLER_RETRY_DELAY=0
check "stapler always fails: fails after 3 attempts" '[[ $rc -ne 0 && "$out" == *"could not staple"* && $(grep -c "stapler staple" "$STUB_LOG") -eq 3 ]]'
check "stapler always fails: nothing written" no_artifact

new_project
sign APPLE_SIGNING_IDENTITY="$id" APPLE_NOTARY_PROFILE=p STUB_IDENTITY="$id" APPLE_KEYCHAIN=/tmp/ci.keychain-db
check "APPLE_KEYCHAIN reaches security, codesign and notarytool" \
    'grep -q "^security find-identity.*/tmp/ci.keychain-db" "$STUB_LOG" && grep -q "^codesign.*--keychain /tmp/ci.keychain-db" "$STUB_LOG" && grep -q "notarytool submit.*--keychain /tmp/ci.keychain-db" "$STUB_LOG"'

echo "==> ci-sign-macos.sh"

p12_b64="$(printf 'not really a p12' | base64)"
secrets=(APPLE_CERTIFICATE_P12_BASE64="$p12_b64" APPLE_CERTIFICATE_PASSWORD=p12-secret-pw
    APPLE_SIGNING_IDENTITY="$id" APPLE_TEAM_ID=TEAM123456 APPLE_ID=dev@example.com
    APPLE_APP_SPECIFIC_PASSWORD=app-secret-pw)
# ci_sign [VAR=value...]: run ci-sign-macos.sh with the stand-ins and a fresh
# RUNNER_TEMP; output in $out, status in $rc.
ci_sign() {
    runner_temp="$proj/runner-temp"
    mkdir -p "$runner_temp"
    set +e
    out="$(cd "$proj" && env PATH="$stubs:$PATH" STUB_LOG="$STUB_LOG" RUNNER_TEMP="$runner_temp" \
        "$@" bash scripts/ci-sign-macos.sh 2>&1)"
    rc=$?
    set -e
}
original_list='security list-keychains -d user -s /Users/runner/Library/Keychains/login.keychain-db /Library/Keychains/System Roots.keychain'
# The temporary keychain is deleted, the search list ends as it started and
# nothing is left in RUNNER_TEMP.
cleaned_up() {
    grep -q "^security delete-keychain $runner_temp/quel-signing\.[^/]*/signing.keychain-db$" "$STUB_LOG" &&
        [[ "$(grep "^security list-keychains -d user -s" "$STUB_LOG" | tail -1)" == "$original_list" ]] &&
        [[ -z "$(ls -A "$runner_temp")" ]]
}
no_secret_in_output() { [[ "$out" != *p12-secret-pw* && "$out" != *app-secret-pw* && "$out" != *"$p12_b64"* ]]; }

new_project
ci_sign APPLE_CERTIFICATE_PASSWORD=x APPLE_ID=dev@example.com
check "missing secrets: fails, naming each" \
    '[[ $rc -ne 0 && "$out" == *"missing secrets: APPLE_CERTIFICATE_P12_BASE64 APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD" ]]'
check "missing secrets: no keychain touched" '! grep -q "^security" "$STUB_LOG"'

new_project
ci_sign "${secrets[@]}" STUB_IDENTITY="$id" STUB_IMPORT=bad
check "certificate import fails: fails" '[[ $rc -ne 0 && "$out" == *"could not import the certificate"* ]]'
check "certificate import fails: keychain deleted, search list restored" cleaned_up
check "certificate import fails: nothing signed" '! grep -q "^codesign" "$STUB_LOG"'

new_project
ci_sign "${secrets[@]}" STUB_IDENTITY="$id" STUB_NOTARY=Invalid
check "notarization rejected: fails" '[[ $rc -ne 0 && "$out" == *"notarization was not accepted"* ]]'
check "notarization rejected: keychain deleted, search list restored" cleaned_up
check "notarization rejected: no archive" no_artifact

new_project
ci_sign "${secrets[@]}" STUB_IDENTITY="$id"
check "signed: succeeds" '[[ $rc -eq 0 ]]' || echo "$out" >&2
check "signed: archive and checksums written" '[[ -s "$proj/dist/$archive" && -s "$proj/dist/checksums.txt" ]]'
check "signed: the temporary keychain is searched first while signing" \
    'grep -q "^security list-keychains -d user -s $runner_temp/quel-signing\.[^/]*/signing.keychain-db /Users/runner/Library/Keychains/login.keychain-db /Library/Keychains/System Roots.keychain$" "$STUB_LOG"'
check "signed: signs and notarizes through the temporary keychain and profile" \
    'grep -q "^codesign.*--keychain $runner_temp/quel-signing" "$STUB_LOG" && grep -q "notarytool submit.*--keychain-profile quel-ci --keychain $runner_temp/quel-signing" "$STUB_LOG"'
check "signed: keychain deleted, search list restored, temp files removed" cleaned_up
check "signed: no secret value in the output" no_secret_in_output

echo "==> release-version.sh"

new_project
# version [TAG]: run release-version.sh; output in $out, status in $rc.
version() {
    set +e
    out="$(cd "$proj" && bash scripts/release-version.sh "$@" 2>&1)"
    rc=$?
    set -e
}
version
check "no tag: prints VERSION" '[[ $rc -eq 0 && "$out" == 0.1.0 ]]'
version v0.1.0
check "matching tag: prints VERSION" '[[ $rc -eq 0 && "$out" == 0.1.0 ]]'
for tag in v0.1.1 0.1.0 v0.1 v0.1.0-rc1 V0.1.0; do
    version "$tag"
    check "tag '$tag' against VERSION 0.1.0: fails" '[[ $rc -ne 0 && "$out" == *"does not match VERSION 0.1.0"* ]]'
done
printf '0.2\n' >"$proj/VERSION"
version v0.2
check "malformed VERSION: fails" '[[ $rc -ne 0 && "$out" == *"VERSION must be MAJOR.MINOR.PATCH"* ]]'

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

echo "==> publish-release.sh"

# new_release [draft|published]: a release directory, and the release state on "GitHub".
new_release() {
    new_project
    rel="$proj/release"
    STUB_GH="$proj/gh"
    mkdir -p "$rel" "$STUB_GH"
    printf 'zip bytes\n' >"$rel/$archive"
    (cd "$rel" && shasum -a 256 "$archive" >checksums.txt)
    case "${1:-}" in
    draft) echo true >"$STUB_GH/state"; mkdir -p "$STUB_GH/assets"; echo old >"$STUB_GH/assets/$archive" ;;
    published) echo false >"$STUB_GH/state"; mkdir -p "$STUB_GH/assets"; cp "$rel"/* "$STUB_GH/assets/" ;;
    esac
}
# publish TAG [VAR=value...]: run publish-release.sh; output in $out, status in $rc.
publish() {
    local tag="$1"
    shift
    set +e
    out="$(cd "$proj" && env PATH="$stubs:$PATH" STUB_LOG="$STUB_LOG" STUB_GH="$STUB_GH" "$@" \
        bash "$ROOT/scripts/publish-release.sh" "$tag" "$rel" 2>&1)"
    rc=$?
    set -e
}
state() { cat "$STUB_GH/state" 2>/dev/null || echo none; }

new_release
publish v0.1.0
check "new release: succeeds" '[[ $rc -eq 0 ]]' || echo "$out" >&2
check "new release: created as a draft, then published" \
    'grep -q "^gh release create v0.1.0 --draft --verify-tag" "$STUB_LOG" && [[ $(state) == false ]]'
check "new release: published only after the assets were checked" \
    'awk "/release download/ {d=NR} /release edit/ {e=NR} END {exit !(d && e && d < e)}" "$STUB_LOG"'
check "new release: holds exactly the archive and checksums.txt" \
    '[[ "$(ls "$STUB_GH/assets" | tr "\n" " ")" == "checksums.txt $archive " ]] && cmp -s "$rel/$archive" "$STUB_GH/assets/$archive"'

new_release draft
publish v0.1.0
check "a draft from a failed run: resumed and published" \
    '[[ $rc -eq 0 && $(state) == false ]] && ! grep -q "release create" "$STUB_LOG" && cmp -s "$rel/$archive" "$STUB_GH/assets/$archive"'

new_release draft
echo stray >"$STUB_GH/assets/notes.txt"
publish v0.1.0
check "a draft with an extra asset: fails, stays a draft" '[[ $rc -ne 0 && "$out" == *"not published"* && $(state) == true ]]'

new_release published
publish v0.1.0
check "already published: fails, nothing uploaded" \
    '[[ $rc -ne 0 && "$out" == *"already published"* ]] && ! grep -q "release upload" "$STUB_LOG"'

new_release
publish v0.1.0 STUB_GH_CORRUPT=1
check "upload corrupted: fails, stays a draft" '[[ $rc -ne 0 && "$out" == *"not published"* && $(state) == true ]]'

new_release
publish v0.1.0 STUB_GH_DOWN=1
check "GitHub unavailable: fails, no release created" '[[ $rc -ne 0 && "$out" == *"502"* ]] && ! grep -q "release create" "$STUB_LOG"'

new_release
echo tampered >>"$rel/$archive"
publish v0.1.0
check "archive does not match checksums.txt: fails before GitHub" '[[ $rc -ne 0 ]] && ! grep -q "^gh" "$STUB_LOG"'

new_release
publish v0.1
check "malformed tag: fails before GitHub" '[[ $rc -ne 0 && "$out" == *"not a release tag"* ]] && ! grep -q "^gh" "$STUB_LOG"'

echo "==> update-tap.sh"

# new_tap: a bare "remote" tap with another project's formula, and a CI
# clone of it in $tap.
new_tap() {
    new_project
    remote="$proj/homebrew-tap.git"
    git init --quiet --bare --initial-branch=main "$remote"
    git -C "$remote" config receive.denyNonFastForwards true
    git clone --quiet "$remote" "$proj/seed" 2>/dev/null
    mkdir -p "$proj/seed/Formula"
    echo 'class Lgx < Formula; end' >"$proj/seed/Formula/lgx.rb"
    git -C "$proj/seed" add -A
    git -C "$proj/seed" -c user.name=t -c user.email=t@t commit --quiet -m "lgx"
    git -C "$proj/seed" push --quiet origin main
    tap="$proj/tap"
    git clone --quiet "$remote" "$tap"
    printf '%s  %s\n' "$sha_a" quel_1.2.3_darwin_arm64.zip "$sha_b" quel_2.0.0_darwin_arm64.zip >"$proj/checksums.txt"
}
# another_push FILE CONTENT: someone else's commit lands on the remote tap.
another_push() {
    mkdir -p "$(dirname "$proj/seed/$1")"
    printf '%s\n' "$2" >"$proj/seed/$1"
    git -C "$proj/seed" pull --quiet --rebase origin main
    git -C "$proj/seed" add -A
    git -C "$proj/seed" -c user.name=t -c user.email=t@t commit --quiet -m "$1"
    git -C "$proj/seed" push --quiet origin main
}
# update_tap VERSION: run update-tap.sh; output in $out, status in $rc.
update_tap() {
    set +e
    out="$(TAP_RETRY_DELAY=0 bash "$ROOT/scripts/update-tap.sh" "$1" "$proj/checksums.txt" "$tap" 2>&1)"
    rc=$?
    set -e
}
remote_cask_version() { git -C "$remote" show main:Casks/quel.rb 2>/dev/null | sed -n 's/^  version "\(.*\)"$/\1/p'; }
commits() { git -C "$remote" rev-list --count main; }

new_tap
update_tap 1.2.3
check "first cask: pushed" '[[ $rc -eq 0 && $(remote_cask_version) == 1.2.3 ]]' || echo "$out" >&2
check "first cask: the commit touches only Casks/quel.rb" \
    '[[ "$(git -C "$remote" show --name-only --format= main)" == Casks/quel.rb ]]'
check "first cask: the other formula is untouched" \
    '[[ "$(git -C "$remote" show main:Formula/lgx.rb)" == "class Lgx < Formula; end" ]]'
n="$(commits)"
update_tap 1.2.3
check "same version again: no commit" '[[ $rc -eq 0 && "$out" == *"nothing to push"* && $(commits) -eq $n ]]'

new_tap
another_push Formula/other.rb 'class Other < Formula; end'
update_tap 1.2.3
check "a stale clone: the cask lands on top of the newer tap" \
    '[[ $rc -eq 0 && $(remote_cask_version) == 1.2.3 ]] && git -C "$remote" show main:Formula/other.rb >/dev/null'

new_tap
# The first push is rejected, as when another release job pushes first.
cat >"$remote/hooks/pre-receive" <<'HOOK'
#!/usr/bin/env bash
if [[ ! -f rejected-once ]]; then touch rejected-once; echo "simulated race" >&2; exit 1; fi
HOOK
chmod +x "$remote/hooks/pre-receive"
update_tap 1.2.3
check "a rejected push: retried and pushed" \
    '[[ $rc -eq 0 && "$out" == *"attempt 1 of 5"* && $(remote_cask_version) == 1.2.3 ]]'

new_tap
cat >"$remote/hooks/pre-receive" <<'HOOK'
#!/usr/bin/env bash
echo "always rejected" >&2; exit 1
HOOK
chmod +x "$remote/hooks/pre-receive"
update_tap 1.2.3
check "pushes keep failing: gives up after 5 attempts" '[[ $rc -ne 0 && "$out" == *"after 5 attempts"* && -z $(remote_cask_version) ]]'

new_tap
update_tap 2.0.0
n="$(commits)"
update_tap 1.2.3
check "an older version: refused, the newer cask stays" \
    '[[ $rc -ne 0 && "$out" == *"already has Quel 2.0.0"* && $(remote_cask_version) == 2.0.0 && $(commits) -eq $n ]]'

new_tap
git clone --quiet "$remote" "$proj/stale-tap"
another_push Casks/quel.rb "$(printf 'cask "quel" do\n  version "2.0.0"\nend')"
tap="$proj/stale-tap"
update_tap 1.2.3
check "a newer Quel lands while this job runs: refused after refreshing" \
    '[[ $rc -ne 0 && "$out" == *"already has Quel 2.0.0"* && $(remote_cask_version) == 2.0.0 ]]'

new_tap
update_tap 1.2.3
update_tap 2.0.0
check "a newer version: replaces the older cask" '[[ $rc -eq 0 && $(remote_cask_version) == 2.0.0 ]]'

if [[ $fails -gt 0 ]]; then
    echo "$fails check(s) failed" >&2
    exit 1
fi
echo "All release script tests passed."
