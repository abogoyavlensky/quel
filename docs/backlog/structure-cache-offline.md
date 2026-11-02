# The structure tree is empty until a profile connects

**Status: open**

## Problem

The structure tree and the editor's completion live in TanStack Query's
memory, keyed by the connection's id (`frontend/src/lib/query.ts`). A
disconnect drops them, and after a launch the selected profile shows
"Not connected." with nothing to browse until it connects. A database
that is out of reach (no VPN, a paused Redshift cluster) cannot be
browsed at all, and a slow catalog (`completion-schema` on a large
Redshift cluster) is read again every session.

## Proposed fix

Keep what the tree and completion loaded in the app database, one row
per reply:
`meta_cache (profile_id references profiles on delete cascade, key,
value, fetched_at)`, where `key` is the call and its arguments
(`["schema","public"]`, `["object","public","orders"]`, completion) and
`value` its JSON reply.

- Connected: each successful metadata call also writes its reply.
- Disconnected: the tree and completion read the cache by profile id; a
  node never loaded shows "Connect to load".
- Refresh deletes the profile's rows and reads again.
- Saving a profile with a new host, port, database or file path drops
  its cache; a new name or color keeps it.
- On connect, reload what is on screen (schemas, open schemas, open
  objects) in the background, but not completion, the one expensive
  read. With the cache, "nothing refreshes until the button" would let
  the tree be weeks out of date; reloading on connect keeps it to the
  gap before connecting. Show the cache's age by the refresh button.

Schema and table names land in the app database in plain text, which
already holds query text.

Size: a migration, a cache namespace, a read path per handler, a tree
state for "not loaded", tests. About the size of saved tabs.

## Why it is left alone

Discussed on 2026-11-02 and skipped for now. It pays off only for
databases that are out of reach or slow to introspect; SQLite and local
Postgres connect in a moment. If the wish is just to see the structure
right after launch, connecting the selected profile on launch (a
per-profile setting, so production stays manual) is cheaper and needs no
cache.

## Origin

A discussion on 2026-11-02, while planning indexes, keys, functions and
types in the structure tree.
