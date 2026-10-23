import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/types";
import { emptyForm, fileForm, fromProfile, missing, toInput, withEngine } from "./profileForm";

const saved: Profile = {
  id: "p1",
  name: "Warehouse",
  engine: "redshift",
  host: "wh.example.com",
  port: 5439,
  database: "dev",
  user: "admin",
  "ssl-mode": "require",
  path: null,
  color: "red",
  "has-password": true,
};

describe("profile form", () => {
  it("starts empty with the engine's SSL default", () => {
    expect(emptyForm().sslMode).toBe("prefer");
    expect(emptyForm("redshift").sslMode).toBe("require");
  });

  it("round-trips a saved profile, keeping its password", () => {
    const input = toInput(fromProfile(saved));
    expect(input).toEqual({
      id: "p1",
      name: "Warehouse",
      engine: "redshift",
      host: "wh.example.com",
      port: 5439,
      database: "dev",
      user: "admin",
      "ssl-mode": "require",
      path: null,
      color: "red",
    });
    expect("password" in input).toBe(false);
  });

  it("sends a typed password untrimmed, and forget over it", () => {
    const f = { ...fromProfile(saved), password: " p w " };
    expect(toInput(f).password).toBe(" p w ");
    const forget = toInput({ ...f, forgetPassword: true });
    expect(forget["forget-password"]).toBe(true);
    expect("password" in forget).toBe(false);
  });

  it("trims fields, sends a blank port as null and a number otherwise", () => {
    const f = { ...emptyForm(), name: " A ", host: " h ", port: " " };
    expect(toInput(f)).toMatchObject({ name: "A", host: "h", port: null, database: null });
    expect(toInput({ ...f, port: "6543" }).port).toBe(6543);
  });

  it("a SQLite profile sends its path and no server fields or password", () => {
    const f = { ...emptyForm("sqlite"), name: "f", path: " /x.db ", host: "h", password: "pw" };
    const input = toInput(f);
    expect(input).toMatchObject({ engine: "sqlite", path: "/x.db", host: null, port: null, "ssl-mode": null });
    expect("password" in input).toBe(false);
  });

  it("switching engine keeps what still applies", () => {
    const f = { ...emptyForm(), name: "n", color: "blue" as const, host: "h", port: "1" };
    const r = withEngine(f, "redshift");
    expect(r).toMatchObject({ name: "n", color: "blue", host: "h", port: "1", sslMode: "require" });
    expect(withEngine({ ...f, sslMode: "disable" }, "redshift").sslMode).toBe("disable");
  });

  it("names the first missing field", () => {
    expect(missing(emptyForm())).toBe("A name is required.");
    expect(missing({ ...emptyForm(), name: "n" })).toBe("A host is required.");
    expect(missing({ ...emptyForm(), name: "n", host: "h", port: "54x" })).toBe("The port must be a number.");
    expect(missing({ ...emptyForm("sqlite"), name: "n" })).toBe("A file path is required.");
    expect(missing({ ...emptyForm(), name: "n", host: "h" })).toBeNull();
  });

  it("a chosen file becomes a SQLite profile named after it", () => {
    expect(fileForm("/data/Sales Report.sqlite3")).toMatchObject({
      engine: "sqlite",
      name: "Sales Report",
      path: "/data/Sales Report.sqlite3",
    });
    expect(fileForm("/data/archive.tar")).toMatchObject({ name: "archive.tar" });
  });
});
