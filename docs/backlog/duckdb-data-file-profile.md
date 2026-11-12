# Open a CSV, JSON or Parquet file as a DuckDB profile

**Status: open**

## Problem

A DuckDB scratch profile (`:memory:`) can query a file in place, with
`from '/path/data.csv'`, and its first tab and the profile dialog say so.
But a file queried that way is not in the catalog. The structure tree shows
an empty `main`, column completion offers nothing, and the path has to be
typed into every statement. Choosing a `.csv` as the profile's file fails
at Test: DuckDB tries to open it as a database ("not a valid DuckDB
database").

## Fix

Let a DuckDB profile's path be a data file (`.csv`, `.tsv`, `.json`,
`.parquet`). On connect, `quel.conn` opens an in-memory DuckDB and creates
a view over the file, for example `create view cities as from
read_csv_auto('/path/cities.csv')`. What exists already does the rest:

- The view shows in the tree under Views, with its columns, and completion
  knows it: `duckdb_columns()` lists view columns.
- One pool shares one in-memory instance, so every tab sees the view.
- A view re-reads the file on every query, so the data stays live and a
  big file is not loaded up front. Nothing can be written through it.

To settle:

- The view name: the file name without its extension, quoted when it is
  not a plain identifier (`"Sales Report (2024)"`). A `'` in the path is
  escaped inside the SQL literal.
- DuckDB guesses column types from a sample of the file, so a messy CSV
  can fail on a later row at query time, not at Test.
- Whether a profile can also name a folder, with one view per file (needs
  names for clashes and a way to refresh).
- File chooser filters for the data files, and a suggested name.
- Later: an "Open File…" menu item that makes such a profile and opens a
  tab with `from <view> limit 100`. That is quicker for a one-off look, but
  tabs and workspaces are keyed by profile id, so it needs a profile
  behind it.

Discussed 2026-11-12 after the DuckDB engine landed
(`docs/plans/2026-11-10-2200-duckdb-engine.md`).
