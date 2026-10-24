# Bare column names do not complete from the FROM clause

**Status: done**

Landed in `frontend/src/editor/columns.ts` (PR #9), by
`docs/plans/2026-10-24-1351-unqualified-column-completion.md`, 2026-10-24.

## Problem

The editor completes a column after its table or alias (`users.`, `u.`),
which is what CodeMirror's `lang-sql` does with a schema. It does not
offer bare column names from the tables in the statement's `FROM`, so
`select em| from users` offers no `email`, as DataGrip or TablePlus would.

## Fix

A completion source added next to `lang-sql`'s: parse the current
statement's `FROM` and `JOIN` clauses (lang-sql's syntax tree has them),
resolve their tables in the completion schema, and offer their columns
unqualified, ranked above keywords.

Size: one completion source with unit tests; frontend only.

## Origin

Found while checking completion for
`docs/plans/2026-10-23-2224-structure-tree.md`, Task 8, 2026-10-24.
