# Large Result Export Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save a result of any size up to `MAX_ROWS` as a file, by formatting and sending it to the backend a chunk at a time, so a file over 64 MiB no longer fails with "assembled body too large" and the results footer shows the export's progress.

**Tech Stack:** let-go (`quel.export`, `quel.api`, `quel.system`), integrant; React, TypeScript, zustand, Vitest, Playwright; Bash and Python for the smoke test.

---

## Design

### The problem

Saving a large result in the app fails with `Couldn't save the export:
Invalid runtime call: assembled body too large`. The row count is not the
cause. Wails v3 caps every runtime call at 64 MiB (`maxAssembledBytes`, a
constant in `pkg/application/transport_http.go`, which an app cannot change),
and `saveText` sends the whole file as one argument of `export-result`. A
result reaches the cap at about 3.3 KB a row, so 20,000 rows of JSON or long
text are enough.

Reproduced against the app in server mode, which uses the same
`/wails/runtime` transport: a 70 MiB `export-result` call, split into 512 KiB
pieces the way `@wailsio/runtime` splits it, fails at piece 128 of 141 with
that message. A 60 MiB call reaches the handler.

Only the file saved through the native dialog is affected. A browser download
(server mode, a plain browser, e2e) never crosses the bridge.

### The approach

Keep the formatters in the frontend, but have them produce the file a chunk
at a time instead of as one string, and send each chunk as it is made. Saving
through the native dialog replaces the one call with four:

```
export-begin  (format, filename)  → id, or nil when the dialog is canceled
export-append (id, text)          × once per chunk
export-finish (id)                → path
export-abort  (id)                on any failure, best effort
```

A small export makes three calls instead of one, so there is a single code
path and the old `export-result` handler goes away.

Chunks are also what makes progress possible. `formatResult` holds the main
thread until the whole file is built, so nothing could paint during it: no
timer fires, and React renders nothing. Formatting lazily between awaited
sends leaves the UI live, gives a row count to report, and means Save never
builds the whole text in memory.

### Backend: `quel.export`

`quel.export` gets an integrant component, `:quel.export/registry`: an atom
holding a map of export id to target path. It follows the
`quel.exec/registry` pattern. An id comes from `quel.conn/new-id`.

```clojure
(begin!  exports path)      ; creates the part file, adds the entry; returns the id
(append! exports id text)   ; opens the part file in :append, writes, closes
(finish! exports id)        ; takes the entry, renames the part file over path; returns path
(abort!  exports id)        ; takes the entry, deletes the part file; nil for an unknown id
```

The part file is `<path>.<id>.part`, so each export has its own.

- **Only paths from the dialog can be written.** The frontend holds an id,
  never passes a path, and `append!` and `finish!` throw `"This export is no
  longer open."` for an unknown id. In server mode the bridge answers over
  HTTP, so a handler that writes to any path it is given is not acceptable.
- **A failed export never damages a file.** All writes go to the part file
  beside the target, and `finish!` renames it over the target. If the user
  agreed to overwrite a file, that file stays intact until the export has
  fully succeeded. The part file is in the same directory, so the rename is
  atomic. This assumes no macOS App Sandbox, which would allow writing only
  the file chosen in the dialog: the app has no entitlements today
  (`build/macos`, the signing scripts). Turning the sandbox on would mean
  revisiting this.
- **A part file touches nothing else.** A random name cannot match a user's
  file or a symlink, as a fixed `<path>.part` could, and two exports to one
  path do not share a file: each stays whole and the last to finish wins. So
  no lock is needed around the file operations.
- **No file handle stays open between calls.** Each `append!` uses
  `with-open` on `(open part :append)`, so there is nothing to leak.
- **`begin!` creates the part file with `spit` before adding the entry**, so
  a failed create leaves no entry behind.
- **`finish!` owns the entry once it has taken it.** It removes the id first
  (`swap-vals!`, as `take-entry!` in `quel.exec` does), renames, and deletes
  the part file before rethrowing if the rename fails. The frontend's
  `export-abort` after a failed finish is then a no-op.
