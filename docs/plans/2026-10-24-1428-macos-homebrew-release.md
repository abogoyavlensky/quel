# Signed macOS App and Homebrew Release Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a signed, notarized Apple Silicon `Quel.app` on version tags and install it through `brew install --cask abogoyavlensky/tap/quel`.

**Tech Stack:** let-go 1.13.0 and lgx 0.5.1 initially; Wails v3.0.0-beta.30; macOS signing tools; GitHub Actions and Releases; the existing `abogoyavlensky/homebrew-tap` repository.

---

**Status: Tasks 1-6 done; Task 7 Steps 1-4 done; the first release (Step 5) waits for authorization.** The user approved implementation on branch `macos-homebrew-release` and performed the local signing experiments step by step. The `lg -b` executable fails signing (`main executable failed strict validation`) on CI and on the user's Mac. Quel now builds natively through lgx 0.5.2 (`f877b28`), and a minimal `Quel.app` around that build signs with Developer ID under hardened runtime, passes strict verification, is rejected by `spctl` only as unnotarized, and runs the real UI; see Task 1. Do not launch further signing experiments without explicit approval. This plan is not complete.

## Design

### Existing state and fixed decisions

Quel's `master` at `0bb8d7a` builds `bin/quel` through `lgx build` (`lg -b`) with the Wails `production` tag; the frontend and bytecode are appended to the executable as let-go's bundle payload. There is no app bundle, icon, release workflow, or version tag yet. CI runs backend/Postgres, frontend, smoke, and browser tests on Linux in server mode.

The user chose `.app`, Homebrew, releases on git tags, and Apple Silicon only. They have a paid Apple Developer account and supplied the icon. Mirror the release/tap arrangement in `../lgx/.github/workflows/release.yml` and `../clj-pulse/.github/workflows/release.yml`. The shared tap already exists; add `Casks/quel.rb` beside its existing `Formula/` directory.

Default to a ZIP containing `Quel.app`, named `quel_VERSION_darwin_arm64.zip`, plus `checksums.txt`. A DMG, Intel build, universal binary, App Store submission, in-app updater, Linux distribution, and unrelated application features are outside this plan. Users upgrade through Homebrew.

Use macOS 15+ as the initial supported OS, built and tested on the pinned `macos-15` ARM runner. M1 and newer are the hardware scope. Set the deployment target to 15.0 consistently in cgo compilation/linking and `Info.plist`, and verify the final Mach-O load commands. Raise a genuine toolchain incompatibility rather than silently changing the minimum. The runner label is an OS-image pin, not an immutable Xcode pin; record the Xcode version in logs.

### Prerequisite: a signed executable must still load Quel

The pinned let-go bundler copies the runtime executable, then appends bytecode, resources, and a trailer. `pkg/bundle/bundle.go:68` locates that trailer relative to physical EOF. `pkg/cli/cli.go:144` implements bundling. Apple's signing guidance explicitly rejects arbitrary appended Mach-O data, and signing modifies the executable. Wrapping it in `.app` does not solve this.

First reproduce signing and launch behavior on a Mac using the actual production build. An ad-hoc signature is enough to expose structural problems, but does not prove Developer ID distribution works. Record both verification and launch, including frontend assets, before and after signing.

If the current build fails this experiment, stop dependent tasks and scope an upstream fix in let-go/lgx. Preferred direction for that follow-up: a conventional signed Mach-O executable with its bytecode and frontend payload stored in supported app resources or embedded by the linker, discovered without relying on the working directory. The follow-up must decide and test the actual format and startup interface; this plan does not invent one. Required contract before resuming:

- A reproducible, version-pinned production build yields a signable ARM64 executable and any explicit resource files.
- Launch from Finder and an unrelated working directory loads the program and frontend without `lg`, `lgx`, Go, Node, or the source checkout installed.
- Hardened-runtime signing preserves startup, database access, and the bridge; no app-local Go shim, signature bypass, or unsigned fallback.
- A released upstream version is pinned in Quel; package layout and commands below are updated to the proven interface and reviewed before proceeding.

**Resolution (2026-10-24).** The prerequisite is met by lgx's `:target :native`, not by a new bundle format. `lg compile` lowers the program to Go and embeds its bytecode with `go:embed`, so the output is an ordinary Mach-O. Two gaps, both closed on the lgx side by the plan named in the status line: the frontend resources are embedded through a generated package passed to `lg compile` with `-import` (let-go has no resource support for native builds yet, nooga/let-go#1099), and only the project's own namespaces are lowered, because lowering dependencies trips nooga/let-go#1098 on `sql.core/with-transaction`. Quel then pins `:lg-version` to a let-go `main` commit (allowed under `:lg-runtime :built`), sets `:targets {:bin {:target :native :out "bin/quel" :go/build-tags ["production"]}}`, and pins the lgx release. The bundle keeps the baseline layout: no runtime resource files beside the executable.

Approval of this plan permits the experiment and the release work after it passes. It does not authorize an unbounded runtime/compiler redesign. A failed prerequisite is reported with exact evidence and a proposed upstream scope, not worked around silently. Icon preparation and documentation can proceed independently, but the release cannot ship until this passes.

### App packaging and icon

Keep `lgx build` as the production build owner. Use a small `scripts/package-macos.sh` to assemble the standard bundle around its verified output. Wails' generated `darwin:package` task invokes `go build` through its dependencies, so do not call that task blindly in a let-go project. Use its bundle layout as reference and Apple's native tools for signing/notarization; a full generated Wails Taskfile tree is unnecessary here.

Proposed stable identity: `io.github.abogoyavlensky.quel`. Display name: `Quel`; executable: `quel`; category: developer tools. A root `VERSION` file, initially `0.1.0`, is the single release-version source. Trim surrounding whitespace; allow stable `MAJOR.MINOR.PATCH` only for this first pipeline. Both `CFBundleShortVersionString` and `CFBundleVersion` come from it. CI requires the tag to equal `v` plus this version. Do not read a version resource at runtime merely for packaging.

Baseline layout, subject only to the proven prerequisite interface:

