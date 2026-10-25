#!/usr/bin/env bash
# Build Quel natively for Apple Silicon and assemble dist/Quel.app around it.
# No signing: verify-macos.sh ad-hoc signs a copy, sign-macos.sh signs for
# release. Every run assembles a fresh bundle, never touching a signed one.
#
#   lgx package-macos    (after lgx fe-install)
set -euo pipefail
source "$(dirname "$0")/macos-common.sh"

require_apple_silicon
version="$(read_version)"
cd "$MACOS_ROOT"

[[ -d frontend/node_modules ]] || die "frontend packages are missing: run lgx fe-install"
# The shipped app is the desktop build: a window over cgo, not Wails' server
# mode, with the production tag lgx.edn sets for the binary.
[[ "${CGO_ENABLED:-1}" == "1" ]] || die "CGO_ENABLED=$CGO_ENABLED: the desktop build needs cgo"
[[ "${GOFLAGS:-}" != *server* ]] || die "GOFLAGS has the server tag ($GOFLAGS): unset it"

export GOOS=darwin GOARCH=arm64 CGO_ENABLED=1
export MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN"
export CGO_CFLAGS="${CGO_CFLAGS:+$CGO_CFLAGS }-mmacosx-version-min=$MACOS_MIN"
export CGO_LDFLAGS="${CGO_LDFLAGS:+$CGO_LDFLAGS }-mmacosx-version-min=$MACOS_MIN"

mkdir -p "$DIST"
log="$DIST/build.log"
echo "==> Building $APP_NAME $version (frontend, then the native binary)"
lgx build 2>&1 | tee "$log"
# ld warns when an object targets a newer macOS than the binary claims: the
# deployment flags did not reach part of the build.
if grep -q "built for newer" "$log"; then
    die "the linker saw objects for a newer macOS than $MACOS_MIN (see $log)"
fi

echo "==> Icon"
iconset="$DIST/quel.iconset"
rm -rf "$iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" build/macos/icon.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" build/macos/icon.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$DIST/quel.icns"

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp bin/quel "$APP/Contents/MacOS/$EXECUTABLE"
cp "$DIST/quel.icns" "$APP/Contents/Resources/quel.icns"
sed -e "s/@VERSION@/$version/g" -e "s/@MACOS_MIN@/$MACOS_MIN/g" \
    build/macos/Info.plist >"$APP/Contents/Info.plist"
plutil -lint -s "$APP/Contents/Info.plist"

echo "Built $APP ($version, unsigned). Check it with lgx verify-macos."
