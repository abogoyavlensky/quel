import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/editor/states", () => ({ focusEditor: vi.fn() }));
const runner = vi.hoisted(() => ({
  cancel: vi.fn(),
  closeTab: vi.fn(),
  connectProfile: vi.fn(),
  disconnectProfile: vi.fn(),
  newTab: vi.fn(),
  reopenTab: vi.fn(),
  runCurrent: vi.fn(),
  toggleRowDetails: vi.fn(),
}));
vi.mock("./runner", () => runner);
const profiles = vi.hoisted(() => ({ openProfileDialog: vi.fn() }));
vi.mock("./profiles", () => profiles);
const updates = vi.hoisted(() => ({ checkForUpdates: vi.fn() }));
vi.mock("./updates", () => updates);
const palette = vi.hoisted(() => ({ openPalette: vi.fn() }));
vi.mock("./palette", () => palette);

import type { Profile } from "@/lib/types";
import { commands } from "./commands";
import { type AppState, type ConnStatus, initialState, newWorkspace } from "./store";

const profile = (id: string): Profile => ({
  id,
  name: id,
  engine: "sqlite",
  host: null,
  port: null,
  database: null,
  user: null,
  "ssl-mode": null,
  path: "/tmp/x.db",
  color: "none",
  "has-password": false,
});

// A state with profile p selected and its workspace loaded.
function state(status: ConnStatus = "disconnected", patch: (w: ReturnType<typeof newWorkspace>) => void = () => {}) {
  const w = newWorkspace("p");
  w.status = status;
  patch(w);
  return { ...initialState(), profiles: [profile("p")], selected: "p", workspaces: { p: w } } satisfies AppState;
}

const ids = (s: AppState) => commands(s).map((c) => c.id);
const ALWAYS = ["new-connection", "row-details", "check-updates"];

beforeEach(() => {
  for (const f of [...Object.values(runner), ...Object.values(profiles), ...Object.values(updates)]) f.mockReset();
  palette.openPalette.mockReset();
});

describe("commands", () => {
  it("offers only the always-on entries with no profile", () => {
    expect(ids(initialState())).toEqual(ALWAYS);
  });

  it("offers tabs, queries and Connect on a disconnected workspace", () => {
    expect(ids(state())).toEqual([
      "new-tab",
      "close-tab",
      "focus-editor",
      "run",
      "run-script",
      "connect",
      "go-to-connection",
      "new-connection",
      "edit-connection",
      "row-details",
      "check-updates",
    ]);
  });

  it("offers Disconnect instead of Connect when connected", () => {
    const got = ids(state("connected"));
    expect(got).toContain("disconnect");
    expect(got).not.toContain("connect");
  });

  it("offers neither Connect nor Disconnect while connecting or disconnecting", () => {
    for (const status of ["connecting", "disconnecting"] as const) {
      const got = ids(state(status));
      expect(got).not.toContain("connect");
      expect(got).not.toContain("disconnect");
    }
  });

  it("offers Cancel, not Run, while the active tab runs", () => {
    const got = ids(state("connected", (w) => (w.tabs[0].runningQueryId = "q1")));
    expect(got).toContain("cancel");
    expect(got).not.toContain("run");
    expect(got).not.toContain("run-script");
    expect(ids(state("connected"))).not.toContain("cancel");
  });

  it("does not offer Close Tab on a pinned active tab", () => {
    expect(ids(state("connected", (w) => (w.tabs[0].pinned = true)))).not.toContain("close-tab");
  });

  it("offers Reopen Closed Tab only with closed tabs", () => {
    expect(ids(state())).not.toContain("reopen-tab");
    const closed = state("disconnected", (w) => {
      w.closed = [{ id: "c1" } as (typeof w.closed)[number]];
    });
    expect(ids(closed)).toContain("reopen-tab");
  });

  it("offers no tab or query entries when the workspace failed to load", () => {
    const got = ids(state("disconnected", (w) => (w.loadError = "boom")));
    for (const id of ["new-tab", "close-tab", "reopen-tab", "focus-editor", "run", "run-script", "cancel"]) {
      expect(got).not.toContain(id);
    }
    expect(got).toContain("edit-connection");
  });

  it("offers Go to Connection only with a profile", () => {
    expect(ids(initialState())).not.toContain("go-to-connection");
    expect(ids(state())).toContain("go-to-connection");
  });

  it("titles Row Details after the panel", () => {
    const title = (s: AppState) => commands(s).find((c) => c.id === "row-details")!.title;
    expect(title(initialState())).toBe("Show Row Details");
    expect(title({ ...initialState(), rowDetails: true })).toBe("Hide Row Details");
  });
});

describe("focus", () => {
  it("keeps focus only for the entries that do not move it", () => {
    const w = state("connected", (w) => (w.closed = [{ id: "c1" } as (typeof w.closed)[number]]));
    const kept = commands(w).filter((c) => c.keepsFocus).map((c) => c.id);
    expect(kept).toEqual(["close-tab", "reopen-tab", "run", "run-script", "disconnect", "row-details"]);
    const movers = commands(w).filter((c) => !c.keepsFocus).map((c) => c.id);
    expect(movers).toEqual(["new-tab", "focus-editor", "go-to-connection", "new-connection", "edit-connection", "check-updates"]);
  });
});

describe("run", () => {
  const find = (s: AppState, id: string) => commands(s).find((c) => c.id === id)!;

  it("connects and disconnects the selected profile", () => {
    void find(state(), "connect").run();
    expect(runner.connectProfile).toHaveBeenCalledWith("p");
    void find(state("connected"), "disconnect").run();
    expect(runner.disconnectProfile).toHaveBeenCalledWith("p");
  });

  it("runs the current tab's query and cancels it", () => {
    void find(state("connected"), "run-script").run();
    expect(runner.runCurrent).toHaveBeenCalledWith("script");
    const s = state("connected", (w) => (w.tabs[0].runningQueryId = "q1"));
    void find(s, "cancel").run();
    expect(runner.cancel).toHaveBeenCalledWith(s.workspaces.p.tabs[0].id);
  });

  it("opens the profile dialog for a new or edited profile", () => {
    void find(state(), "new-connection").run();
    expect(profiles.openProfileDialog).toHaveBeenLastCalledWith({ mode: "new" });
    void find(state(), "edit-connection").run();
    expect(profiles.openProfileDialog).toHaveBeenLastCalledWith({ mode: "edit", id: "p" });
  });

  it("switches to Go to Connection and asks for updates manually", () => {
    void find(state(), "go-to-connection").run();
    expect(palette.openPalette).toHaveBeenCalledWith("connections");
    void find(state(), "check-updates").run();
    expect(updates.checkForUpdates).toHaveBeenCalledWith({ manual: true });
  });
});
