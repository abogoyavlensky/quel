import type { Color, Engine, Profile, ProfileInput, SslMode } from "@/lib/types";

// The profile dialog's form, as plain functions over a plain object: what
// the inputs hold (strings, so a half-typed port stays as typed), and how
// it becomes what save-profile and test-connection take. The backend
// validates again; the checks here only spare a round trip.

export interface ProfileForm {
  id: string | null; // null: a new profile
  name: string;
  engine: Engine;
  host: string;
  port: string; // blank: the engine's default
  database: string;
  user: string;
  password: string; // blank: keep the saved one (or none, for a new profile)
  forgetPassword: boolean;
  sslMode: SslMode;
  path: string;
  color: Color;
  hasPassword: boolean; // a password is saved for this profile
}

export const ENGINES: { value: Engine; label: string }[] = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "redshift", label: "Redshift" },
  { value: "sqlite", label: "SQLite" },
];

export const SSL_MODES: SslMode[] = ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"];

export const COLORS: Color[] = ["none", "red", "orange", "yellow", "green", "blue", "purple"];

export const DEFAULT_PORT: Record<Engine, number | null> = { postgres: 5432, redshift: 5439, sqlite: null };

export function defaultSslMode(engine: Engine): SslMode {
  return engine === "redshift" ? "require" : "prefer";
}

export function emptyForm(engine: Engine = "postgres"): ProfileForm {
  return {
    id: null,
    name: "",
    engine,
    host: "",
    port: "",
    database: "",
    user: "",
    password: "",
    forgetPassword: false,
    sslMode: defaultSslMode(engine),
    path: "",
    color: "none",
    hasPassword: false,
  };
}

// A new SQLite profile for the file at path, named after the file.
export function fileForm(path: string): ProfileForm {
  const name =
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.(db|sqlite3?)$/i, "") || path;
  return { ...emptyForm("sqlite"), name, path };
}

export function fromProfile(p: Profile): ProfileForm {
  return {
    id: p.id,
    name: p.name,
    engine: p.engine,
    host: p.host ?? "",
    port: p.port === null ? "" : String(p.port),
    database: p.database ?? "",
    user: p.user ?? "",
    password: "",
    forgetPassword: false,
    sslMode: p["ssl-mode"] ?? defaultSslMode(p.engine),
    path: p.path ?? "",
    color: p.color,
    hasPassword: p["has-password"],
  };
}

// Switch the engine, keeping what still applies: the name, the colour,
// and the server fields between PostgreSQL and Redshift. An SSL mode left
// at the old engine's default moves to the new one's.
export function withEngine(form: ProfileForm, engine: Engine): ProfileForm {
  const sslMode = form.sslMode === defaultSslMode(form.engine) ? defaultSslMode(engine) : form.sslMode;
  return { ...form, engine, sslMode };
}

// The first required field that is empty, as a message, or null.
export function missing(form: ProfileForm): string | null {
  if (!form.name.trim()) return "A name is required.";
  if (form.engine === "sqlite") return form.path.trim() ? null : "A file path is required.";
  if (!form.host.trim()) return "A host is required.";
  if (form.port.trim() && !/^\d+$/.test(form.port.trim())) return "The port must be a number.";
  return null;
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

// What the backend takes. Fields the engine does not use are sent as null.
// The password goes as typed, untrimmed, and only when one was typed.
export function toInput(form: ProfileForm): ProfileInput {
  const server = form.engine !== "sqlite";
  const input: ProfileInput = {
    name: form.name.trim(),
    engine: form.engine,
    host: server ? orNull(form.host) : null,
    port: server && form.port.trim() ? Number(form.port.trim()) : null,
    database: server ? orNull(form.database) : null,
    user: server ? orNull(form.user) : null,
    "ssl-mode": server ? form.sslMode : null,
    path: server ? null : orNull(form.path),
    color: form.color,
  };
  if (form.id) input.id = form.id;
  if (server && form.forgetPassword) input["forget-password"] = true;
  else if (server && form.password !== "") input.password = form.password;
  return input;
}
