# Temp tables and attached databases from a tab do not show in the structure tree

**Status: open**

## Problem

The structure tree and completion read the database's shared pool, never
a tab's session, so browsing never waits behind a running query. Objects
that exist in one connection only are therefore invisible: temp tables
(Postgres `pg_temp_*`, SQLite `temp`) and SQLite databases `ATTACH`ed in
a tab. The tree also leaves SQLite's `temp` schema out, since the pool's
is not any tab's.

## Fix

Either read the active tab's session for its temp schema while the tab
is idle (no query running, no open cursor), or list the session's temp
objects as a separate tree section fed by the tab. Both need
`quel.exec` to say when a session is free, and the cache key to include
the session.

Size: a backend call that borrows an idle session, and a tree section.

## Origin

A known limit of `docs/plans/2026-10-23-2224-structure-tree.md`,
2026-10-24.