- **`halt-key!`** aborts every entry, so quitting during an export leaves no
  part file. A few cases can still leave one, and all are accepted: a crash,
  an append in flight at the moment of the quit (it recreates the file), and
  a `begin!` that registers after halt has run. It is one stray temp file, and
  the frontend awaits each call, so nothing else can race an append.

`filters` stays. `write!` goes: nothing else uses it, and removing it stops
`quel.export` shadowing core `write!`, which `append!` needs.

Checked at the pinned let-go: `open` with `:append`, `write!` (unbuffered),
`close!`, `with-open`, `spit` with `""` (creates an empty file), `delete-file`,
`os/rename` (replaces the target), and `swap-vals!`.

### Backend: `quel.api`

The dialog stays in the handler, which keeps `quel.export` testable with no
dialog.

```clojure
(defn export-begin [{:keys [app exports]} format filename]
  (when-let [path (w/save-file app {:title "Export Result"
                                    :filename filename
                                    :filters (export/filters format)})]
    (export/begin! exports path)))
```

`export-append`, `export-finish` and `export-abort` are one-line handlers over
`quel.export`, each taking the id. `export-result` is removed, from the
handler map too.

### Frontend: formatting in chunks (`grid/export.ts`)

```ts
export const CHUNK_UNITS = 4 * 1024 * 1024;
export interface ExportChunk { text: string; rows: number } // rows: formatted so far
export function* formatChunks(format: ExportFormat, columns: Column[], rows: Cell[][],
  separator: CsvSeparator, size = CHUNK_UNITS): Generator<ExportChunk>;
export function collectChunks(chunks: Iterable<ExportChunk>,
  onRows: (rows: number) => void): Promise<string[]>;
```

Each format becomes a small `{ head, row(cells, index), tail }`, so CSV, JSON
and Markdown are defined once. `toCsv`, `toJson` and `toMarkdown` join those
parts, and their output does not change, so their tests stay as they are.
`formatChunks` builds on the same parts: it gathers text until it reaches
`size`, then yields. `formatResult` goes, since `formatChunks` replaces its one
caller.

The last chunk's `rows` equals `rows.length`, and at least one chunk is always
yielded, even for an empty result (`[]`, or the CSV header).

Two rules, each with a test:

- **Never cut a surrogate pair.** A single cell can be longer than `size`, so
  text over `size` is cut, and each cut piece repeats the same `rows`. When the
  code unit at `end - 1` is a high surrogate (`0xD800`–`0xDBFF`) and `end` is
  not the end of the text, back `end` off by one. A cut pair would reach
  `JSON.stringify` as two lone surrogates, Go would decode each to U+FFFD, and
  the character would be lost. `size` must be at least 2.
- **Size in code units, for the worst case.** A code unit takes at most 6
  bytes on the wire (a control character is `\uXXXX`), so 4 Mi code units are
  at most 24 MiB in one call, well under the 64 MiB cap. Say so in a comment
  on the constant.

`collectChunks` gathers chunks into an array, reporting `onRows(0)` and then
each chunk's `rows`, and awaits a macrotask (`setTimeout(…, 0)`) after each
chunk. Copy and the browser download use it; neither has a network call to
yield on.

### Frontend: saving (`lib/save.ts`, `lib/api.ts`)

`saveText` becomes:

```ts
export function saveChunks(filename: string, format: ExportFormat,
  chunks: Iterable<ExportChunk>, onRows: (rows: number) => void): Promise<string | null>;
```

- **In the app's webview:** `exportBegin`, and return null if canceled, without
  touching `chunks`. Then `onRows(0)`, and in a `try`, for each chunk await
  `exportAppend` and call `onRows(chunk.rows)`, then return `exportFinish`, which
  gives the path for the toast. On any error, call `exportAbort` with its own
  rejection swallowed, and rethrow the original error, so `runner.ts`'s toast
  "Couldn't save the export: …" fires as it does today.
