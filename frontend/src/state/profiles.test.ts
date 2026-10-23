import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";

const api = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  testConnection: vi.fn(),
  connect: vi.fn(),
  closeDb: vi.fn(),
  closeSession: vi.fn(),
}));
vi.mock("@/lib/api", () => api);
const dropped = vi.hoisted(() => [] as string[]);
vi.mock("@/editor/states", () => ({
  currentInput: () => ({ text: "", selection: { from: 0, to: 0 } }),
  dropState: (id: string) => dropped.push(id),
}));

const { store, initialState, newWorkspace } = await import("./store");
const profiles = await import("./profiles");
const runner = await import("./runner");

const p = (id: string, over: Partial<Profile> = {}): Profile => ({
  id,
  name: `P ${id}`,
  engine: "postgres",
  host: "h",
  port: 5432,
  database: null,
  user: null,
  "ssl-mode": "prefer",
  path: null,
  color: "green",
  "has-password": false,
  ...over,
});

const connected = (id: string, connId: string) => ({ ...newWorkspace(id), status: "connected" as const, connId });

beforeEach(() => {
  vi.resetAllMocks();
  dropped.length = 0;
  store.setState(initialState(), true);
  api.closeDb.mockResolvedValue(undefined);
});

describe("profiles", () => {
  it("loads the list, and keeps the error when it fails", async () => {
    api.listProfiles.mockResolvedValue([p("a")]);
    await profiles.loadProfiles();
    expect(store.getState().profiles).toEqual([p("a")]);
    api.listProfiles.mockRejectedValue(new Error("disk full"));
    await profiles.loadProfiles();
    expect(store.getState().profilesError).toBe("disk full");
  });

  it("loading alone selects nothing; restoring selects the first profile", async () => {
    api.listProfiles.mockResolvedValue([p("a"), p("b")]);
    await profiles.loadProfiles();
    expect(store.getState().selected).toBeNull();
    profiles.restoreSelection();
    expect(store.getState().selected).toBe("a");
    expect(store.getState().workspaces.a).toMatchObject({ status: "disconnected" });
    expect(api.connect).not.toHaveBeenCalled();
  });

  it("restoring keeps a selection already made", () => {
    store.setState({ profiles: [p("a"), p("b")] });
    runner.selectProfile("b");
    profiles.restoreSelection();
    expect(store.getState().selected).toBe("b");
  });

  it("saving a new profile reloads the list and selects it", async () => {
    runner.selectProfile("a");
    api.saveProfile.mockResolvedValue(p("n"));
    api.listProfiles.mockResolvedValue([p("a"), p("n")]);
    const { id: _, ...input } = p("n");
    await profiles.saveProfile(input);
    expect(store.getState().profiles.map((x) => x.id)).toEqual(["a", "n"]);
    expect(store.getState().selected).toBe("n");
  });

  it("saving an existing profile keeps the selection", async () => {
    runner.selectProfile("a");
    api.saveProfile.mockResolvedValue(p("b", { name: "Renamed" }));
    api.listProfiles.mockResolvedValue([p("a"), p("b", { name: "Renamed" })]);
    await profiles.saveProfile({ ...p("b"), name: "Renamed" });
    expect(store.getState().selected).toBe("a");
  });

  it("deleting a connected profile disconnects first and drops its workspace", async () => {
    store.setState({ profiles: [p("a"), p("b")], selected: "a", workspaces: { a: connected("a", "c1") } });
    const tabId = store.getState().workspaces.a.tabs[0].id;
    const order: string[] = [];
    api.closeDb.mockImplementation(async () => void order.push("close"));
    api.deleteProfile.mockImplementation(async () => void order.push("delete"));
    api.listProfiles.mockResolvedValue([p("b")]);
    await profiles.deleteProfile("a");
    expect(order).toEqual(["close", "delete"]);
    expect(api.closeDb).toHaveBeenCalledWith("c1");
    expect(store.getState().workspaces.a).toBeUndefined();
    expect(dropped).toEqual([tabId]);
    expect(store.getState().selected).toBe("b");
  });

  it("deleting the last profile leaves nothing selected", async () => {
    store.setState({ profiles: [p("a")], selected: "a", workspaces: { a: newWorkspace("a") } });
    api.listProfiles.mockResolvedValue([]);
    await profiles.deleteProfile("a");
    expect(api.closeDb).not.toHaveBeenCalled();
    expect(store.getState().selected).toBeNull();
  });

  it("deleting is refused while that profile connects or disconnects", async () => {
    store.setState({ workspaces: { a: { ...newWorkspace("a"), status: "connecting" } } });
    await expect(profiles.deleteProfile("a")).rejects.toThrow("Wait for the connection to finish opening.");
    store.setState({ workspaces: { a: { ...connected("a", "c1"), status: "disconnecting" } } });
    await expect(profiles.deleteProfile("a")).rejects.toThrow("Wait for the connection to finish closing.");
    expect(api.deleteProfile).not.toHaveBeenCalled();
  });

  it("deleting another profile leaves the others connected and selected", async () => {
    store.setState({
      profiles: [p("a"), p("b")],
      selected: "a",
      workspaces: { a: connected("a", "c1"), b: newWorkspace("b") },
    });
    api.listProfiles.mockResolvedValue([p("a")]);
    await profiles.deleteProfile("b");
    expect(api.closeDb).not.toHaveBeenCalled();
    expect(store.getState().workspaces.a).toMatchObject({ status: "connected", connId: "c1" });
    expect(store.getState().selected).toBe("a");
  });

  it("the dialog opens and closes", () => {
    profiles.openProfileDialog({ mode: "edit", id: "a" });
    expect(store.getState().profileDialog).toEqual({ mode: "edit", id: "a" });
    profiles.closeProfileDialog();
    expect(store.getState().profileDialog).toBeNull();
  });
});
