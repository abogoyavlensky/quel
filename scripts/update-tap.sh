#!/usr/bin/env bash
# Write Quel's cask for VERSION into a checkout of the Homebrew tap and push
# it. Only Casks/quel.rb is staged; an unchanged cask makes no commit. The
# tap is shared with other projects' release jobs, so a rejected push is
# retried on the tap's latest head, a few times, never forced. A tap that
# already has a newer Quel is left alone and the job fails.
#
#   bash scripts/update-tap.sh VERSION CHECKSUMS_FILE TAP_DIR
#
# TAP_DIR is a clone with push access (CI's actions/checkout with the tap
# token), on the branch to update.
set -euo pipefail
source "$(dirname "$0")/macos-common.sh"

[[ $# -eq 3 ]] || die "usage: update-tap.sh VERSION CHECKSUMS_FILE TAP_DIR"
version="$1"
checksums="$2"
tap="$3"
cask_file="Casks/quel.rb"
attempts="${TAP_PUSH_ATTEMPTS:-5}"

cask="$(bash "$(dirname "$0")/generate-cask.sh" "$version" "$checksums")"
branch="$(git -C "$tap" symbolic-ref --short HEAD)" || die "$tap is not on a branch"
git -C "$tap" config user.name "github-actions[bot]"
git -C "$tap" config user.email "github-actions[bot]@users.noreply.github.com"

# older A B: A is a lower MAJOR.MINOR.PATCH than B.
older() {
    local a b i
    IFS=. read -r -a a <<<"$1"
    IFS=. read -r -a b <<<"$2"
    for i in 0 1 2; do
        if ((10#${a[i]} != 10#${b[i]})); then
            ((10#${a[i]} < 10#${b[i]}))
            return
        fi
    done
    return 1
}

for ((attempt = 1; attempt <= attempts; attempt++)); do
    # Start from the tap's latest head each time; a commit from an earlier
    # attempt is dropped and made again.
    git -C "$tap" fetch --quiet origin "$branch"
    git -C "$tap" reset --quiet --hard FETCH_HEAD

    current=""
    if [[ -f "$tap/$cask_file" ]]; then
        current="$(sed -n 's/^  version "\(.*\)"$/\1/p' "$tap/$cask_file")"
    fi
    if [[ -n "$current" ]] && valid_version "$current" && older "$version" "$current"; then
        die "the tap already has Quel $current; not replacing it with $version"
    fi

    mkdir -p "$tap/Casks"
    printf '%s\n' "$cask" >"$tap/$cask_file"
    git -C "$tap" add -- "$cask_file"
    if git -C "$tap" diff --cached --quiet; then
        echo "$cask_file is already Quel $version; nothing to push"
        exit 0
    fi
    git -C "$tap" commit --quiet -m "quel $version"
    if git -C "$tap" push --quiet origin "HEAD:$branch"; then
        echo "Pushed $cask_file for Quel $version to $branch"
        exit 0
    fi
    echo "push rejected (attempt $attempt of $attempts); retrying on the latest tap" >&2
    sleep "${TAP_RETRY_DELAY:-$((attempt * 3))}"
done
die "could not push $cask_file after $attempts attempts"
