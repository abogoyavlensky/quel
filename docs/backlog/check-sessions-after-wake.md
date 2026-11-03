# Every tab fails its first run after the computer sleeps

**Status: open**

## Problem

A tab's session is a dedicated connection that nothing checks while it
sits idle. After the computer sleeps, the server or the network (a VPN,
Tailscale, a NAT) has often closed it. Quel finds out only when the tab
runs something: that run fails, Quel reconnects the tab and says so
(`quel.exec/lost-message`), and the next run works. With several tabs
open, each one fails once.

## Proposed fix

Check the sessions when the computer wakes, before the user runs
anything:

- The frontend notices a jump in time (a timer whose ticks arrive far
  apart) and asks the backend to check the selected profile's sessions.
  The letgo-packages `wails` package exposes no wake event today; a
  timer needs nothing upstream.
- The backend probes each idle tab session with a bounded `select 1`,
  as `dead?` does, skipping sessions with a running query or an open
  cursor (a connection with open rows cannot run another statement).
  It replaces the dead ones.
- Each tab whose session was replaced gets a notice in its messages,
  saying that its open transaction, `SET` values and temp tables are
  gone, so a rolled-back transaction never disappears silently.

## Origin

Deferred from `docs/plans/2026-11-03-2030-reconnect-lost-sessions.md`,
2026-11-03.
