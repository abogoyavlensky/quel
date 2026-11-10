# Quel cannot connect to AWS Athena

**Status: open**

## Problem

Athena is not an engine in Quel. A profile is SQLite, Postgres or Redshift
(`src/quel/conn.lg:71`, `target`), and all three go through Go's
`database/sql` in letgo-packages.

Athena does not fit that layer as it stands. It is an HTTP API with no
connection: `StartQueryExecution` returns a query id, `GetQueryExecution`
is polled for the state, `GetQueryResults` pages through the rows by token
(1000 a page, every value a string with type metadata beside it), and
`StopQueryExecution` cancels by id. There are no sessions, transactions or
temp tables. Where the backend assumes otherwise:

- `src/quel/conn.lg:254` (`session!`) gives each editor tab a dedicated
  connection. Athena has nothing to hold.
- `src/quel/exec.lg:359` (`open-cursor!`), `fetch-page!` and the sweeper
  exist because an open cursor pins a connection. Athena's results sit in
  S3 under the query id and can be read again at any time.
- `cancel!` (`src/quel/exec.lg:469`) cancels a shim context. Athena needs
  a call with the query id.
- `src/quel/meta.lg` dispatches on `:engine`, which suits Athena, but
  every method takes a `sql` pool. Athena's catalog is better read through
  its listing API (`ListDatabases`, `ListTableMetadata`: free and fast)
  than through SQL, where each catalog query is billed and takes a second
  or more.

What carries over unchanged: the editor, the grid, result tabs, sort and
find, export, run policies, the structure tree's frontend.

None of the Athena behaviour above was checked against a live account;
it is from the API as documented.

## Proposed fix

A native client over aws-sdk-go-v2 (pure Go), in two letgo-packages
packages, and a second execution path in Quel chosen by engine.

1. `letgo-packages/aws`: credentials and region from the SDK's default
   chain. Build this one first, and build it when Redshift IAM
   authentication comes up (`docs/DESIGN.md`, milestone 5 "Later"): that
   needs the same credential chain, so the package pays for itself before
   Athena does.
2. `letgo-packages/athena`: start, poll, stop, results by page, and the
   catalog listing calls. The SDK's API is struct-heavy, so this is a
   shim, as the design already expects for SSH.
3. In Quel: a seam in `quel.exec` so an engine can run without a session
   or a cursor; `quel.meta.athena` over the listing API, with
   `SHOW CREATE TABLE` for DDL; a mapping in `quel.cells` from Athena's
   strings and type names; a profile form with region, workgroup, catalog
   and result location in place of host, port, user and password.

Authentication, in the order worth building:

| Option | Notes |
|---|---|
| A named profile from `~/.aws/config` | One field. Covers SSO, assume-role, `credential_process` and static keys through the SDK. |
| Access key and secret in the form | The secret goes in the Keychain, as passwords do; an optional session token. |
| Assume role (ARN, external id) | MFA needs a prompt for the code. |
| IAM Identity Center sign-in inside Quel | The device flow, through the browser. Without it the user runs `aws sso login` when the token expires. |

Environment variables are not an option on macOS: an app launched from
Finder does not see the shell's environment. SAML and Okta, which the
JDBC driver offers, are left out.

Notes for whoever picks this up:

- Show the bytes scanned with each result: Athena bills by them. "Ask
  before every query" is a sensible default run policy for an Athena
  profile.
- `GetQueryResults` is rate-limited and slow for large results. Export
  of a large result is better served by downloading the result file from
  S3, which needs S3 read permission on the result location.
- A past result can be reopened by its query id without running the query
  again. That is worth keeping in mind for history.
- No local Athena exists to test against, the same as Redshift. The SDK
  takes an endpoint override, so a stub HTTP server can cover the
  protocol, as the updates stub does in e2e.
- The editor's dialect is Trino SQL.

Rejected: wrapping an existing `database/sql` Athena driver
(uber/athenadriver, segmentio/go-athena). `quel.exec` and `quel.meta`
would work nearly unchanged, but the sessions would be fake, the driver
hides the query id and the bytes scanned, and both drivers looked poorly
maintained (not rechecked in 2026). Fair for a spike, not for shipping.

Size: large. Two upstream packages, the execution seam, a meta
namespace, the profile form and its tests: a milestone, not a patch.

## Origin

A discussion on 2026-11-10 about whether Athena support is possible and
practical. The decision was to leave it until there is a need for it, and
to let Redshift IAM authentication bring the `aws` package first.
