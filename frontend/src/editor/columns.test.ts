import { type Completion, CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { PostgreSQL, SQLite, sql } from "@codemirror/lang-sql";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { CompletionSchema, Engine } from "@/lib/types";
import { columnCompletionSource } from "./columns";

const pg: CompletionSchema = {
  "default-schema": "public",
  schemas: {
    public: {
      customers: ["id", "name", "email"],
      orders: ["id", "customer_id", "total", "order"],
      mixed: ["low"],
      Mixed: ["Col", 'a"b'],
    },
    sales: { orders: ["id", "region"], leads: ["id"] },
    other: { leads: ["id", "source"] },
  },
};

const lite: CompletionSchema = {
  "default-schema": "main",
  schemas: { main: { Mixed: ["Col", "autoincrement", "notnull"] } },
};

interface Opts {
  engine?: Engine;
  schema?: CompletionSchema;
  explicit?: boolean;
}

// The source's result with the cursor at ▮.
function complete(text: string, { engine = "postgres", schema, explicit = false }: Opts = {}) {
  const pos = text.indexOf("▮");
  const doc = text.replace("▮", "");
  const dialect = engine === "sqlite" ? SQLite : PostgreSQL;
  const state = EditorState.create({ doc, extensions: [sql({ dialect })] });
  ensureSyntaxTree(state, doc.length, 5000);
  const source = columnCompletionSource(schema ?? (engine === "sqlite" ? lite : pg), engine);
  return source(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
}

const labels = (r: CompletionResult | null) => r?.options.map((o) => o.label);
const option = (r: CompletionResult | null, label: string) => r?.options.find((o) => o.label === label) as Completion;

describe("columnCompletionSource", () => {
  it("offers the columns of the table in FROM", () => {
    const r = complete("select em▮ from customers");
    expect(labels(r)).toEqual(["id", "name", "email"]);
    expect(r?.from).toBe(7);
    expect(option(r, "email")).toMatchObject({ type: "property", detail: "customers", boost: 5 });
    expect(option(r, "email").apply).toBeUndefined();
  });

  it("answers before and after FROM, and in WHERE, ORDER BY, GROUP BY and ON", () => {
    const cols = ["id", "name", "email"];
    expect(labels(complete("select ▮ from customers", { explicit: true }))).toEqual(cols);
    expect(labels(complete("select id, na▮ from customers"))).toEqual(cols);
    expect(labels(complete("select * from customers where em▮"))).toEqual(cols);
    expect(labels(complete("select * from customers where id = 1 and na▮"))).toEqual(cols);
    expect(labels(complete("select * from customers order by na▮"))).toEqual(cols);
    expect(labels(complete("select count(*) from customers group by na▮"))).toEqual(cols);
    expect(labels(complete("select * from customers c join orders o on c.id = cu▮"))).toEqual([
      ...cols,
      "customer_id",
      "total",
      "order",
    ]);
  });

  it("offers both sides of a join, a shared column once", () => {
    const r = complete("select ▮ from customers c join orders as o on o.customer_id = c.id", { explicit: true });
    expect(labels(r)).toEqual(["id", "name", "email", "customer_id", "total", "order"]);
    expect(option(r, "id").detail).toBe("customers, orders");
    expect(option(r, "total").detail).toBe("orders");
  });

  it("reads tables from a comma-separated FROM", () => {
    expect(labels(complete("select ▮ from customers c, sales.orders", { explicit: true }))).toEqual([
      "id",
      "name",
      "email",
      "region",
    ]);
  });

  it("resolves schema.table and quoted names", () => {
    expect(labels(complete("select re▮ from sales.orders"))).toEqual(["id", "region"]);
    expect(labels(complete('select re▮ from "sales"."orders"'))).toEqual(["id", "region"]);
    const r = complete('select ▮ from "Mixed"', { explicit: true });
    expect(labels(r)).toEqual(["Col", 'a"b']);
    expect(option(r, "Col").apply).toBe('"Col"');
    expect(option(r, 'a"b').apply).toBe('"a""b"');
  });

  it("folds unquoted names to lower case on Postgres", () => {
    expect(labels(complete("select ▮ from Mixed", { explicit: true }))).toEqual(["low"]);
    expect(labels(complete("select ▮ from MIXED", { explicit: true }))).toEqual(["low"]);
    expect(labels(complete("select ▮ from Public.Customers", { explicit: true }))).toEqual(["id", "name", "email"]);
  });

  it("matches unquoted names case-insensitively on SQLite", () => {
    const r = complete("select ▮ from MIXED", { engine: "sqlite", explicit: true });
    expect(labels(r)).toEqual(["Col", "autoincrement", "notnull"]);
    expect(option(r, "Col").apply).toBe('"Col"');
    expect(option(r, "autoincrement").apply).toBe('"autoincrement"');
    expect(option(r, "notnull").apply).toBe('"notnull"');
  });

  it("quotes reserved words by the engine's list", () => {
    expect(option(complete("select ▮ from orders", { explicit: true }), "order").apply).toBe('"order"');
    const r = complete('select ▮ from "Mixed"', { schema: lite, explicit: true });
    expect(option(r, "autoincrement").apply).toBeUndefined();
    // Reserved ("can be function or type") in PostgreSQL's Appendix C.
    expect(option(r, "notnull").apply).toBe('"notnull"');
  });

  it("prefers the default schema, skips unknown and ambiguous tables", () => {
    expect(labels(complete("select ▮ from orders", { explicit: true }))).toEqual(["id", "customer_id", "total", "order"]);
    expect(labels(complete("select ▮ from nope, customers", { explicit: true }))).toEqual(["id", "name", "email"]);
    expect(complete("select ▮ from leads", { explicit: true })).toBeNull();
    expect(labels(complete("select ▮ from other.leads", { explicit: true }))).toEqual(["id", "source"]);
  });

  it("reads a keyword-like table name", () => {
    const schema: CompletionSchema = { "default-schema": "public", schemas: { public: { user: ["login"] } } };
    expect(labels(complete("select ▮ from user", { schema, explicit: true }))).toEqual(["login"]);
  });

  it("scopes a subquery to its own tables", () => {
    expect(labels(complete("select * from customers where id in (select cu▮ from orders)"))).toEqual([
      "id",
      "customer_id",
      "total",
      "order",
    ]);
    expect(labels(complete("select na▮ from customers where id in (select customer_id from orders)"))).toEqual([
      "id",
      "name",
      "email",
    ]);
    expect(complete("select ▮ from (select id from orders) x", { explicit: true })).toBeNull();
  });

  it("keeps a compound query's SELECTs apart", () => {
    expect(labels(complete("select * from customers union select cu▮ from orders"))).toEqual([
      "id",
      "customer_id",
      "total",
      "order",
    ]);
    expect(labels(complete("select na▮ from customers union all select id from orders"))).toEqual([
      "id",
      "name",
      "email",
    ]);
  });

  it("reads past ONLY and LATERAL", () => {
    expect(labels(complete("select e▮ from only customers"))).toEqual(["id", "name", "email"]);
    expect(labels(complete("update only customers set na▮"))).toEqual(["id", "name", "email"]);
  });

  it("answers in UPDATE ... SET and an INSERT column list", () => {
    expect(labels(complete("update customers set na▮"))).toEqual(["id", "name", "email"]);
    expect(labels(complete("update customers set ▮", { explicit: true }))).toEqual(["id", "name", "email"]);
    expect(labels(complete("insert into orders (▮", { explicit: true }))).toEqual([
      "id",
      "customer_id",
      "total",
      "order",
    ]);
    expect(labels(complete("insert into orders (id, to▮)"))).toEqual(["id", "customer_id", "total", "order"]);
  });

  it("stays out of qualified names, strings, comments and table positions", () => {
    expect(complete("select customers.▮ from customers", { explicit: true })).toBeNull();
    expect(complete("select customers.na▮ from customers")).toBeNull();
    expect(complete("select 'em▮' from customers")).toBeNull();
    expect(complete("select -- em▮\n from customers")).toBeNull();
    expect(complete("select /* em▮ */ 1 from customers")).toBeNull();
    expect(complete("select * from cu▮")).toBeNull();
    expect(complete("select * from ▮", { explicit: true })).toBeNull();
    expect(complete("select * from customers join or▮")).toBeNull();
    expect(complete("select * from customers, or▮")).toBeNull();
    expect(complete("update cu▮")).toBeNull();
    expect(complete("insert into or▮")).toBeNull();
    expect(complete("select ▮ from customers")).toBeNull();
  });

  it("keeps statements apart", () => {
    expect(labels(complete("select * from customers; select ▮ from sales.leads", { explicit: true }))).toEqual(["id"]);
    expect(complete("select ▮; select * from customers", { explicit: true })).toBeNull();
  });

  it("starts at the quote inside a quoted name", () => {
    const r = complete('select "Co▮" from "Mixed"');
    expect(r?.from).toBe(7);
    expect(r?.to).toBe(11);
    expect(labels(r)).toEqual(['"Col"', '"a""b"']);
    expect(option(r, '"Col"').apply).toBeUndefined();
  });
});
