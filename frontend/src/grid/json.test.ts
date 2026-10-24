import { describe, expect, it } from "vitest";
import type { Column } from "@/lib/types";
import { MAX_JSON_CHARS, isJsonType, jsonText, reindent, rowAsJson } from "./json";

describe("reindent", () => {
  it("indents objects and arrays by two spaces, keeping empty ones compact", () => {
    expect(reindent('{"a":1,"b":[1,2],"c":{},"d":[]}')).toBe(
      ["{", '  "a": 1,', '  "b": [', "    1,", "    2", "  ],", '  "c": {},', '  "d": []', "}"].join("\n"),
    );
  });

  it("treats empty brackets with whitespace inside as empty", () => {
    expect(reindent("{ }")).toBe("{}");
    expect(reindent("[\n]")).toBe("[]");
  });

  it("nests arrays of objects", () => {
    expect(reindent('[{"a":[{"b":null}]}]')).toBe(
      ["[", "  {", '    "a": [', "      {", '        "b": null', "      }", "    ]", "  }", "]"].join("\n"),
    );
  });

  it("copies strings verbatim, brackets, commas, colons and escapes included", () => {
    const s = String.raw`{"k{,:}":"a,b:{c}[d] \"q\" \\ é"}`;
    expect(reindent(s)).toBe(["{", String.raw`  "k{,:}": "a,b:{c}[d] \"q\" \\ é"`, "}"].join("\n"));
  });

  it("keeps numbers as written", () => {
    expect(reindent("[12345678901234567890,1.10,1e400,-0.0,true,false,null]")).toBe(
      ["[", "  12345678901234567890,", "  1.10,", "  1e400,", "  -0.0,", "  true,", "  false,", "  null", "]"].join("\n"),
    );
  });

  it("leaves a scalar alone", () => {
    expect(reindent('"x"')).toBe('"x"');
    expect(reindent("42")).toBe("42");
    expect(reindent("  42 ")).toBe("42");
  });

  it("normalises text that is already pretty", () => {
    expect(reindent('{\n\t"a" :  [ 1 ,\n 2 ]\r\n}')).toBe(reindent('{"a":[1,2]}'));
  });

  it("gives up once the output passes the limit", () => {
    expect(reindent("[[[1]]]", 10)).toBeNull();
    const deep = "[".repeat(50_000) + "]".repeat(50_000);
    expect(reindent(deep)).toBeNull();
  });
});

describe("isJsonType", () => {
  it("knows the JSON types", () => {
    for (const t of ["JSON", "jsonb", "SUPER"]) expect(isJsonType(t)).toBe(true);
    for (const t of ["_JSONB", "TEXT", ""]) expect(isJsonType(t)).toBe(false);
  });
});

describe("jsonText", () => {
  it("formats a JSON-typed string", () => {
    expect(jsonText('{"a":1}', "JSONB", "postgres")).toBe('{\n  "a": 1\n}');
  });

  it("is null for cells that are not strings", () => {
    expect(jsonText(1, "JSONB", "postgres")).toBeNull();
    expect(jsonText(true, "JSON", "postgres")).toBeNull();
    expect(jsonText(null, "JSON", "postgres")).toBeNull();
  });

  it("sniffs text for JSON in SQLite only", () => {
    expect(jsonText('{"a":1}', "TEXT", "sqlite")).toBe('{\n  "a": 1\n}');
    expect(jsonText(' [1]', "", "sqlite")).toBe("[\n  1\n]");
    expect(jsonText('{"a":1}', "TEXT", "postgres")).toBeNull();
    expect(jsonText('"x"', "TEXT", "sqlite")).toBeNull();
    expect(jsonText("x {}", "TEXT", "sqlite")).toBeNull();
  });

  it("is null for text that does not parse", () => {
    expect(jsonText("{not json", "TEXT", "sqlite")).toBeNull();
    expect(jsonText("{not json", "JSON", "postgres")).toBeNull();
  });

  it("is null past the size caps", () => {
    const big = `[${'"x",'.repeat(MAX_JSON_CHARS / 4)}"x"]`;
    expect(jsonText(big, "JSON", "postgres")).toBeNull();
    const deep = "[".repeat(50_000) + "]".repeat(50_000);
    expect(jsonText(deep, "JSON", "postgres")).toBeNull();
  });
});

describe("rowAsJson", () => {
  const col = (name: string): Column => ({ name, type: "TEXT" });

  it("maps column names to cells", () => {
    const out = rowAsJson([col("id"), col("name"), col("gone")], ["12345678901234567890", "ann", null]);
    expect(JSON.parse(out)).toEqual({ id: "12345678901234567890", name: "ann", gone: null });
  });

  it("suffixes repeated names, skipping ones already taken", () => {
    expect(JSON.parse(rowAsJson([col("id"), col("id")], [1, 2]))).toEqual({ id: 1, id_2: 2 });
    expect(JSON.parse(rowAsJson([col("id"), col("id_2"), col("id")], [1, 2, 3]))).toEqual({ id: 1, id_2: 2, id_3: 3 });
  });
});
