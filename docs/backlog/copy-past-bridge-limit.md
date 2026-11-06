# Copy fails for a result over 64 MiB

**Status: open**

## Problem

Saving a result sends it in chunks, because Wails caps one runtime call at
64 MiB. Copying does not. `copyText` (`frontend/src/lib/clipboard.ts`) tries
`navigator.clipboard` and falls back to Wails' `Clipboard.SetText`, a runtime
call under the same cap. A native webview that refuses `navigator.clipboard`
then shows "Couldn't copy to the clipboard." for a result over 64 MiB.

Save works for those results, and a clipboard is a poor place for that much
text, so it is a small gap.

## Proposed fix

Say so in the toast when the text is over the cap ("Too large to copy: use
Save"), rather than try to carry it.

## Origin

Left out of `docs/plans/2026-11-04-2239-large-result-export.md` ("Out of
scope"), 2026-11-04.
