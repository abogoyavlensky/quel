# Quel's failure-path queries are not in Messages

**Status: open**

## Problem

Messages shows the queries Quel itself sends (catalog reads, the connect
ping), but two still do not show:

- the `select 1` liveness check `quel.exec/dead?` runs on a tab's session
  after a run fails, to tell a lost connection from a live one;
- the ping of a connect that fails (a wrong password, a host that does not
  answer).

Both fail through paths that carry only a message: the run's error and
the connect error under the profile. The lost-connection notice and the
connect error already explain what happened, but the SQL itself is not
listed, which the transparency goal says it should be.

## Possible fix

Return the probe with the failed run's reply (as ex-info data, which the
bridge hands the frontend as the error's cause) and append it to the
workspace's Quel log; likewise put a failed connect's ping on its error
and append it to the workspace even though it never connected.