- **Otherwise:** `download` takes `await collectChunks(chunks, onRows)` as the
  `Blob`'s parts.

`api.ts` gets `exportBegin`, `exportAppend`, `exportFinish` and `exportAbort`,
and loses `exportResult`. `exportBegin` goes through `pathOrNull`, so a nil
reply lowered to `{}` or null stays a cancel. Its answer is now an id or a
path, so rename it `answerOrNull` (`chooseFile` is its other caller).

### Frontend: progress in the results footer

The footer's left end already shows a spinner and words during a run, so the
export uses that place, in the same style.

```ts
// EditorTab, null when no export runs. rows is null until rows are moving:
// while the rest of the result loads and while the dialog is open. In memory only.
exporting: { action: "copy" | "save"; rows: number | null; total: number } | null;
```

- **`state/runner.ts`:** `exportResult` returns at once if the tab is already
  exporting, and otherwise sets `exporting` with `rows: null` before its first
  await. That reserves the tab for the whole export, loading included, so a
  second result in the tab cannot start one alongside it. It creates the chunks
  with `formatChunks`, and passes `saveChunks` or `collectChunks` an `onRows` that
  writes the rows and the total to the tab. A `finally` around all of it clears
  `exporting` on every outcome: done, stopped, canceled, failed. `updateTab`
  does nothing for a closed tab, so closing the tab mid-export is safe, and
  the export finishes.
- **`state/status.ts`:** `exportWords(tab)` gives "Saving 12,500 of 100,000
  rows…" or "Copying 12,500 of 100,000 rows…", and null when no export runs or
  `rows` is null. Rows, not a
  percentage, because the file's final size is not known while it is being
  made.
- **`components/ResultFooter.tsx`:** the status appears after the same 300 ms
  delay as "Running…", so a quick export never flashes it. It replaces only
  the left text; the Export button and the time stay. It also keeps the
  footer present on Messages, where the footer otherwise has nothing to show.
  A run's words take priority over it.
- **`components/ExportMenu.tsx`:** takes `exporting` as a prop and disables
  Copy and Save while it is true, on every result of the tab. That replaces
  the local `busy` state, which was lost when switching results remounted the
  menu. The popover closes on the click instead of at the end: the footer now
  shows what is happening. A reopened popover shows the buttons disabled.

Loading the rest of an open result keeps its existing "N rows loaded, loading
more…" text. The dialog shows no status: `onRows(0)` comes after the user picks
a file.

### Error handling

| When | What happens |
|---|---|
| Dialog canceled | `export-begin` is nil, nothing else is called, no toast |
| The part file cannot be created | `export-begin` rejects, the toast shows the OS error |
| A write fails (disk full) | `export-append` rejects, `export-abort` deletes the part file, the toast shows the error, the target is untouched |
| The rename fails | `finish!` deletes the part file, the toast shows the error |
| The file name is within about 40 bytes of the 255-byte limit | `export-begin` rejects with "file name too long"; accepted, as the suggested name is short |
| The app quits during an export | `halt-key!` deletes the part file |

### Testing

- Backend: `export_test` covers `begin!`, `append!`, `finish!`, `abort!` and
  halt on a temp dir. `api_test` covers the handlers without a dialog.
- Frontend: `grid/export.test.ts` covers chunking, a new `lib/save.test.ts`
  the call sequence, `state/status.test.ts` the words, and
  `state/runner.test.ts` that `exporting` is set and always cleared. Vitest runs
  in Node here, so `save.test.ts` stubs `window` with `vi.stubGlobal`.
- e2e: a new test holds Copy open and reads the footer's status. It replaces
  `navigator.clipboard.writeText` with a promise the test resolves, so it does
  not depend on how fast the machine formats.
- Mocks cannot see the 64 MiB ceiling, so **`scripts/smoke.sh` drives more
  than 64 MiB through the real transport**: it starts an export over the
  nREPL (server mode has no dialog), appends over HTTP in the runtime's
  chunked format, finishes, and compares size and SHA-256.