```text
Quel.app/Contents/
  Info.plist
  MacOS/quel
  Resources/quel.icns
  # Any explicit runtime resources required by the resolved signing prerequisite.
```

The attached PNG is 1254x1254, RGB (no alpha), SHA-256 `357ee6546be01150bf14ef352db9fbf72a1805cfce72290dbda99150d9eaa7cb`.
Source attachment: `/home/agent/.t3/userdata/attachments/155a0d16-9077-4bf5-b0c4-252a65f7a23d-c9d5ea23-7627-47da-accf-f50985157938.png`.
During implementation copy it unchanged to `build/macos/icon-source.png` so the repo no longer depends on the attachment path. Preserve the navy rounded tile and turquoise four-pane Q. Remove the pale exterior background, avoiding a white rectangular plate around the tile. Produce a centered 1024x1024 RGBA master with transparent exterior padding, keeping the supplied silhouette and proportions. Use `/imagegen` for background removal, inspect the result against the source, and reject altered letterform or geometry. Image editing is a one-time implementation step, never a CI dependency.

Commit the approved master as `build/macos/icon.png`. Generate the conventional 16, 32, 128, 256, and 512 point @1x/@2x iconset with `sips`, then `.icns` with `iconutil`; those generated files stay under ignored `dist/`. Inspect the 16, 32, 128, and 512 pixel renditions on light and dark backgrounds. A conventional `.icns` is sufficient for this release; layered Icon Composer assets can come later.

### Signing, verification, and credentials

Use a Developer ID Application certificate, hardened runtime, and secure timestamp. Start with no exception entitlements; add only entitlements proved necessary by the packaged-app smoke test. Do not enable App Sandbox or JIT/unsigned-memory exceptions by default. This is outside-App-Store distribution.

CI imports the certificate into a temporary keychain and configures a temporary notarization profile with `notarytool`. Inputs:

- `APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD`: Developer ID Application certificate and private key export.
- `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_ID`: identity/account metadata, configured explicitly.
- `APPLE_APP_SPECIFIC_PASSWORD`: for `notarytool` authentication.
- `HOMEBREW_TAP_TOKEN`: Contents write access to `abogoyavlensky/homebrew-tap`, following the existing projects.

Use GitHub secrets for sensitive values. If collecting a secret through T3, use `request_secret`, never chat. Certificate-file transfer should use the user's private GitHub setup or a supported private mechanism. Do not read or print existing secret values. Document setup before asking for any missing input. An unavailable certificate or Mac prevents the corresponding verification; it does not justify claiming it passed.

Sign nested executables, if any, inside out, then the app; `--deep` is for verification, not the signing recipe. Submit a temporary ZIP using `xcrun notarytool submit --wait`, require Accepted, staple and validate the app, then create the final ZIP with `ditto`. Calculate the published checksum only after stapling and final archiving. Missing credentials, rejection, failed validation, or failed launch prevent publishing. Always remove imported certificate material and the temporary keychain on completion or failure; restore the original keychain search list.

### Pipeline and tap updates

Add `workflow_call` to existing Linux CI and reuse it from releases. A tag push matching `v*` starts version validation and checks, followed by native build/package/sign/notarize/verify on `macos-15`, release publication, and the tap update. Add a secret-free macOS packaging verification job for PRs once the prerequisite is resolved. It should build the real desktop target, ad-hoc sign, and check the bundle. Linux server-mode success does not substitute for that check.

Keep ordinary jobs read-only. Only publishing needs repository Contents write; only the tap updater gets the tap token. Add the app ZIP and `checksums.txt` to a GitHub Release with generated notes. Keep a draft until assets are verified and complete. Never overwrite an already published version's assets; a retry may resume an unpublished draft, while a tap-only retry reuses the published checksum. One release workflow runs at a time without cancelling an active release; an older version must not replace a newer cask on a late retry.

Generate `Casks/quel.rb` from version and the published checksum. Include the exact GitHub asset URL, `app "Quel.app"`, `depends_on arch: :arm64`, and macOS >= Sequoia. No runtime language dependencies or quarantine-removal commands. Normal uninstall leaves profiles and saved queries intact; no destructive `zap` behavior in this first third-party cask.

The tap updater stages only `Casks/quel.rb`, makes no commit when unchanged, and retries a rejected push by rebasing/reapplying on the latest tap head with a bounded limit. This matters because other tools write to the same repository. Never force-push or replace the tap tree. Recheck cask version after refreshing the tap head so a concurrent newer Quel release wins.

### Verification and completion

Keep the existing application test suite. Add focused tests for artifact/checksum/version validation and the cask generator, plus actual native packaging checks. Native verification uses isolated `QUEL_DATA_DIR` and `QUEL_SECRETS=memory`, with `LGX_RUN` and frontend-dev-server variables unset. Automated process survival is only a basic launch check; a rendered frontend and working bridge need a native manual pass unless reliable native UI automation is available.

The first release acceptance check installs the actual Homebrew artifact, launches through Finder, checks the icon and embedded UI, opens a disposable SQLite database, runs a query, restarts to verify saved tabs, and tests one scratch Keychain-backed profile. The latter is a deliberate manual check, never an automated test against real credentials. Verify normal Gatekeeper behavior on the downloaded quarantined artifact. Verify upgrade preserves application data once a second release exists; do not invent or publish an extra version just for this test.

Implementation is ready to hand back when code, checks, setup instructions, and the exact release commands are reviewable. A first live tag/tap publication is a separately explicit release action unless the user has already authorized it. Report readiness and live-publication state separately. No successful release claim until the published artifact has passed the applicable checks.

## File Structure

