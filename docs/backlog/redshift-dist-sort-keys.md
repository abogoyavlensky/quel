# Redshift tables show no dist or sort keys in the structure tree

**Status: open**

## Problem

On Postgres and SQLite an open table lists its indexes. Redshift has no
indexes; what plays their part is the table's dist style, dist key and
sort keys, and the structure tree shows none of them. `docs/DESIGN.md`
(Introspection) plans a "Dist / sort keys" section where other engines
show "Indexes".

## Proposed fix

A Redshift-only section under a table, in a new `quel.meta.redshift`:
the dist key and sort key order from `pg_attribute.attisdistkey` and
`attsortkeyord`, and the dist style from `pg_class.reldiststyle` or
`svv_table_info` (join it, never drive from it: it omits empty tables).
Avoid `pg_table_def`, which lists only schemas on the `search_path`.

These columns exist only on Redshift, so the Postgres tests in Docker
cannot run the queries. Check them against a real cluster, as a
non-superuser, before shipping.

Size: one or two queries, a section in `describe-object`'s reply, and
its rows in the tree.

## Origin

Left out of the structure-details plan (indexes, keys, functions and
types in the tree), 2026-11-02: Redshift can only be checked against a
real cluster.