- `lgx e2e` keeps covering the browser download, now built from chunks.
- Manual, on a Mac, because this Linux box has no GTK/WebKitGTK and the
  native dialog cannot run in server mode: see Task 8.

### Out of scope

- **More than 100,000 rows.** `MAX_ROWS` stays, and the toast still says "the
  first 100,000 rows".
  `docs/backlog/export-past-row-cap.md` stays open.
- **Copy of a result over 64 MiB.** When `navigator.clipboard` refuses, as a
  native webview may, `copyText` falls back to `Clipboard.SetText`, which
  crosses the bridge and hits the same cap. The user sees "Couldn't copy to
  the clipboard." and Save works. It gets a backlog entry (Task 7).
- **Canceling an export.** The footer reports progress only. Stopping a save
  needs a control of its own, and `exportAbort` would make it a small change
  later if a long save turns out to want one.

## File Structure

| File | Change |
|---|---|
| `src/quel/export.lg` | `:quel.export/registry`, `begin!`, `append!`, `finish!`, `abort!`; `write!` removed; requires `quel.conn` for `new-id` |
| `src/quel/api.lg` | `export-begin`, `export-append`, `export-finish`, `export-abort`; `export-result` removed |
| `src/quel/system.lg` | The new key, `:exports` for the handlers, the ns required |
| `test/quel/export_test.lg` | The new functions |
| `test/quel/api_test.lg` | `with-env`, the handler set, the handlers |
| `test/quel/system_test.lg` | The config's keys, the handlers' refs |
| `frontend/src/grid/export.ts` | Each format as head, row and tail; `CHUNK_UNITS`, `ExportChunk`, `formatChunks`, `collectChunks`; `formatResult` removed |
| `frontend/src/grid/export.test.ts` | Chunking; the `formatResult` tests move to `formatChunks` |
| `frontend/src/lib/api.ts` | Four calls replace `exportResult`; `pathOrNull` becomes `answerOrNull` |
| `frontend/src/lib/api.test.ts` | The answer-or-nil test moves to `exportBegin` |
| `frontend/src/lib/save.ts` | `saveChunks` replaces `saveText` |
| `frontend/src/lib/save.test.ts` | New |
| `frontend/src/state/store.ts` | `EditorTab.exporting` |
| `frontend/src/state/runner.ts` | `exportResult` over chunks, with progress |
| `frontend/src/state/runner.test.ts` | `saveChunks`, and the progress |
| `frontend/src/state/status.ts`, `status.test.ts` | `exportWords` |
| `frontend/src/components/ResultFooter.tsx` | The status at the left end |
| `frontend/src/components/ExportMenu.tsx` | `exporting` prop; closes on the click |
| `frontend/e2e/export.spec.ts` | The footer's status |
| `scripts/smoke.sh` | The past-the-cap step, and a note in the header comment |
| `docs/DESIGN.md` | The Export section and the handler table |
| `docs/backlog/export-past-row-cap.md` | The reference to `write!` |
| `docs/backlog/copy-past-bridge-limit.md` | New, in its own commit |

Run every `lgx` command through mise: the `lgx` on PATH can be older than
`.mise.toml`'s 0.5.4 and rejects this `lgx.edn`. On a box without GTK4 and
WebKitGTK headers, keep the `CGO_ENABLED=0 GOFLAGS=-tags=server` prefix.

## Tasks

Work on a branch `large-result-export`, cut from master.

### Task 1: The export registry in `quel.export`

**Files:**
- Modify: `src/quel/export.lg`
- Test: `test/quel/export_test.lg`

