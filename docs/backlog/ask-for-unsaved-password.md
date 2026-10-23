# A profile without a saved password cannot ask for one

**Status: open**

## Problem

A Postgres or Redshift profile saved without a password connects without
one (`quel.profiles/target` leaves the key out of the DSN). That covers
trust auth, `.pgpass` and `PGPASSWORD`, but not someone who does not want
the password stored at all: they have to save it, or connect through
Quick open with the password in the URL.

## Fix

When connecting such a profile fails with an authentication error, or up
front for a profile marked "ask every time", show a password prompt and
pass what is typed to `connect` for that connection only, never to the
Keychain. `connect` would take an optional password, used in place of the
saved one, as `test-connection` already does through
`profiles/effective-password`.
