# Binary values show as "(binary)" instead of a preview

**Status: open**

## Problem

`sql.shim/ScanRow` (letgo-packages `sql`) turns every `[]byte` it scans into
a let-go string. That suits SQLite's TEXT, which modernc returns as bytes,
but it destroys binary data: Postgres `'\xdeadbeef'::bytea` arrives as a
3-character string, two of them U+FFFD. Nothing is left to preview, so
`quel.cells/encode` shows every `BYTEA` cell as `"(binary)"`
(`src/quel/cells.lg`). DESIGN's cell encoding promises a truncated hex
preview.

SQLite BLOBs have the same problem but are not caught: their column type
is `BLOB`, and they still show as whatever text the bytes decode to.

## Fix

Upstream, in letgo-packages `sql`: keep binary values as bytes. Either
`ScanRow` returns `[]byte` boxed as a let-go byte value for columns whose
scan type is `[]byte` and whose database type is binary (`BYTEA`, `BLOB`),
or a new `ScanRowRaw` returns them untouched and lets the caller decide.
Both need the column types, which `ColumnTypeNames` already exposes.

Then in Quel: `quel.cells/encode` renders binary values as a truncated hex
preview (`\xdeadbeef…`, first 32 bytes) plus the length, for `BYTEA` and
`BLOB` columns, and drops the placeholder.

Size: a shim change, tests and a release round for `sql` (every driver
package re-pinned); a few lines in Quel.

## Origin

Found while exploring Postgres value types for
`docs/plans/2026-10-21-2331-postgres-connections.md`, 2026-10-21.
