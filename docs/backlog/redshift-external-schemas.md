# Redshift external schemas and datashares are missing from the structure tree

**Status: open**

## Problem

The structure tree and the editor's completion read Redshift through
`pg_catalog` (`quel.meta.postgres`), as Postgres. `pg_class` does not
list external (Spectrum) tables or datashare objects, so their schemas
show empty or not at all, and nothing in them completes.

## Fix

Add Redshift-only queries, in a new `quel.meta.redshift`: external schemas
and tables from `svv_external_schemas`, `svv_external_tables` and
`svv_external_columns`, or switch Redshift to `svv_all_schemas`,
`svv_all_tables` and `svv_all_columns` as `docs/DESIGN.md` first planned.
Check either against a real cluster, as a non-superuser, before shipping:
the Postgres tests cannot run these views.

Size: three queries and their tests against Redshift; nothing in the
frontend.

## Origin

Left out of `docs/plans/2026-10-23-2224-structure-tree.md`, 2026-10-24:
Redshift can only be tested once Quel ships as a Homebrew package.