- [x] **Step 1: Write the failing tests**
  Replace `write-saves-the-text-as-it-is` and add, each on a `temp-dir` with `(ig/init-key :quel.export/registry {})`. To find part files, list the temp dir; the tests assert it holds only the expected files.
  - begin, append twice (one with `"Zoë — 日本"`), finish: the target holds the text exactly, `finish!` returns the path, the dir holds only the target.
  - An existing target keeps its content after `begin!` and `append!`, and after `abort!`; it is replaced only by `finish!`.
  - A file named `<path>.part` keeps its content through a begin, an append and an abort.
  - Two exports to one path each write their own part file, and both finish; the target holds the second to finish.
  - `abort!` deletes the part file, leaves the registry empty, and returns nil for an unknown id.
  - `append!` and `finish!` on an unknown id throw "This export is no longer open."
  - `begin!` in a missing directory throws and leaves the registry empty.
  - A rename failure: make the target a non-empty directory, begin, finish. `finish!` throws, the part file is gone, the registry is empty.
  - `(ig/halt-key! :quel.export/registry exports)` deletes the part file of an open export.

- [x] **Step 2: Run them to verify they fail**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server mise x -- lgx test`
  Expected: the new tests in `quel.export-test` FAIL.

- [x] **Step 3: Implement**
  In `src/quel/export.lg`: require `integrant.core :as ig`, update the namespace comment (the frontend formats and sends the text in pieces; this side asks where to save and writes it), remove `write!`, and add `part-path` (of a path and an id), `begin!`, `append!`, `finish!`, `abort!` and the `::registry` `init-key` (`(atom {})`) and `halt-key!`, as the Design says.

Do not commit yet. `quel.api` still calls `export/write!`, so the backend suite cannot load until Task 2 replaces it, and removing `write!` cannot wait: it shadows the core `write!` that `append!` needs. Tasks 1 and 2 are one commit.

### Task 2: The handlers

**Files:**
- Modify: `src/quel/api.lg`, `src/quel/system.lg`
- Test: `test/quel/api_test.lg`, `test/quel/system_test.lg`

- [x] **Step 1: Update the tests**
  - `api_test.lg` `with-env`: add `exports (ig/init-key :quel.export/registry {})`, pass `:exports exports`, halt it in `finally`. Update the comment that says `choose-file` is the one handler needing `:app` (`export-begin` needs it too).
  - `every-handler-is-a-var`: replace `"export-result"` with `"export-begin" "export-append" "export-finish" "export-abort"`.
  - Add a test that seeds with `quel.export/begin!` on a temp path, then calls `api/export-append` twice with its id and `api/export-finish` and checks the file, and one that `api/export-abort` leaves no part file.
  - `system_test.lg`: add `:quel.export/registry` to the expected keys, and check `:exports` is a ref to it in `the-handlers-see-the-store-secrets-and-app`.

- [x] **Step 2: Implement**

  - `src/quel/api.lg`: replace `export-result` with the four handlers and update the `handlers` map. Register by var as the map already does.
  - `src/quel/system.lg`: require `[quel.export]`, add `:quel.export/registry {}` to `config`, add `:exports (ig/ref :quel.export/registry)` to `:quel.api/handlers`.

- [x] **Step 3: Run the tests to verify they pass**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server mise x -- lgx test`
  Expected: PASS, including every test from Task 1.

- [x] **Step 4: Commit Tasks 1 and 2 together**
  `git commit -m "Write exports through a part file, in begin, append and finish steps"`

### Task 3: Format in chunks

**Files:**
- Modify: `frontend/src/grid/export.ts`
- Test: `frontend/src/grid/export.test.ts`

