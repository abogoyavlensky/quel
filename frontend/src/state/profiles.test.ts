import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";

const api = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  testConnection: vi.fn(),
  connect: vi.fn(),
  closeDb: vi.fn(),
  openDb: vi.fn(),
  closeSession: vi.fn(),
}));
vi.mock("@/lib/api", () => api);
vi.mock("@/editor/states", () => ({
  currentInput: () => ({ text: "", selection: { from: 0, to: 0 } }),
  dropState: () => {},
}));

const { store, initialState } = await import("./store");
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

beforeEach(() => {
  vi.resetAllMocks();
  store.setState(initialState());
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

  it("saving reloads the list and updates the open connection's name and colour", async () => {
    store.setState({ conn: { connId: "c1", engine: "postgres", label: "P a", profileId: "a", color: "green" } });
    api.saveProfile.mockResolvedValue(p("a", { name: "Renamed", color: "red" }));
    api.listProfiles.mockResolvedValue([p("a", { name: "Renamed", color: "red" })]);
    await profiles.saveProfile({ ...p("a"), name: "Renamed" });
    expect(api.listProfiles).toHaveBeenCalled();
    expect(store.getState().conn).toMatchObject({ label: "Renamed", color: "red" });
  });

  it("deleting the connected profile disconnects first", async () => {
    store.setState({ conn: { connId: "c1", engine: "postgres", label: "P a", profileId: "a", color: "green" } });
    const order: string[] = [];
    api.closeDb.mockImplementation(async () => void order.push("close"));
    api.deleteProfile.mockImplementation(async () => void order.push("delete"));
    api.listProfiles.mockResolvedValue([]);
    await profiles.deleteProfile("a");
    expect(order).toEqual(["close", "delete"]);
    expect(store.getState().conn).toBeNull();
  });

  it("deleting another profile leaves the connection open", async () => {
    store.setState({ conn: { connId: "c1", engine: "postgres", label: "P a", profileId: "a", color: "green" } });
    api.listProfiles.mockResolvedValue([]);
    await profiles.deleteProfile("b");
    expect(api.closeDb).not.toHaveBeenCalled();
    expect(store.getState().conn?.connId).toBe("c1");
  });

  it("connecting a profile takes its colour and id", async () => {
    store.setState({ profiles: [p("a", { color: "purple" })] });
    api.connect.mockResolvedValue({ "conn-id": "c9", engine: "postgres", label: "P a", "profile-id": "a" });
    await runner.connectProfile("a");
    expect(store.getState().conn).toEqual({
      connId: "c9",
      engine: "postgres",
      label: "P a",
      profileId: "a",
      color: "purple",
    });
  });

  it("a failed connect says why", async () => {
    api.connect.mockRejectedValue(new Error("password authentication failed"));
    await runner.connectProfile("a");
    expect(store.getState().conn).toBeNull();
    expect(store.getState().dbError).toBe("password authentication failed");
  });

  it("the dialog opens and closes", () => {
    profiles.openProfileDialog({ mode: "edit", id: "a" });
    expect(store.getState().profileDialog).toEqual({ mode: "edit", id: "a" });
    profiles.closeProfileDialog();
    expect(store.getState().profileDialog).toBeNull();
  });
});
