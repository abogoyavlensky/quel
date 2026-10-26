# Releasing Quel

A release is a signed and notarized `Quel.app` for Apple Silicon Macs
running macOS 15 or newer, published as `quel_VERSION_darwin_arm64.zip`
with a `checksums.txt` on a GitHub Release, and installed with:

```sh
brew install --cask abogoyavlensky/tap/quel
```

Pushing a `v*` tag does all of it in `.github/workflows/release.yml`. Your
part is the one-time setup below and, for each release, a version bump
and a tag.

## One-time setup

The workflow reads seven repository secrets (Settings → Secrets and
variables → Actions, or `gh secret set NAME -R abogoyavlensky/quel`, which
prompts for the value). Never paste their values anywhere else.

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` | the Developer ID Application certificate and its private key, exported as `.p12` and base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | the password set on that `.p12` export |
| `APPLE_SIGNING_IDENTITY` | the identity's full name, `Developer ID Application: Name (TEAMID)` |
| `APPLE_TEAM_ID` | the 10-character team ID (the `TEAMID` above) |
| `APPLE_ID` | the Apple ID email that notarizes |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password of that Apple ID, used only by CI |
| `HOMEBREW_TAP_TOKEN` | a fine-grained token with Contents read and write on `abogoyavlensky/homebrew-tap` only |

**The certificate.** It is the Developer ID Application certificate in your
login keychain (Xcode → Settings → Accounts → Manage Certificates creates
one). In Keychain Access → login → My Certificates, check that a private key
sits under it, then right-click → Export as `.p12` with a strong password.
Upload it without printing it:

```sh
base64 -i DeveloperID.p12 | gh secret set APPLE_CERTIFICATE_P12_BASE64 -R abogoyavlensky/quel
```

Keep the `.p12` and its password in a password manager as the backup, and
delete the file from disk. The identity name and team ID come from:

```sh
security find-identity -v -p codesigning
```

**The app-specific password.** Create it at account.apple.com → Sign-In
and Security → App-Specific Passwords. A separate one for CI means revoking
your laptop's does not break releases.

**Renewals.** The certificate is valid for five years. Apple revokes every
app-specific password when the Apple ID password changes. Either event
means replacing the matching secrets; nothing else changes.

## Cutting a release

1. Bump `VERSION` (stable `MAJOR.MINOR.PATCH` only) in a PR and merge it.
2. Tag the merge commit on `master` and push only that tag:

   ```sh
   git switch master && git pull
   git tag -a v0.1.0 -m "Quel 0.1.0"
   git push origin v0.1.0
   ```

   Do not use `git push --tags`: every tag it pushes that matches `v*`
   starts a release.
3. Watch the run: `gh run watch -R abogoyavlensky/quel`. When it is green,
   the release is on GitHub and `Casks/quel.rb` in the tap names the new
   version.

The jobs, in order:

- **gate** checks that the tag is exactly `v` plus `VERSION` and that every
  secret is set (only whether each is set; no value reaches it). If the
  tag's release is already published, it skips straight to **tap**.
- **ci** is the normal CI on the tagged commit.
- **build** runs on `macos-15` (Apple Silicon). It packages the app, imports
  the certificate into a temporary keychain, signs with hardened runtime and
  a timestamp, notarizes, staples, and runs
  `lgx verify-macos --distribution` on the final zip. The keychain is
  deleted at the end, also when a step fails.
- **publish** uploads the zip and `checksums.txt` to a draft release,
  downloads them back and checks them, and only then publishes.
- **tap** writes `Casks/quel.rb` in the tap and pushes it, touching nothing
  else there.

### A rehearsal

Run the workflow by hand to sign, notarize and check a build without
publishing anything. The zip is kept as a workflow artifact for 14 days:

```sh
gh workflow run release.yml -R abogoyavlensky/quel --ref master
gh run download -R abogoyavlensky/quel RUN_ID      # the zip and checksums.txt
```

It skips **publish** and **tap**, whatever the branch.

## When a release fails

Read the failed job's log; each step names what it checked.

- **gate: "tag ... does not match VERSION".** Nothing was built. Delete the
  tag (`git push origin :refs/tags/vX.Y.Z` and `git tag -d vX.Y.Z`), fix
  `VERSION` or the tag, and tag again.
- **gate: "missing repository secrets".** Set the named secrets, then rerun
  the workflow.
- **build: "could not import the certificate".** The `.p12` or its
  password is wrong. Export again and update both secrets.
- **build: "no signing identity".** The imported certificate is not a
  valid Developer ID Application identity on the runner: check
  `APPLE_SIGNING_IDENTITY` against `security find-identity`, and that the
  `.p12` includes the private key.
- **build: "could not store the notary credentials".** `APPLE_ID`,
  `APPLE_TEAM_ID` or `APPLE_APP_SPECIFIC_PASSWORD` is wrong, or the
  password was revoked.
- **build: "notarization was not accepted".** The log below that line is
  Apple's, listing each problem with the file it is in. The same log is
  available later with
  `xcrun notarytool log SUBMISSION_ID --keychain-profile quel-notary` on a
  Mac set up as in [Signing on a Mac](#signing-on-a-mac).
- **publish failed.** Use "Re-run failed jobs": it takes the signed zip
  from the same run's **build** and resumes the draft release. A published
  release is never changed; if one is wrong, release a new version.
- **tap failed.** Use "Re-run failed jobs" on the run, or rerun the
  workflow: with the release published, the gate sends it straight to the
  tap update. The job refuses to replace a newer Quel in the tap with an
  older one, and retries a push that another project's release beat.

## Signing on a Mac

The same scripts run locally, which helps to diagnose signing or
notarization without a tag. Once, store the notarization credentials in
your login keychain (it prompts for the app-specific password):

```sh
xcrun notarytool store-credentials quel-notary --apple-id YOUR_APPLE_ID --team-id YOUR_TEAM_ID
```

Then:

```sh
lgx fe-install
lgx package-macos        # dist/Quel.app, unsigned
lgx verify-macos         # checks it and launches an ad-hoc signed copy
export APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)"
export APPLE_NOTARY_PROFILE=quel-notary
lgx sign-macos           # one real submission to Apple
lgx verify-macos --distribution
```

`lgx test-release` runs the release scripts against stand-ins for Apple's
tools, `gh` and the tap, on any machine.

## What users keep across versions

Profiles and saved tabs live in `~/Library/Application Support/Quel`, and
passwords in the Keychain under the service `Quel`. An upgrade replaces only
`Quel.app`, and the bundle ID stays `io.github.abogoyavlensky.quel`, so
macOS treats every version as the same app. The cask has no `zap` stanza:
`brew uninstall --cask quel` removes the app and leaves the data. Deleting
that folder and the Keychain items is up to the user.
