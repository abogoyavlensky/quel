# Redshift late-binding views show no columns

**Status: open**

## Problem

A Redshift view created `with no schema binding` has no rows in
`pg_attribute`, so the structure tree shows it with "No columns", and
completion offers none of its columns.

## Fix

For Redshift, add the columns `pg_get_late_binding_view_cols()` returns to
`columns` and `completion-rows` (a union, or a second query merged in
let-go). It is a Redshift-only function, so it needs a real cluster to
test.

Size: one query per method and its merge; tests against Redshift.

## Origin

Left out of `docs/plans/2026-10-23-2224-structure-tree.md`, 2026-10-24.
