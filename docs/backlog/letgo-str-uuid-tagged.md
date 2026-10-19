# let-go's (str (random-uuid)) returns the tagged #uuid "..." form

**Status: open**

## Problem

On let-go 1.13.0, `(str (random-uuid))` returns `#uuid "73dfe02e-..."` - the
printed literal - where Clojure returns the bare
`73dfe02e-1b0d-413d-a204-43eeae88ee3d`. Repro:

```sh
echo '(println (pr-str (str (random-uuid))))' > /tmp/u.lg && lg /tmp/u.lg
# => "#uuid \"73dfe02e-1b0d-413d-a204-43eeae88ee3d\""
```

Quel hit it with connection ids: `quel.conn/open!` returned
`#uuid "..."` strings, which the frontend treated as opaque and so did not
notice, but which broke hand-built JSON in `scripts/smoke.sh`.
`quel.conn/new-id` (`src/quel/conn.lg`) works around it by extracting the
36-character UUID with a regex, which also works once let-go matches Clojure.

## Fix

Upstream, in let-go: `str` on a UUID value should return its canonical
string, as Clojure's `.toString` does. Report it with the repro above (or fix
it there; `random-uuid` lives in `pkg/rt/lang.go`), and check whether other
tagged literals (`#inst`) have the same `str` behaviour.

Once a let-go release carries the fix and Quel's `:lg-version` moves to it,
replace `quel.conn/new-id` with `(str (random-uuid))` and keep the test in
`test/quel/conn_test.lg` that checks the id is a bare UUID.

Size: one line upstream plus a test; three lines in Quel afterwards.

## Origin

Found by the smoke test while executing the milestone 0 plan
(`docs/plans/2026-10-19-2226-milestone-0-spike-and-setup.md`, Task 11),
2026-10-19.
