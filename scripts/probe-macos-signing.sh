#!/usr/bin/env bash
# A disposable, secret-free experiment. This never publishes an artifact.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
    echo 'This experiment requires an Apple Silicon Mac.' >&2
    exit 1
}
mkdir -p .tmp/signing-probe
evidence="$PWD/.tmp/signing-probe"
scratch="$(mktemp -d)"
app_pid=""
cleanup() {
    if [[ -n "$app_pid" ]]; then
        kill "$app_pid" 2>/dev/null || true
        wait "$app_pid" 2>/dev/null || true
    fi
    rm -rf "$scratch"
}
trap cleanup EXIT

{
    uname -srm
    xcodebuild -version
    mise current
} > "$evidence/toolchain.txt" 2>&1
cat "$evidence/toolchain.txt"

unset LGX_RUN FRONTEND_DEVSERVER_URL GOFLAGS
export GOOS=darwin GOARCH=arm64 CGO_ENABLED=1
export MACOSX_DEPLOYMENT_TARGET=15.0
export CGO_CFLAGS=-mmacosx-version-min=15.0
export CGO_LDFLAGS=-mmacosx-version-min=15.0
lgx fe-install
lgx build
cp bin/quel "$scratch/quel-original"
cp bin/quel "$scratch/quel-signed"

# Liveness alone does not prove the webview rendered or the bridge worked.
# A manual native pass remains required if structural signing succeeds.
launch_probe() {
    local name="$1" rc=0
    mkdir -p "$scratch/data-$name"
    (
        cd "$scratch"
        export QUEL_DATA_DIR="$scratch/data-$name" QUEL_SECRETS=memory
        exec "$scratch/quel-$name"
    ) > "$evidence/launch-$name.log" 2>&1 &
    app_pid=$!
    sleep 8
    if kill -0 "$app_pid" 2>/dev/null; then
        echo "$name: alive after 8s (not a UI/bridge verification)" >> "$evidence/summary.txt"
        kill "$app_pid" 2>/dev/null || true
        wait "$app_pid" 2>/dev/null || true
    else
        wait "$app_pid" || rc=$?
        echo "$name: exited with status $rc" >> "$evidence/summary.txt"
    fi
    app_pid=""
}

file bin/quel > "$evidence/binary.txt"
otool -l bin/quel > "$evidence/load-commands-before.txt"
tail -c 32 bin/quel | xxd > "$evidence/trailer-before.txt"
launch_probe original

sign_rc=0
codesign --force --sign - --options runtime "$scratch/quel-signed" \
    > "$evidence/codesign.txt" 2>&1 || sign_rc=$?
verify_rc=0
codesign --verify --strict --verbose=2 "$scratch/quel-signed" \
    > "$evidence/verify.txt" 2>&1 || verify_rc=$?
printf 'codesign status: %s\nverify status: %s\n' "$sign_rc" "$verify_rc" >> "$evidence/summary.txt"
tail -c 32 "$scratch/quel-signed" | xxd > "$evidence/trailer-after.txt"
launch_probe signed
cat "$evidence/summary.txt" "$evidence/codesign.txt" "$evidence/verify.txt"
[[ "$sign_rc" == 0 && "$verify_rc" == 0 ]]