- `VERSION`: stable application release version.
- `build/macos/icon-source.png`, `build/macos/icon.png`: supplied source and adapted RGBA master.
- `build/macos/Info.plist`: app identity, icon, minimum OS, version placeholders.
- `scripts/package-macos.sh`: production build, iconset, clean bundle assembly; no signing credentials.
- `scripts/verify-macos.sh`: architecture, plist, linkage, signature, optional distribution checks, isolated launch smoke.
- `scripts/sign-macos.sh`: Developer ID signing, notarization, stapling, final ZIP and checksum; keychain setup belongs to CI.
- `scripts/generate-cask.sh`: validated version/checksum to Ruby on stdout.
- `scripts/test-release.sh`: meaningful release-input and generator tests using temporary fixtures.
- `.github/workflows/ci.yml`: reusable existing checks, plus native package validation.
- `.github/workflows/release.yml`: version gate, CI reuse, native release, publication, tap update.
- `lgx.edn`: `package-macos` and `verify-macos` task aliases; proven dependency updates if required.
- `.mise.toml`: dependency updates only if the prerequisite requires them.
- `.gitignore`: `dist/` and generated packaging output; keep `build/macos/` source assets tracked.
- `README.md`, `docs/RELEASE.md`, `docs/DESIGN.md`: installation, release/setup guide, actual distribution decisions and verified scope.
- External `abogoyavlensky/homebrew-tap/Casks/quel.rb`: generated by the release workflow, not a second manually maintained source.

## Tasks

### Task 1: Prove signing compatibility before choosing a production package layout

**Files:** Read `lgx.edn`, `src/quel/app.lg`, `src/quel/system.lg`, pinned upstream `pkg/bundle/bundle.go` and `pkg/cli/cli.go`; record results in this plan.

> Progress 2026-10-24: branch created and approved plan committed (`6120360`). Added a secret-free probe workflow/script (`882697a`) because the workspace is Linux. The initial push started Actions run 40107553708 before the user's instruction to ask first arrived. Cancellation via API returned HTTP 403; the user was given the cancellation link. Automatic push triggering was removed immediately. No further experiment execution is authorized yet. A workflow_dispatch-only workflow generally needs to exist on the default branch to be dispatchable; do not merge it or restore push triggering just to bypass the approval checkpoint. No signing pass or native UI verification is claimed.

- [x] **Step 1:** Create branch `macos-homebrew-release` from current master after preserving any unrelated work. Locate an ARM64 Mac or GitHub-hosted macOS experiment environment; do not run a release tag to obtain one. Verify `uname -m` is `arm64` and record toolchain versions.
- [x] **Step 2:** On that Mac run `lgx fe-install && lgx build` with desktop cgo enabled and no server build tag. Launch the unsigned production output from a temporary directory with a fresh `QUEL_DATA_DIR` and `QUEL_SECRETS=memory`. Confirm the UI and SQLite query work. Keep the original binary for comparison. (Superseded for the `lg -b` output by the failure below; done for the native build, see the native-build evidence.)
- [x] **Step 3:** On a disposable copy run `codesign --force --sign - --options runtime PATH_TO_COPY`, then `codesign --verify --strict --verbose=2 PATH_TO_COPY`. Attempt the same isolated launch. Record exact output, exit status, and whether bytecode and assets load. This command is for the experiment only, not the final signing identity.
- [x] **Step 4:** Once Quel builds natively through a released lgx (Step 5), assemble a disposable minimal `Quel.app` around that output, with a minimal valid Info.plist, and verify Developer ID signing and launch before declaring the prerequisite fully satisfied. This experiment does not depend on Task 3's permanent scripts or the finished icon. Do not substitute a shell launcher or turn off signature checks.
- [x] **Step 5:** When an lgx release carries the native-build plan, pin it in `.mise.toml`, pin `:lg-version` to the let-go `main` commit it was verified with, switch `:targets :bin` to `:target :native` with `:go/build-tags ["production"]`, and update `docs/DESIGN.md`'s Builds section. Run `lgx test`, `lgx smoke` and `lgx e2e` (they use `lgx run`, so they also exercise the new let-go pin), then `lgx build` on the Mac and repeat Steps 2-3 on its output. Commit with `git commit -m "Build Quel natively for signed macOS releases"`. The probe script and workflow from Step 1 test the old `lg -b` output: delete them in that commit.

