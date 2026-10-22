# The editor cannot show that a tab's session is inside a transaction

**Status: open**

## Problem

`docs/DESIGN.md` promises that the editor shows when a tab's session is
inside an open transaction, and that closing such a tab asks first. Quel
cannot tell today. The state lives in the driver: pgx's
`PgConn().TxStatus()` (`'I'` idle, `'T'` in a transaction, `'E'` in a
failed one) and SQLite's `sqlite3_get_autocommit`. Neither is reachable
from let-go through `database/sql`'s `*sql.Conn`, and parsing the user's
`BEGIN`/`COMMIT` misses `ROLLBACK TO`, errors that abort a transaction,
and procedures that commit.

Closing such a tab today closes its connection (sessions come from a pool
with no idle connections), which rolls the transaction back without
asking.

## Fix

Upstream, in letgo-packages `sql`: a shim function that reads the
transaction state of a `*sql.Conn` through `Conn.Raw`, asking the driver
connection for it. pgx's stdlib conn exposes `Conn().PgConn().TxStatus()`;
for modernc, `sqlite3_get_autocommit` needs its own driver hook or a
`select` the shim can run (SQLite has no SQL for it, so it is the hook).
A per-driver function in the `postgres` and `sqlite` packages' shims may
fit better than one in `sql`.

Then in Quel: `run` and `fetch-page` replies carry `:in-transaction`;
the editor tab shows it (a marker on the tab), and closing such a tab
asks to commit, roll back or cancel.

Size: a shim function per driver, tests and a release round; a few lines
of backend and a small UI change in Quel.

## Origin

Planned out of the query loop's scope
(`docs/plans/2026-10-22-0833-query-loop.md`, Task 15), 2026-10-22.
