# Exports stop at 100,000 rows

**Status: open**

## Problem

The Export popover (`frontend/src/components/ExportMenu.tsx`) formats the
rows the grid holds, and the grid holds at most `MAX_ROWS` = 100,000
(`frontend/src/state/runner.ts`). `exportResult` loads an `open` result to
that cap first, then exports it. A result with more rows goes out cut at
100,000, and the toast says "the first 100,000 rows"; nothing in the file
itself says it is partial.

It takes a query returning more than 100,000 rows to hit it, and then the
user is told. Results under the cap export whole.

## Proposed fix

Export in the backend, off the open cursor, so the frontend never holds the
rows. A handler would stream a result into the file chosen in the save
dialog (`quel.export`, next to `filters` and `write!`): either read the rest
of the open cursor, or rerun the statement on a fresh session when the
cursor is closed or capped. It needs the format code on the let-go side
too, or the frontend formatters fed in batches, so `grid/export.ts` rules
(CSV quoting, raw JSON cells, Markdown escapes) must stay in one place or be
ported with the same tests. Progress and cancel need a UI of their own.

Notes: rerunning is wrong for a statement with side effects or one that is
not repeatable, so only a read statement may do it. Server mode has no save
dialog, so streaming there would be a download from an HTTP endpoint.

Size: a new handler, a writer per format and a progress UI; larger than the
current export.

## Origin

Left out of `docs/plans/2026-10-31-2156-result-export.md` ("Out of scope"),
2026-10-31.
