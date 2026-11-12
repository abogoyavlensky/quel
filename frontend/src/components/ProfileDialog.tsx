import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chooseFile } from "@/lib/api";
import type { Color, Engine, Profile, SslMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { RunPolicy } from "@/sql/guard";
import {
  COLORS,
  DEFAULT_PORT,
  ENGINES,
  type ProfileForm,
  RUN_POLICIES,
  SSL_MODES,
  emptyForm,
  nameFromPath,
  fileEngine,
  fromProfile,
  missing,
  toInput,
  withEngine,
} from "@/state/profileForm";
import { textOf } from "@/editor/states";
import { cancelTest, closeProfileDialog, deleteProfile, saveProfile, testConnection } from "@/state/profiles";
import { useApp } from "@/state/store";
import { tagColor } from "./colors";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The result of the last Test: running, passed, or the error. Any edit
// clears it. While it runs, the Test button cancels it.
type TestState = { state: "idle" } | { state: "testing" } | { state: "ok" } | { state: "failed"; error: string };

// Creates and edits a connection profile. One labelled input per field;
// Test checks the form as it stands, saved or not, and saves nothing.
export function ProfileDialog() {
  const dialog = useApp((s) => s.profileDialog);
  const profiles = useApp((s) => s.profiles);
  const editing = dialog?.mode === "edit" ? profiles.find((p) => p.id === dialog.id) : undefined;

  // The editor mounts with the dialog's content, so each opening starts
  // from a fresh form.
  return (
    <Dialog open={!!dialog} onOpenChange={(open) => !open && closeProfileDialog()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {dialog && (
          <ProfileEditor
            editing={editing}
            askDelete={dialog.mode === "edit" && !!dialog.confirmDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfileEditor({
  editing,
  askDelete = false,
}: {
  editing: Profile | undefined;
  askDelete?: boolean;
}) {
  const [form, setForm] = useState<ProfileForm>(() =>
    editing ? fromProfile(editing) : emptyForm(),
  );
  const [test, setTest] = useState<TestState>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A profile cannot be deleted while it disconnects. (A connect in flight
  // is cancelled by the delete.)
  const pending = useApp((s) => (editing ? s.workspaces[editing.id]?.status === "disconnecting" : false));
  const [confirmDelete, setConfirmDelete] = useState(askDelete);
  // Set when Delete is confirmed: that also closes the confirmation, but
  // the editor stays until the delete succeeds or can show its error.
  const deleting = useRef(false);
  // The tabs with text that go with the profile (counted when its
  // workspace is loaded).
  const savedTabs = useApp((s) => {
    const w = editing ? s.workspaces[editing.id] : undefined;
    return w && !w.loadError ? w.tabs.filter((t) => textOf(t.id).trim() !== "").length : 0;
  });

  // Bumped on every edit: a Test that finishes after the form changed
  // answers for settings that are gone, so its result is dropped.
  const revision = useRef(0);
  // The Test in flight, by its attempt id: an edit, Cancel test or closing
  // the dialog cancels it, and only its own reply may set the result.
  const testAttempt = useRef<string | null>(null);

  function stopTest() {
    if (testAttempt.current) cancelTest(testAttempt.current);
    testAttempt.current = null;
  }

  // Closing the dialog unmounts the editor: a Test still running stops.
  useEffect(() => stopTest, []);

  const set = (patch: Partial<ProfileForm>) => {
    stopTest();
    revision.current += 1;
    setForm((f) => ({ ...f, ...patch }));
    setTest({ state: "idle" });
    setError(null);
  };

  const incomplete = missing(form);
  const server = !fileEngine(form.engine);

  async function onTest() {
    const at = revision.current;
    const attemptId = crypto.randomUUID();
    testAttempt.current = attemptId;
    setTest({ state: "testing" });
    let result: TestState;
    try {
      await testConnection(toInput(form), attemptId);
      result = { state: "ok" };
    } catch (e) {
      result = { state: "failed", error: errorText(e) };
    }
    if (testAttempt.current !== attemptId) return;
    testAttempt.current = null;
    if (revision.current === at) setTest(result);
  }

  function onCancelTest() {
    stopTest();
    setTest({ state: "idle" });
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (incomplete) {
      setError(incomplete);
      return;
    }
    setBusy(true);
    try {
      await saveProfile(toInput(form));
      closeProfileDialog();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!form.id) return;
    setBusy(true);
    try {
      await deleteProfile(form.id);
      closeProfileDialog();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  async function onBrowse() {
    try {
      const path = await chooseFile(form.engine);
      // A new file names an unnamed connection after itself.
      if (path) set({ path, ...(form.name.trim() === "" ? { name: nameFromPath(path) } : {}) });
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <>
      <form onSubmit={(e) => void onSave(e)} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Connection" : "New Connection"}</DialogTitle>
          <DialogDescription>
            {server
              ? "Passwords are kept in the Keychain."
              : form.engine === "duckdb"
                ? "A DuckDB database file, or :memory: for a scratch database."
                : "A SQLite database file on this machine."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            className="h-9"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            autoComplete="off"
            autoFocus
          />

          <Label htmlFor="profile-engine">Type</Label>
          <Select value={form.engine} onValueChange={(v) => set(withEngine(form, v as Engine))}>
            <SelectTrigger id="profile-engine" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENGINES.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {server ? (
            <>
              <Label htmlFor="profile-host">Host</Label>
              <div className="flex gap-2">
                <Input
                  id="profile-host"
                  className="h-9 min-w-0 flex-1"
                  value={form.host}
                  onChange={(e) => set({ host: e.target.value })}
                  placeholder="localhost"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Label htmlFor="profile-port" className="sr-only">
                  Port
                </Label>
                <Input
                  id="profile-port"
                  className="h-9 w-20"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(e) => set({ port: e.target.value })}
                  placeholder={String(DEFAULT_PORT[form.engine])}
                  autoComplete="off"
                />
              </div>

              <Label htmlFor="profile-database">Database</Label>
              <Input
                id="profile-database"
                className="h-9"
                value={form.database}
                onChange={(e) => set({ database: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />

              <Label htmlFor="profile-user">User</Label>
              <Input
                id="profile-user"
                className="h-9"
                value={form.user}
                onChange={(e) => set({ user: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />

              <Label htmlFor="profile-password">Password</Label>
              <Input
                id="profile-password"
                type="password"
                className="h-9"
                value={form.password}
                disabled={form.forgetPassword}
                onChange={(e) => set({ password: e.target.value })}
                placeholder={form.hasPassword ? "Saved in Keychain" : ""}
                autoComplete="new-password"
              />
              {form.hasPassword && (
                <div className="col-start-2 flex items-center gap-2">
                  <Checkbox
                    id="profile-forget"
                    checked={form.forgetPassword}
                    onCheckedChange={(v) => set({ forgetPassword: v === true, password: "" })}
                  />
                  <Label htmlFor="profile-forget" className="text-xs font-normal text-muted-foreground">
                    Forget saved password
                  </Label>
                </div>
              )}

              <Label htmlFor="profile-ssl">SSL mode</Label>
              <Select value={form.sslMode} onValueChange={(v) => set({ sslMode: v as SslMode })}>
                <SelectTrigger id="profile-ssl" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SSL_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <>
              <Label htmlFor="profile-path">File</Label>
              <div className="flex gap-2">
                <Input
                  id="profile-path"
                  className="h-9 min-w-0 flex-1"
                  value={form.path}
                  onChange={(e) => set({ path: e.target.value })}
                  placeholder={form.engine === "duckdb" ? "/path/to/data.duckdb or :memory:" : "/path/to/app.db"}
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button type="button" variant="outline" onClick={() => void onBrowse()}>
                  Browse…
                </Button>
              </div>
            </>
          )}

          <span id="profile-color-label" className="text-sm font-medium">
            Colour
          </span>
          <div role="radiogroup" aria-labelledby="profile-color-label" className="flex gap-1.5">
            {COLORS.map((c: Color) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={form.color === c}
                aria-label={c === "none" ? "No colour" : c}
                title={c === "none" ? "No colour" : c}
                onClick={() => set({ color: c })}
                className={cn(
                  "size-5 rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  c === "none" ? "bg-background" : tagColor[c],
                  form.color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "",
                )}
              />
            ))}
          </div>

          <Label htmlFor="profile-safety">Safety</Label>
          <Select value={form.runPolicy} onValueChange={(v) => set({ runPolicy: v as RunPolicy })}>
            <SelectTrigger id="profile-safety" className="h-9 w-full" aria-describedby="profile-safety-hint">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RUN_POLICIES.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="profile-safety-hint" className="col-start-2 -mt-1 text-xs text-muted-foreground">
            {RUN_POLICIES.find((p) => p.value === form.runPolicy)?.hint}
          </p>
        </div>

        <div aria-live="polite" className="min-h-5 text-xs">
          {test.state === "ok" && <p className="text-tag-green">Connected</p>}
          {test.state === "failed" && (
            <p role="alert" className="break-words text-destructive">
              {test.error}
            </p>
          )}
          {error && (
            <p role="alert" className="break-words text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={test.state === "testing" ? false : !!incomplete || busy}
              onClick={() => (test.state === "testing" ? onCancelTest() : void onTest())}
            >
              {test.state === "testing" ? "Cancel test" : "Test"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={busy || pending}
                title={pending ? "Wait for the connection to finish closing" : undefined}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={closeProfileDialog}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </form>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          // Asked from the sidebar's Delete…: Cancel closes it all.
          if (!open && askDelete && !deleting.current) closeProfileDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {editing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The connection and its saved password are removed. Your database is not touched.
              {savedTabs > 0 && ` Its ${savedTabs === 1 ? "saved tab is" : `${savedTabs} saved tabs are`} deleted too.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                deleting.current = true;
                void onDelete().finally(() => (deleting.current = false));
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
