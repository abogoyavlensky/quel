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
  loadWorkspace: vi.fn(),
  saveWorkspace: vi.fn(),
  selectedProfile: vi.fn(),
  selectProfile: vi.fn(),
}));
vi.mock("@/lib/api", () => api);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
const dropped = vi.hoisted(() => [] as string[]);
vi.mock("@/editor/states", () => ({
  currentInput: () => ({ text: "", selection: { from: 0, to: 0 } }),
  dropState: (id: string) => dropped.push(id),
  seed: () => {},
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
  api.selectProfile.mockResolvedValue(undefined);
  api.selectedProfile.mockResolvedValue(null);
  api.loadWorkspace.mockResolvedValue({ tabs: [], "active-tab": null, "next-tab-number": 1, closed: [] });
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
    await profiles.restoreSelection();
    expect(store.getState().selected).toBe("a");
    expect(store.getState().workspaces.a).toMatchObject({ status: "disconnected" });
    expect(api.connect).not.toHaveBeenCalled();
  });

  it("restoring keeps a selection already made", async () => {
    store.setState({ profiles: [p("a"), p("b")] });
    void runner.selectProfile("b");
    await profiles.restoreSelection();
    expect(store.getState().selected).toBe("b");
  });

  it("restoring selects the profile saved last time, without saving it again", async () => {
    store.setState({ profiles: [p("a"), p("b")] });
    api.selectedProfile.mockResolvedValue("b");
    await profiles.restoreSelection();
    expect(store.getState().selected).toBe("b");
    expect(store.getState().workspaces.b).toBeDefined();
    expect(api.selectProfile).not.toHaveBeenCalled();
  });

  it("restoring falls back to the first profile and does not write that back", async () => {
    store.setState({ profiles: [p("a"), p("b")] });
    api.selectedProfile.mockResolvedValue("deleted");
    await profiles.restoreSelection();
    expect(store.getState().selected).toBe("a");
    api.selectedProfile.mockRejectedValue(new Error("no db"));
    store.setState({ selected: null });
    await profiles.restoreSelection();
    expect(store.getState().selected).toBe("a");
    expect(api.selectProfile).not.toHaveBeenCalled();
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

  it("a connect made while the delete runs is closed with the workspace", async () => {
    store.setState({ profiles: [p("a")], selected: "a", workspaces: { a: newWorkspace("a") } });
    api.connect.mockResolvedValue({ "conn-id": "c2", engine: "postgres", label: "P a", "profile-id": "a" });
    api.deleteProfile.mockImplementation(() => runner.connectProfile("a"));
    api.listProfiles.mockResolvedValue([]);
    await profiles.deleteProfile("a");
    expect(api.closeDb).toHaveBeenCalledWith("c2");
    expect(store.getState().workspaces.a).toBeUndefined();
  });

  it("a connect still opening when the delete ends is closed when it lands", async () => {
    store.setState({ profiles: [p("a")], selected: "a", workspaces: { a: newWorkspace("a") } });
    let land!: () => void;
    api.connect.mockReturnValue(
      new Promise((res) => {
        land = () => res({ "conn-id": "c3", engine: "postgres", label: "P a", "profile-id": "a" });
      }),
    );
    let connecting!: Promise<void>;
    api.deleteProfile.mockImplementation(async () => {
      connecting = runner.connectProfile("a");
    });
    api.listProfiles.mockResolvedValue([]);
    await profiles.deleteProfile("a");
    land();
    await connecting;
    expect(api.closeDb).toHaveBeenCalledWith("c3");
    expect(store.getState().workspaces.a).toBeUndefined();
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
