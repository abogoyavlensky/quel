# The structure filter misses tables past the completion cap

**Status: open**

## Problem

The Structure filter finds tables and views in closed schemas through
the editor's completion names (`filterSchemas` in
`frontend/src/state/tree.ts`): a schema whose completion entry has a
matching name is loaded and shown. Completion stops at 50,000 column
rows (`quel.meta/completion-limit`) and lists objects by their columns,
so on a large database the tables past the cap, and objects without
columns (an SQLite view over a dropped table), are not found until their
schema is open.

## Proposed fix

A `search-objects` handler per engine: the names matching the text
across every schema, straight from the catalog, with a limit. The filter
would ask it (debounced) instead of reading completion. It could also
match index names, which completion does not have.
