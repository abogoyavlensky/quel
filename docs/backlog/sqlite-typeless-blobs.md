# SQLite blobs in columns with no declared type show as decoded text

**Status: open**

## Problem

`quel.cells/encode` turns a value into hex when its column type is `BYTEA`
or `BLOB` (`src/quel/cells.lg`). SQLite columns made without a declared
type, and expressions, report the type `""`:

```sql
select x'dead';
select randomblob(4);
create table t (x); insert into t values (x'dead');
```

modernc returns the blob as `[]byte`, which let-go boxes as a string with
the same bytes. After boxing, a blob cannot be told from text, so these
values are shown (and exported) as decoded text, with replacement
characters for invalid UTF-8, instead of `\xdead`.

A column declared `BLOB` works, and so does `BYTEA` on Postgres and
Redshift. Only typeless SQLite columns are missed; text in them is correct.

## Why it is left alone

Deciding by content, for example "hex-encode any string that is not valid
UTF-8", would catch most blobs but not a blob that happens to be valid
UTF-8, and it would make the same column show some cells as text and
others as hex. The reliable fix is to learn the value's SQLite storage
class: `select typeof(x)` per cell is not possible for arbitrary queries,
so it needs the driver to hand over blobs distinctly, either in the `sql`
shim's `ScanRow` (a boxed byte value instead of a string) or by reading the
scan type from `ColumnTypes`. That is an upstream change in letgo-packages
`sql`, and it is worth doing only if typeless blobs turn out to matter.

## Origin

Found while checking the bytea backlog entry
(`docs/backlog/bytea-preview.md`) for
`docs/plans/2026-10-31-2156-result-export.md`, 2026-10-31.
