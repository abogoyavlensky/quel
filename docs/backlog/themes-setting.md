# Only the light theme

**Status: open**

## Problem

The redesign (`docs/plans/2026-10-30-2129-redesign.md`) is light only.
Quel stops following the system's dark mode, and the `.dark` token block
in `frontend/src/index.css` stays untouched but unused. Someone who works
in dark mode gets a light window.

## Fix

A theme setting with a few themes: light, dark, and maybe one or two
more. Each theme is a token block in `index.css`, built from the same
roles as the light one (`--chrome`, `--row-alt`, the indigo `--primary`,
the tag ink colours), plus the editor's SQL colours. The setting is kept
in the app database and can follow the system. Mix colours in `oklab`, as
the light theme does.