- [ ] **Step 1: Write the failing tests**
  Keep the `toCsv`, `toJson` and `toMarkdown` tests as they are. Keep the `formatResult` tests, for now, and add a `formatChunks` block:
  - For each format, the chunks' text joined equals `toCsv`, `toJson` or `toMarkdown`, with a small `size` and with the default.
  - The last chunk's `rows` is `rows.length`, and `rows` never goes down.
  - An empty result yields one chunk: `[]` for JSON, the header for CSV and Markdown.
  - A cell longer than `size` is cut, and no chunk is longer than `size`.
  - No surrogate pair is cut: with `"abc😀def"` in a cell and a small `size`, no chunk ends in a high surrogate or starts with a low one, and the joined text is intact.
  - The worst case fits: for `CHUNK_UNITS` control characters, `new TextEncoder().encode(JSON.stringify(text)).length` stays under 64 MiB. Build it with `"\u0001".repeat(CHUNK_UNITS)`.
  - `collectChunks` returns the texts in order and reports 0, then each chunk's `rows`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npm --prefix /home/agent/Projects/quel/frontend test`
  Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  In `frontend/src/grid/export.ts`, as the Design says. Keep `formatResult` until Task 4 replaces its caller. Run the JSON cell code (`rawJson`) per row as it does today.

- [ ] **Step 4: Run the tests to verify they pass**
  Run: `npm --prefix /home/agent/Projects/quel/frontend test`
  Expected: PASS, with the existing format tests unchanged.

- [ ] **Step 5: Commit**
  `git commit -m "Format exports a chunk at a time"`

### Task 4: Save chunks to the backend

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/lib/api.test.ts`, `frontend/src/lib/save.ts`, `frontend/src/state/store.ts`, `frontend/src/state/runner.ts`, `frontend/src/state/runner.test.ts`, `frontend/src/grid/export.ts`, `frontend/src/grid/export.test.ts`
- Create: `frontend/src/lib/save.test.ts`

- [ ] **Step 1: Write the failing tests**
  `api.test.ts`: move the answer-or-nil cases to `exportBegin` (`bridge.call` receives `"export-begin", "csv", "result.csv"`), and keep `{}`, null, undefined and `""` meaning cancel.

  `save.test.ts`, with `vi.mock("@/lib/api")` and `vi.stubGlobal("window", { webkit: { messageHandlers: { external: { postMessage() {} } } } })`:
  - A save calls begin, then append with begin's id once per chunk in order, then finish, returns finish's path, and reports 0 and then each chunk's `rows`.
  - A canceled dialog (`exportBegin` resolves null) returns null, calls nothing else, reports nothing, and leaves the chunks unread (pass a generator and check it did not start).
  - A rejected append calls `exportAbort` with the id, does not call `exportFinish`, and rejects with the append's error.
  - A rejected `exportAbort` does not replace that error.
  - A rejected finish calls `exportAbort` and rejects with finish's error.

  `runner.test.ts`: change the `save.saveText` mock to `saveChunks`, reading text by joining the chunks passed, and add:
  - While `saveChunks` is pending and has called `onRows`, `tab().exporting` holds the action, the rows and the total.
  - `exporting` is null after a save, a canceled save, a failed save, a copy, a failed copy and a load that stopped.
  - `exporting` is set, with `rows` null, while `loadAll` is pending, and a second `exportResult` for another result of the tab then returns without saving or copying.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npm --prefix /home/agent/Projects/quel/frontend test`
  Expected: the new and updated tests FAIL.

- [ ] **Step 3: Implement**
  - `api.ts`: replace `exportResult` with `exportBegin`, `exportAppend`, `exportFinish`, `exportAbort`, rename `pathOrNull` to `answerOrNull`, and update the comments above them.
  - `save.ts`: `saveChunks` replaces `saveText`; `download` takes the parts. Update the file's header comment.
  - `store.ts`: add `exporting` to `EditorTab`, null in `newTabState`. `persist` saves named fields, so it stays in memory; check `state/persist.ts` to confirm.
  - `runner.ts`: `exportResult` as the Design says. Put the copy's `collectChunks` and join inside the `try` that toasts "Couldn't copy to the clipboard.", so a text too long for the engine's string limit gets that toast rather than failing silently.
  - `export.ts`: remove `formatResult`, and move its "picks the format" test to `formatChunks`. Keep the `EXTENSIONS` test.

