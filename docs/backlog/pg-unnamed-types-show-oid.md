# Postgres and Redshift types pgx cannot name show as an OID

**Status: open**

## Problem

pgx names only the types in its type map. For any other type,
`ColumnTypeDatabaseTypeName` returns the type's OID as a decimal string,
and `quel.exec/run-rows` passes it on. The result grid's header and the
row details panel then show a number for Postgres enums, domains,
composite and extension types (`citext`, `hstore`), and for Redshift
types other than `SUPER` (`GEOMETRY`, `VARBYTE`, `HLLSKETCH`). Anything
that decides by type name misses them. `SUPER` alone is mapped by hand
in `quel.cells/type-names`.

## Proposed fix

When a result has a type name made only of digits, look the OIDs up in
`pg_type` (`select oid, typname from pg_type where oid = any(...)`) on
the same connection, and cache the answers per connection. Upper-case
the name, as pgx does.

The costs: one more query the first time a type appears. It runs on the
user's session, so it must not change that session's state inside their
transaction (a failed lookup must not abort it), and it must be
cancellable with the run. Check on a real Redshift cluster that
`pg_type` lists its own types. Once this lands, the static map can go.

## Origin

Found 2026-11-11 while fixing unformatted JSON in a Redshift `SUPER`
column; the static map was chosen as the small fix.