> Progress 2026-10-25: lgx 0.5.2 released with the native-build plan. Pinned it in `.mise.toml` and `:lg-version` to `18df3ad5c033cbf8f214c7d2a09e97f78a642510`, switched `:bin` to `:target :native` with `["production"]`, updated DESIGN.md's Builds section, and deleted the probe script and workflow (`f877b28`). On Linux with `CGO_ENABLED=0 GOFLAGS=-tags=server`: `lgx build` lowered 232 functions with 7 dependency namespaces on bytecode and built `bin/quel`; `lgx test`, `lgx smoke` (Postgres step skipped) and `lgx e2e` (10 passed) passed. `bin/quel` run from `/tmp` with `QUEL_SECRETS=memory` and a temp `QUEL_DATA_DIR` served `/` and its JS asset with 200. On the user's Apple Silicon Mac, `lgx build` from lgx 0.5.2 built `bin/quel` natively (232 functions lowered, `quel.migrations` skipped with no lowerable defns). The unsigned copy and an ad-hoc signed copy, each launched from `/tmp` with `QUEL_SECRETS=memory` and its own temp `QUEL_DATA_DIR`, showed the UI, opened a SQLite file and ran a query. `codesign --force --sign - --options runtime` gave `sign=0`, and `codesign --verify --strict --verbose=2` gave `verify=0` (valid on disk, satisfies its Designated Requirement). The build ran without `MACOSX_DEPLOYMENT_TARGET`, so `ld` warned that objects built for macOS 13.0 (Go) and 26.0 (Wails' cgo) were linked for 11.0; Task 3 must remove those warnings.

> Step 4 progress 2026-10-25: rebuilt on the Mac with `MACOSX_DEPLOYMENT_TARGET=15.0` and `CGO_CFLAGS`/`CGO_LDFLAGS` `-mmacosx-version-min=15.0`: no `built for newer` warnings, `otool -l` shows `minos 15.0`. A minimal `Quel.app` (executable `quel`, the Design section's identity, version 0.1.0, `LSMinimumSystemVersion` 15.0, no icon, no entitlements) signed with `codesign --force --options runtime --timestamp`: `sign=0`, `verify=0` (`--deep --strict`), `flags=0x10000(runtime)`, secure timestamp present. Launched from Terminal and with `open -n --env QUEL_SECRETS=memory --env QUEL_DATA_DIR=...`, it showed the UI, the "Quel" menu and About box (Version 0.1.0), opened a SQLite file, browsed its structure and ran a query. That first signature used an Apple Development certificate, so `spctl` rejected it with `origin=Apple Development: ...`. The user then created a Developer ID Application certificate in Xcode (login keychain, 2026-10-25) and re-signed the same bundle with it: `sign=0`, `verify=0`, `Authority=Developer ID Application: Andrey Bogoyavlenskiy (TEAM)` → `Developer ID Certification Authority` → `Apple Root CA`, team identifier set, `Timestamp=Oct 25, 2026 at 18:12:29`, `flags=0x10000(runtime)`. `spctl --assess --type execute` gave `rejected` with `source=Unnotarized Developer ID`, the expected result before notarization (Task 4). Relaunched with `open -n --env QUEL_SECRETS=memory --env QUEL_DATA_DIR=<temp>`, it showed the UI, opened a SQLite file, browsed the structure and ran a query. No entitlements were needed. Not yet covered: notarization and stapling (Task 4), a Finder launch of a quarantined download, the icon, and Keychain access under hardened runtime (the release acceptance check).

> Evidence 2026-10-24: [CI run 40107553708](https://github.com/abogoyavlensky/quel/actions/runs/40107553708) completed with failure. The production build succeeded on Darwin 24.6.0 arm64, Xcode 16.4, lg 1.13.0, lgx 0.5.1, Go 1.27.3, Node 24.22.1. `codesign --force --sign - --options runtime` and `codesign --verify --strict --verbose=2` both returned 1 with `main executable failed strict validation`. Both process copies survived the 8-second liveness probe; that is not proof of a rendered UI or working bridge, and the copy called "signed" never acquired a valid signature.

> Local reproduction: the user confirmed `arm64`, Xcode selected at `/Applications/Xcode.app/Contents/Developer`, installed mise tools, and a successful production build with macOS deployment target 15.0. They copied `bin/quel` to a fresh temporary directory and ran the same two codesign commands. Both returned 1 and the identical strict-validation error. No Developer ID credentials were used; the original binary was unchanged. Structural signing failure is reproduced on two Macs. A local native UI/SQLite pass was not reported, so Step 2 and the full Step 3 remain unchecked.

> Options considered 2026-10-24: a separate `.lgb` in `Contents/Resources` (Finder passes no arguments and the generated runtime is plain `cli.Main`, so let-go would need new path discovery), the payload linked in by a generated `go:embed` in the `:built` runtime (possible in lgx alone, but duplicates let-go's startup code), and lgx's existing `:target :native`. Native was chosen: let-go `main` already embeds the bytecode with `go:embed`, and the remaining gaps can be closed in lgx.

> Native-build evidence 2026-10-24, let-go `main` `18df3ad5`, lgx 0.5.1. On Linux, `lgx build` with `:target :native` failed: lgx passes every reachable namespace to `lg compile`, and `sql.core/with-transaction` expands to an unresolved `begin-tx` (minimal repro filed as nooga/let-go#1098). Running lgx's `lg compile -module` command by hand with only Quel's 17 namespaces lowered 232 functions and built `bin/quel`. The bridge smoke test passed against that binary run from an unrelated directory without `lgx` (open, query, cancel, paging, structure, profiles, workspace; nREPL and Postgres steps skipped). The frontend was missing (`/assets/*` 404) until a package passed with `-import lgx.local/runtime/lgres` installed an embedded resource provider from `go:embed` in its `init()`. On the user's Apple Silicon Mac, the same manual build with the real frontend, `GOFLAGS=-tags=production` and deployment target 15.0 gave `sign=0` (`codesign --force --sign - --options runtime`) and `verify=0` (`codesign --verify --strict --verbose=2`: valid on disk, satisfies its Designated Requirement). The signed binary, launched from `/tmp` with `QUEL_SECRETS=memory`, rendered the UI, connected a SQLite file, showed the structure tree and ran a query. Not yet covered: Developer ID signing, notarization, the `.app` wrapper, and Keychain access under hardened runtime.

### Task 2: Prepare the supplied icon

**Files:** Create `build/macos/icon-source.png`, `build/macos/icon.png`.

- [x] **Step 1:** Copy the attachment into the source path and verify its SHA-256 against the Design section. If the attachment is unavailable in a future session, ask for it again rather than drawing a replacement.
- [x] **Step 2:** Use `/imagegen` to remove only the exterior pale background with transparent output, preserving the existing mark, navy tile, proportions, and colors. Save a normalized 1024x1024 RGBA master. Keep the source unchanged.
- [x] **Step 3:** Inspect at full size and at 16, 32, 128, and 512 pixels on light/dark backgrounds. Check silhouette, no pale fringe or white plate, and a readable Q tail. Correct an unacceptable edit before proceeding; do not redesign the logo.
- [x] **Step 4:** Commit with `git commit -m "Add Quel's macOS icon"`.

> Done 2026-10-25. The user re-attached the icon; its pixels are identical to the original attachment (0 differing pixels), so `icon-source.png` is the original file, SHA-256 `357ee654…` as in the Design section. Deviation from Step 2: no `/imagegen`. The edit needed is a cut, not a redraw, so a throwaway Go program (outside the repo, `golang.org/x/image/draw`) did it deterministically: the background is every pixel with luminance >= 140 that a flood fill from the image border reaches (the pale backdrop, the drop shadow below the tile, and a 1px white rim on the tile's edge); the tile is the rest, minus its outermost ring (a blend with the rim), with edge colours taken from the pixels just inside. The tile (1057x1063, centred in the source) was scaled as a 1063px square with Catmull-Rom to 824px and centred on a transparent 1024x1024 canvas, Apple's macOS icon grid, so it sits at the size of other Dock icons. Geometry and colours are otherwise untouched. Checked on white, light gray, dark gray and black at 512, 128, 32 and 16 px plus 8x edge crops: no pale fringe (the brightest partly transparent pixel is the tile's own top highlight, `(69,102,148)`), the Q tail stays readable at 32 px and is a hint at 16 px. No drop shadow is baked in; add one only if the Dock rendering on the Mac (Task 3) looks flat beside other apps.

### Task 3: Build and inspect the app bundle

**Files:** Create `VERSION`, `build/macos/Info.plist`, `scripts/package-macos.sh`, `scripts/verify-macos.sh`; modify `lgx.edn`, `.gitignore`.

- [x] **Step 1:** Add version `0.1.0` and the stable metadata described above. Create scripts with `set -euo pipefail`, repo-relative paths, and clear precondition errors. Keep the minimum macOS value consistent across compiler flags, plist, and cask generation.
- [x] **Step 2:** Package only on native macOS ARM64, setting `GOOS=darwin`, `GOARCH=arm64`, `CGO_ENABLED=1`, `MACOSX_DEPLOYMENT_TARGET=15.0`, and matching cgo deployment flags. Preserve the production tag and reject server-mode input. Run the pinned lgx production build, generate all icon sizes with `sips`/`iconutil`, then assemble a fresh `dist/Quel.app` using the proven Task 1 layout. Never mutate a previously signed bundle.

> Note from Task 1: a native build without `MACOSX_DEPLOYMENT_TARGET` makes `ld` warn `object file ... was built for newer 'macOS' version (26.0) than being linked (11.0)`, and the binary claims macOS 11.0. Step 2's environment must make those warnings disappear, and Step 3's deployment-target check should read the binary's `LC_BUILD_VERSION` (`otool -l`), not only the plist.

- [x] **Step 3:** Add `lgx package-macos` and `lgx verify-macos` aliases. Verification checks `plutil -lint`, plist identity/version, `lipo -archs` (exactly arm64), deployment target, and `otool -L` for accidental developer/Homebrew runtime-library dependencies. Ad-hoc sign for development/PR validation; do not present that as distribution signing.
- [x] **Step 4:** Run `lgx package-macos && lgx verify-macos` on the ARM Mac. Copy/unzip to a path containing spaces and launch from outside the repo with isolated data, no runtime on PATH, and no dev variables. Confirm UI, bridge, and SQLite query; the verify script must clean up only its own process and temp directory. A liveness-only automated pass is labeled as such.
- [x] **Step 5:** Commit with `git commit -m "Package Quel as an Apple Silicon macOS app"`.

> Done 2026-10-25 (`d6077e4`). `scripts/macos-common.sh` holds the identity, `MACOS_MIN=15.0` and the VERSION check (stable MAJOR.MINOR.PATCH; `v0.1.0`, `0.1`, `01.2.3`, `1.2.3-rc1` rejected), shared by both scripts; `build/macos/Info.plist` takes `@VERSION@` and `@MACOS_MIN@`. `package-macos.sh` leaves `dist/Quel.app` unsigned; `verify-macos.sh` ad-hoc signs a copy under `Quel check/` in a temp dir, so the release bundle is never signed twice. It also checks the build tags with `go version -m` (production, no server) when `go` is on PATH. On the user's Apple Silicon Mac, `lgx package-macos && lgx verify-macos` passed on the first run: no `built for newer` warnings; Info.plist identity, version 0.1.0, macOS 15.0 and icon; arm64 only; `minos 15.0`; only `/usr/lib` and `/System/Library` linked; tags `production`; the ad-hoc copy verified; launched with `env -i`, a temp `QUEL_DATA_DIR` and `QUEL_SECRETS=memory`, it stayed up and created its database (liveness only). Manual pass: a copy under `Quel Manual/` (a path with a space), ad-hoc signed and opened with `open -n --env`, showed the UI, opened a SQLite file and ran a query; the icon shows in the Dock at the size of its neighbours, so no drop shadow is needed.

### Task 4: Sign and notarize the packaged artifact

**Files:** Create `scripts/sign-macos.sh`; extend `scripts/verify-macos.sh` with `--distribution` checks.

- [x] **Step 1:** Implement signing using the configured identity and temporary notarization keychain profile. Preserve bytecode/resources and use hardened runtime plus timestamp. Detect and sign any nested executables before the enclosing bundle. Keep secret values out of logs.
- [x] **Step 2:** Create the submission ZIP with `ditto -c -k --sequesterRsrc --keepParent`, submit with `notarytool --wait`, check Accepted, retrieve failure logs when rejected without printing secrets, and staple/validate the app. Recreate the final `quel_VERSION_darwin_arm64.zip` after stapling, then write `checksums.txt`.
- [x] **Step 3:** Run `codesign --verify --deep --strict --verbose=2 dist/Quel.app`, `xcrun stapler validate dist/Quel.app`, and `spctl --assess --type execute --verbose=2 dist/Quel.app`. Unzip the actual final archive and repeat distribution verification and isolated launch. Expected: valid Developer ID signature, Accepted notarization, valid ticket, working app.
- [x] **Step 4:** Check missing identity/profile and a rejected notarization terminate without a distributable artifact. Avoid real repeated submissions just to exercise failure plumbing; use a controlled command fixture for error propagation where useful.
- [x] **Step 5:** Commit with `git commit -m "Sign and notarize macOS release archives"`.

> Progress 2026-10-25: `scripts/sign-macos.sh` (`lgx sign-macos`) takes `APPLE_SIGNING_IDENTITY` (must be `Developer ID Application: ...`), `APPLE_NOTARY_PROFILE` (a `notarytool store-credentials` profile) and optional `APPLE_KEYCHAIN` (CI's temporary keychain, passed to `security`, `codesign` and `notarytool`). It removes any earlier archive and `checksums.txt`, checks that the identity and the profile exist before signing, signs a fresh copy of the unsigned `dist/Quel.app` (nested Mach-O files first, none today), submits with `notarytool submit --wait`, prints Apple's log and stops on anything but Accepted, staples, requires `spctl` to report `source=Notarized Developer ID`, and only then moves `quel_VERSION_darwin_arm64.zip` and `checksums.txt` into `dist/`. `verify-macos.sh --distribution` checks the archive against `checksums.txt`, unpacks it under a path with a space, runs the bundle and binary checks, then checks the Developer ID chain, hardened runtime, timestamp, stapled ticket and Gatekeeper, and launches it (liveness only). `scripts/test-release.sh` (`lgx test-release`, runs on Linux) covers Step 4 with stand-ins for `uname`, `security`, `codesign`, `ditto`, `xcrun` and `spctl`: 19 checks for a missing or non-Developer-ID identity, a missing profile, an identity not in the keychain, a rejected profile, a rejected notarization (fails, prints the log, no archive, stale archive removed, nothing stapled), the accepted path, and `APPLE_KEYCHAIN` reaching every tool. Deleting the stale-archive removal makes one check fail, as it should. Task 5 adds the cask tests to the same script. Step 3 waits on the Mac.

> Progress 2026-10-26: on the user's Apple Silicon Mac, with a `notarytool store-credentials` profile in the login keychain and the Developer ID Application identity, `lgx package-macos`, then `lgx sign-macos && lgx verify-macos --distribution` passed. Submission `70e7a78f-08a0-4d04-b25c-9ba38ef708a7` was Accepted, stapling and `stapler validate` worked, and the final `quel_0.1.0_darwin_arm64.zip` has SHA-256 `10aaa61cea50d6d1df5a5ae1440ff3be20d832bb73ba7c99a45ff71526ef2a20`. The distribution check, run on the unpacked final archive, passed: checksum, plist, arm64 only, minos 15.0, system-only libraries, `production` tags, Developer ID signature with hardened runtime and timestamp, stapled ticket, Gatekeeper `Notarized Developer ID`, and an isolated launch. Manually, the archive was unpacked into `~/Downloads/Quel test`, given a quarantine attribute and opened with `QUEL_SECRETS=memory` and a temporary `QUEL_DATA_DIR`. macOS showed the "downloaded from the Internet" prompt (not the unidentified-developer block), and the UI loaded and ran a SQLite query.

### Task 5: Generate and validate the Homebrew cask

**Files:** Create `scripts/generate-cask.sh`, `scripts/test-release.sh`.

- [x] **Step 1:** Implement `bash scripts/generate-cask.sh VERSION CHECKSUMS_FILE` to emit the cask on stdout. Require one exact archive-name match and a single 64-digit hexadecimal checksum, and reject malformed/unsupported versions. Emit the app name, description, homepage, exact asset URL, ARM64 and macOS constraints, and app installation stanza.
- [x] **Step 2:** Add focused temporary-fixture tests for a valid checksum, absent archive, duplicate archive entry, malformed hash, and invalid version. Verify the generated URL and version correspond to the input; do not snapshot incidental formatting. Run `bash scripts/test-release.sh`; expect PASS and nonzero status for invalid inputs.
- [x] **Step 3:** Run `bash -n scripts/package-macos.sh scripts/verify-macos.sh scripts/sign-macos.sh scripts/generate-cask.sh scripts/test-release.sh`. Check generated cask syntax with `ruby -c`; run `brew style --cask` in a temporary local test tap on macOS. Online artifact audit waits until the release URL exists.
- [x] **Step 4:** Commit with `git commit -m "Generate the Quel Homebrew cask from release checksums"`.

> Done 2026-10-26. `scripts/generate-cask.sh VERSION CHECKSUMS_FILE` checks the version with the same stable-version rule as `VERSION` (`valid_version` in `macos-common.sh`), takes the one `checksums.txt` line whose file name is exactly `quel_VERSION_darwin_arm64.zip`, requires a lowercase 64-digit hex SHA-256, and prints a cask with `version`, `sha256`, the release asset `url` (through `#{version}`), `name`, `desc`, `homepage`, a `livecheck` skip, `depends_on arch: :arm64`, `depends_on macos: ">= :sequoia"` (derived from `MACOS_MIN`) and `app "Quel.app"`. It has no `zap` and no quarantine handling. `scripts/test-release.sh` gained 18 checks: the valid case (version, the right archive's checksum among other versions, the URL with `#{version}` expanded, the arch and macOS constraints, the app stanza), an absent archive, a duplicate entry, four malformed hashes (63 and 65 digits, uppercase, non-hex), five invalid versions (`v1.2.3`, `1.2`, `1.2.3-rc1`, `01.2.3`, empty) and a missing file. Removing the duplicate and hash checks makes 5 of them fail. `bash -n` passes on all five scripts. On the Accepted 0.1.0 checksum, `ruby -c` gave Syntax OK (`ruby:3.3-slim` in Docker), and `brew style --cask` in a temporary local tap reported no offenses. Deviation: `brew style` ran in Homebrew's Linux image (`homebrew/brew`), not on macOS; it is the same RuboCop configuration. The online `brew audit` waits for the release URL (Task 7).

### Task 6: Wire checks, tag releases, and the shared tap

**Files:** Modify `.github/workflows/ci.yml`; create `.github/workflows/release.yml`.

- [x] **Step 1:** Make CI reusable with `workflow_call`; keep existing push/PR triggers. Ensure concurrency groups distinguish direct CI from release-invoked checks so jobs do not cancel or deadlock each other. Add the release script tests to Linux checks and the native secret-free package/ad-hoc validation job on `macos-15`.
- [x] **Step 2:** Add the `v*` release trigger and an exact stable-version/tag gate. Reuse CI on the tagged SHA. Build and sign on ARM macOS, checking the runner architecture. Use dependency caches keyed by OS, architecture, pinned versions, build mode, and dependency files. Never cache the signing keychain or secret files.
- [x] **Step 3:** Implement temporary keychain import, partition-list access for `codesign`, and a named notary profile. Register unconditional cleanup early, remove temporary P12/profile files, restore the original keychain search list, and delete the temporary keychain even on failure.
- [x] **Step 4:** Publish a draft GitHub Release only after artifact checks, upload ZIP/checksum and generated notes, then publish. Existing published assets are immutable; rerunning a successful publication must not silently replace them. Preserve a recovery path that retries only the failed tap job against the existing release.
- [x] **Step 5:** Update only `Casks/quel.rb` in the shared tap from published checksums. Use the existing token convention with credential-safe checkout, no token in printed commands or persistent remote URLs. Skip unchanged files; reject version rollback; handle concurrent updates with bounded rebase/reapply retries. Do not force-push.
- [x] **Step 6:** Validate workflow syntax with `actionlint` and inspect all job permissions/dependencies. Verify a normal PR can run without release secrets and cannot publish. Exercise tag mismatch and unavailable-secret failures without creating a real release. If CI is used for an experiment, use a nonpublishing workflow invocation, not a throwaway public tag.
- [x] **Step 7:** Commit with `git commit -m "Publish signed macOS releases and update the Homebrew tap"`.

> Progress 2026-10-26. `ci.yml` gains `workflow_call`, `contents: read`, a concurrency group of `ci-<calling workflow>-<ref>` that cancels only direct CI runs, `lgx test-release` in the Linux job, cache keys with OS, architecture, build mode and `.mise.toml`, and a secret-free `macos` job on `macos-15`: `.github/actions/package-macos` (arm64 check, `sw_vers` and `xcodebuild -version` in the log, mise, cache, `lgx package-macos`), then `lgx verify-macos`. `release.yml` runs on `v*` tags and on `workflow_dispatch` as a rehearsal that signs, notarizes, verifies and uploads a workflow artifact but never publishes or touches the tap. Concurrency is one `release` group, never cancelled. Its top-level permissions are empty; only `publish` has `contents: write`. The jobs:
>
> - `gate`: `scripts/release-version.sh` checks that the tag is exactly `v` plus VERSION. It checks that every secret is set without reading any value, and treats a tag whose release is already published as tap-only.
> - `ci`: the reusable CI on the tagged commit.
> - `build` (`macos-15`): `scripts/ci-sign-macos.sh` makes a temporary keychain in `RUNNER_TEMP`, imports the `.p12`, sets the partition list, puts the keychain first in the search list and stores the `quel-ci` notary profile. It runs `sign-macos.sh` with `APPLE_KEYCHAIN`, then restores the search list and deletes the keychain and temp files in an `EXIT` trap, also on failure. Then `lgx verify-macos --distribution` and the artifact upload.
> - `publish`: `scripts/publish-release.sh` creates a draft or resumes one, uploads, checks that the release holds exactly the archive and `checksums.txt`, downloads them back and checks them, and then publishes. It refuses a published release.
> - `tap`: checks out the tap with `HOMEBREW_TAP_TOKEN` through `actions/checkout`, so the token stays out of URLs and commands. `scripts/update-tap.sh` stages only `Casks/quel.rb`, skips an unchanged cask, refuses to replace a newer Quel, and retries a rejected push up to 5 times from the latest tap head without force. "Re-run failed jobs", or a rerun of the workflow on a published tag, retries only the tap.
>
> Local evidence:
>
> - `lgx test-release`: 80 checks pass. They cover the scripts above with stand-ins for `security`, `xcrun` and `gh`, and a real bare git repository as the tap: a pre-receive hook simulates a race, and a stale clone a newer Quel landing mid-job.
> - Mutations caught: removing the cleanup trap (3 failures), allowing a published release (1), the rollback check (2), the per-attempt refresh (2).
> - `actionlint` 1.7.12 with shellcheck finds no errors in either workflow. Shellcheck on the scripts reports only unused-variable false positives (variables used by sourced scripts and in eval'd checks).
>
> Not yet verified on GitHub: the PR run of both CI jobs (the `macos` job's GUI launch on a hosted runner included) and a release rehearsal. `workflow_dispatch` needs `release.yml` on the default branch. The intermediate certificate: if the runner lacks the Developer ID intermediate, `sign-macos.sh`'s preflight fails with "no signing identity" before signing, and the fix is to import Apple's Developer ID G2 CA into the temporary keychain. `docs/RELEASE.md`, referenced by the gate's error message, is Task 7.

> Done 2026-10-27. The PR (#10, squash-merged as `289c1ac`) ran both CI jobs without release secrets; the `macos` job built, checked and launched the app on the hosted runner. After the user set the seven secrets, a rehearsal (`workflow_dispatch` on `master`, run 40418842023) passed:
>
> - Runner: macOS 15.7.9, Xcode 16.4.
> - `gate`: VERSION 0.1.0 and all secrets present.
> - `ci`: both jobs passed (`test` and `macos`).
> - `build`: certificate imported (the runner already trusts the Developer ID intermediate), notary profile stored, submission `b2347642-9cd5-492d-a2df-c10636587d2d` Accepted, stapled. The zip's SHA-256 is `292b566ae8c1c8de7fef5a54c61bc069d58f8e1960685891b6ff667328baac79`. `verify-macos --distribution` passed every check, including Gatekeeper `Notarized Developer ID` and the launch.
> - `publish` and `tap`: skipped, as a rehearsal should.
>
> The artifact `quel-0.1.0` was kept. The tag-mismatch and missing-secret failures are covered by `lgx test-release` and the gate's checks, not by a live failing run. The annotations warn that `actions/checkout@v4`, `actions/cache@v4`, `actions/upload-artifact@v4` and `jdx/mise-action@v3` target the deprecated Node 20 and are forced onto Node 24; they still work.

### Task 7: Document, review, and prepare the first release

**Files:** Create `docs/RELEASE.md`; modify `README.md`, `docs/DESIGN.md`, and this plan.

- [x] **Step 1:** Document installation/upgrade, macOS 15+/Apple Silicon scope, ZIP download, preserved user data, stable bundle ID, required private CI setup, version bump and annotated tag commands, notarization diagnostics, and tap-job retry. Use `git tag -a v0.1.0 -m "Quel 0.1.0"` and `git push origin v0.1.0` as the explicit first-release example. Do not add a helper that pushes all repository tags.
- [x] **Step 2:** Update DESIGN's earlier signing/distribution deferral, packaging claim, and upstream dependency status accurately. Keep Redshift unverified until real-cluster testing occurs. Document how to reproduce native validation separately from server-mode tests.
> Steps 1-2 progress 2026-10-27 (branch `macos-release-docs`):
>
> - `docs/RELEASE.md`: one-time setup (the seven secrets, the `.p12` export and upload, a separate CI app-specific password, renewals), cutting a release with `git tag -a v0.1.0 -m "Quel 0.1.0"` and `git push origin v0.1.0` (never `--tags`), what each job does, a rehearsal, what to do when each job fails (notarization logs, draft resume, tap-only retry), signing on a Mac, and what users keep across versions.
> - README: an Install section (cask, zip, macOS 15+ on Apple Silicon, upgrades and uninstall keep data) and the packaging commands in Build.
> - DESIGN: a Releases section; native app checks under Testing; signed releases removed from milestone 5; the Distribution open question removed; the Keychain-under-hardened-runtime check added to Unverified for the first release. Redshift stays unverified.
> - AGENTS.md: points to RELEASE.md and forbids `git push --tags`.

> Step 3 progress 2026-10-27: `/code-review` of `cab78d0..b2f23ef` found nothing blocking. The rehearsal artifact unpacks flat (`quel_0.1.0_darwin_arm64.zip`, `checksums.txt`) as `publish-release.sh` expects, and its checksum verifies.
>
> - Fixed both Should-fix findings. Actions moved off Node 20: `checkout@v7`, `cache@v6`, `upload-artifact@v7`, `download-artifact@v8`, `mise-action@v5`; their breaking changes (checkout's separate credentials file, download's digest check and non-zip handling, mise's 24 h release age) do not affect this use. RELEASE.md now says to push one release tag at a time, because GitHub keeps one waiting run per concurrency group.
> - Of the nits, the argument-passed secrets in `ci-sign-macos.sh` now have a comment. The README's Install section waits on the first release, so merge right before tagging. A tag ruleset restricting `v*` to `master` is left to the user.
> - The README was rewritten for users (icon, features, install, update, uninstall, data, status), and the developer notes moved to `docs/DEVELOPMENT.md`.
>
> `actionlint` and `lgx test-release` pass. The upgraded workflows still need a CI run and a rehearsal on GitHub.
>
> Step 3 result 2026-10-27:
>
> - The review fixes merged as `2409db5` (#12). Its rehearsal, run 40422942776, failed in `verify-macos --distribution`. Apple accepted the submission, and the ticket stapled and validated in `sign-macos`. Seconds later, `stapler validate` rejected the app unpacked from the zip. The check discarded stapler's output, so the cause was not recorded. Apple's forum answers attribute intermittent stapler failures to the network.
> - `9b1fc7f` (#13) adds `stapler_retry`: up to 3 attempts, 15 s apart, printing stapler's verbose output after each failure, used by both scripts. `lgx test-release` gained 4 checks (84 pass), and a mutation to a single attempt fails 3 of them.
> - Rehearsal run 40554022877 on `9b1fc7f` passed: gate, CI (test and macos), and build. Submission 4821276a-de45-43d0-ad7e-fde3b12b657d was Accepted. stapler succeeded on the first attempt, so the retry path is still unexercised on GitHub. The zip's sha256 is `af303a4a831ca86f9bfd7abf9b1f9b3a72dd67e511d53dbd16a300eeef216264`. All distribution checks passed, including Gatekeeper ("Notarized Developer ID") and the launch. Publish and tap were skipped, as a rehearsal should.
> - Not yet checked on GitHub: the publish and tap jobs, which only run on a tag push. `lgx test-release` covers them with stand-ins.
>
> Step 4: the docs were squash-merged as `2409db5` (#12), not as a separate "Document macOS installation and release setup" commit. The six Apple secrets are set and work: the rehearsal's gate checked them, and the build signed and notarized with them. A rehearsal does not check `HOMEBREW_TAP_TOKEN`. The gate checks it on a tag push, and only the tap job uses it.

- [x] **Step 3:** Run `/code-review` on the final implementation. Run existing Linux CI checks and the new native/distribution checks on the appropriate hosts. Record unavailable checks rather than treating them as passes. Link any created PR to the current T3 thread.
- [x] **Step 4:** Commit with `git commit -m "Document macOS installation and release setup"`. Present the implementation, verification evidence, exact credentials still missing, and the concrete first-release action. Do not push a release tag without live-release authorization.
- [ ] **Step 5:** Once explicitly authorized, push the version tag, inspect the resulting workflow, then install the actual cask with `brew install --cask abogoyavlensky/tap/quel`. Run the first-release native acceptance checks in the Design section. Record release URL, checksum, and tap commit; update status to completed only after the agreed release scope is achieved.

## Plan review

Codex approved the plan on 2026-10-24 with no blocking issues. Its task-ordering clarification was incorporated: the signing experiment uses a disposable minimal app bundle before the permanent packaging scripts exist. Approval starts the prerequisite experiment; a necessary upstream packaging redesign remains a separately reviewed dependency.

## References checked during planning

- Wails beta.30 [macOS task definitions](https://github.com/wailsapp/wails/blob/v3.0.0-beta.30/v3/internal/commands/build_assets/darwin/Taskfile.yml) and [signing implementation](https://github.com/wailsapp/wails/blob/v3.0.0-beta.30/v3/internal/commands/sign.go).
- let-go v1.13.0 [bundle trailer reader](https://github.com/nooga/let-go/blob/v1.13.0/pkg/bundle/bundle.go#L62).
- Apple [code signing and executable layout](https://developer.apple.com/library/archive/technotes/tn2206/), [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), and [app icons](https://developer.apple.com/design/human-interface-guidelines/app-icons).
- Homebrew [cask cookbook](https://docs.brew.sh/Cask-Cookbook) and [security model](https://github.com/Homebrew/brew/blob/main/docs/Homebrew-Security-and-Supply-Chain.md).
- GitHub [hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