- [ ] **Step 4: Run the tests and the type check**
  Run: `npm --prefix /home/agent/Projects/quel/frontend test && npm --prefix /home/agent/Projects/quel/frontend run build`
  Expected: PASS, and the build has no type errors.

- [ ] **Step 5: Commit**
  `git commit -m "Save exports to the backend in chunks"`

### Task 5: Show progress in the results footer

**Files:**
- Modify: `frontend/src/state/status.ts`, `frontend/src/state/status.test.ts`, `frontend/src/components/ResultFooter.tsx`, `frontend/src/components/ExportMenu.tsx`
- Test: `frontend/e2e/export.spec.ts`

- [ ] **Step 1: Write the failing tests**
  `status.test.ts`: `exportWords` is null with no export and with `rows` null, and "Saving 12,500 of 100,000 rows…" and "Copying 12,500 of 100,000 rows…" with one.

  `export.spec.ts`, a test that shows progress while an export runs:
  - Before connecting, `page.addInitScript` replaces `navigator.clipboard.writeText` with a function returning a promise whose `resolve` is kept on `window`.
  - Run `select id from t order by id` and press Copy.
  - Expect the `Result footer` group to show "Copying 2,000 of 2,000 rows…" and the Export button to stay visible.
  - Reopen the popover: Copy and Save are disabled. Close it.
  - Resolve the promise. Expect "Copied 2,000 rows as CSV", and the status gone.

- [ ] **Step 2: Run the unit tests to verify they fail**
  Run: `npm --prefix /home/agent/Projects/quel/frontend test`
  Expected: the `exportWords` tests FAIL.

- [ ] **Step 3: Implement**
  - `status.ts`: `exportWords`.
  - `ResultFooter.tsx`: gate the status with `useDelayed(exportWords(tab) !== null, 300)`, and factor the spinner and words into a small local component shared with the run branch. In the `result` branch the left end shows the status instead of the rows text, and the right end stays. Return null only when there are no run words, no status and no result. Pass `exporting={tab.exporting !== null}` to `ExportMenu`. Update the comment above the component.
  - `ExportMenu.tsx`: the `exporting` prop, the disabled buttons, `setOpen(false)` at the start of `run`. Remove `busy` and its comment.

- [ ] **Step 4: Run the tests**
  Run: `npm --prefix /home/agent/Projects/quel/frontend test && (cd /home/agent/Projects/quel && CGO_ENABLED=0 GOFLAGS=-tags=server mise x -- lgx e2e)`
  Expected: PASS, the whole of `export.spec.ts` included.

- [ ] **Step 5: Commit**
  `git commit -m "Show an export's progress in the results footer"`

### Task 6: Prove it past the cap in the smoke test

**Files:**
- Modify: `scripts/smoke.sh`

- [ ] **Step 1: Add the step**
  Put it inside the existing `if [[ -f "$NREPL_CLIENT" ]]` branch, before the handler redefinition, and add "and an export larger than the bridge's 64 MiB cap is saved" to the header comment.
  - Over the nREPL, start an export on `$tmp/big.csv` and keep its id:
    `(quel.export/begin! (:quel.export/registry @quel.system/system*) "<path>")`.
    The client prints the value as let-go prints it, in double quotes: strip them.
  - In a Python heredoc, send 70 MiB through `export-append`, 8 Mi bytes a call, with text mixing ASCII and multi-byte UTF-8. Split each call's JSON body into 512 KiB POSTs with the `x-wails-chunk-id`, `x-wails-chunk-index` and `x-wails-chunk-total` headers and the `Content-Type` and `x-wails-client-id` headers of `call`, as the spike did. Fail on any non-200 reply. Print the expected size and SHA-256.
  - `call export-finish "[\"$id\"]"`, then compare the file's size and SHA-256 with Python's, and check `$tmp` holds no `*.part` file.
  - `call export-append '["no-such-id","x"]'` answers "This export is no longer open."

