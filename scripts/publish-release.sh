#!/usr/bin/env bash
# Publish a GitHub Release for TAG with the archive and checksums.txt from
# DIR. The release is created as a draft, the assets are uploaded and then
# downloaded back and checked, and only then is it published. A draft left
# by a failed run is resumed; a published release is never changed.
#
#   GH_TOKEN=... bash scripts/publish-release.sh v0.1.0 dist
#
# Needs gh, with GH_TOKEN allowed to write the repository's contents.
set -euo pipefail
source "$(dirname "$0")/macos-common.sh"

[[ $# -eq 2 ]] || die "usage: publish-release.sh TAG DIR"
tag="$1"
dir="$2"
version="${tag#v}"
valid_version "$version" && [[ "$tag" == "v$version" ]] || die "'$tag' is not a release tag (vMAJOR.MINOR.PATCH)"
archive="$(archive_name "$version")"
[[ -f "$dir/$archive" && -f "$dir/checksums.txt" ]] || die "$dir must hold $archive and checksums.txt"
(cd "$dir" && shasum -a 256 -c checksums.txt >/dev/null) || die "$archive does not match $dir/checksums.txt"

if ! draft="$(gh release view "$tag" --json isDraft --jq .isDraft 2>&1)"; then
    [[ "$draft" == *"release not found"* ]] || die "gh release view $tag failed: $draft"
    draft=none
fi
case "$draft" in
none)
    echo "==> Creating draft release $tag"
    gh release create "$tag" --draft --verify-tag --title "$APP_NAME $version" --generate-notes >/dev/null
    ;;
true) echo "==> Resuming draft release $tag" ;;
false) die "release $tag is already published; its assets are never replaced" ;;
*) die "unexpected answer from gh release view: $draft" ;;
esac

gh release upload "$tag" "$dir/$archive" "$dir/checksums.txt" --clobber

echo "==> Checking the uploaded assets"
assets="$(gh release view "$tag" --json assets --jq '.assets[].name' | sort | tr '\n' ' ')"
expected="$(printf '%s\n' "$archive" checksums.txt | sort | tr '\n' ' ')"
[[ "$assets" == "$expected" ]] || die "draft $tag has assets '$assets', expected '$expected'; not published"
back="$(mktemp -d)"
trap 'rm -rf "$back"' EXIT
gh release download "$tag" --dir "$back" --pattern "$archive" --pattern checksums.txt
cmp -s "$dir/checksums.txt" "$back/checksums.txt" || die "the uploaded checksums.txt differs; not published"
(cd "$back" && shasum -a 256 -c checksums.txt >/dev/null) || die "the uploaded $archive does not match checksums.txt; not published"
echo "  ok: $archive and checksums.txt"

gh release edit "$tag" --draft=false >/dev/null
echo "Published $tag."