- [ ] **Step 2: Run it**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server mise x -- lgx smoke`
  Expected: `smoke: ok`, with no "nREPL step skipped" line. Stop if the step was skipped: `letgo-packages` must be beside this repo, or `NREPL_CLIENT` set.

- [ ] **Step 3: Confirm the test can fail**
  Temporarily send the 70 MiB as one `export-append` call and run the step: expected a failure with "assembled body too large". Put it back.

- [ ] **Step 4: Commit**
  `git commit -m "Smoke-test an export past the bridge's 64 MiB cap"`

### Task 7: Docs and backlog

**Files:**
- Modify: `docs/DESIGN.md`, `docs/backlog/export-past-row-cap.md`
- Create: `docs/backlog/copy-past-bridge-limit.md`

- [ ] **Step 1: Update `docs/DESIGN.md`**
  - The formats paragraph of `### Export`: they make the file a chunk at a time (`formatChunks`).
  - The Saving paragraph: `saveChunks`; the backend opens the dialog, the frontend sends chunks of at most `CHUNK_UNITS` code units because Wails caps a runtime call at 64 MiB, and the file appears at its path only when all of it is written (`<path>.<id>.part` until then).
  - A new sentence in `### Export`: the results footer's left end shows "Saving 12,500 of 100,000 rows…" or the Copy equivalent, after the same 300 ms delay as "Running…".
  - The Export row of the handler table: `export-begin` (the format and a suggested file name; a save dialog; an id, or nil when canceled), `export-append` (the id and a piece of text), `export-finish` (the id; the path), `export-abort` (the id).

- [ ] **Step 2: Update the backlog entry**
  In `docs/backlog/export-past-row-cap.md`, change "next to `filters` and `write!`" to "next to `filters` and `begin!`". Add one sentence to "Proposed fix": saving already formats and sends the file in chunks (`docs/plans/2026-11-04-2239-large-result-export.md`), so a backend writer can reuse the registry and its part file. The status stays open.

- [ ] **Step 3: Commit the docs**
  `git commit -m "Docs: exports are saved in pieces"`

- [ ] **Step 4: Add the backlog entry, in its own commit**
  Create `docs/backlog/copy-past-bridge-limit.md`, titled "Copy fails for a result over 64 MiB", starting with `**Status: open**`. Problem: `copyText` falls back to Wails' `Clipboard.SetText`, a runtime call under the same 64 MiB cap, so a native webview that refuses `navigator.clipboard` shows "Couldn't copy to the clipboard." Save works. Origin: this plan.
  `git commit -m "Backlog: copying a result over the bridge's 64 MiB cap"`

### Task 8: Full verification

- [ ] **Step 1: Run everything that runs here**
  Run:
  ```
  CGO_ENABLED=0 GOFLAGS=-tags=server mise x -- lgx test
  npm --prefix frontend test
  CGO_ENABLED=0 GOFLAGS=-tags=server mise x -- lgx smoke
  CGO_ENABLED=0 GOFLAGS=-tags=server mise x -- lgx e2e
  ```
  Expected: all pass, including "saves a CSV with the chosen separator as a download".

- [ ] **Step 2: Check that nothing refers to the old handler**
  Run: `grep -rn "export-result\|exportResult\|export/write!\|saveText\|formatResult" src test frontend/src scripts docs/DESIGN.md`
  Expected: only `exportResult` in `state/runner.ts`, `state/runner.test.ts` and `ExportMenu.tsx`, which is the runner's own function.

- [ ] **Step 3: Manual check on a Mac**
  This cannot run here, so hand it to the user and say so. Run `lgx run`, connect to a SQLite database, and run:
  ```sql
  with recursive c(x) as (select 1 union all select x + 1 from c where x < 25000)
  select x, printf('%.*c', 4000, 'x') as payload from c
  ```
  Save as CSV. The footer's left end counts up ("Saving 8,000 of 25,000 rows…"), the window stays responsive, and a file of about 100 MB opens whole, with no part file beside it. Save again over the same file and cancel at the dialog: the file stays. Try a read-only directory: the toast shows the error.
