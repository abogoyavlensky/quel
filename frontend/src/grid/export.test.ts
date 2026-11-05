import { describe, expect, it } from "vitest";
import type { Cell, Column } from "@/lib/types";
import {
  CHUNK_UNITS,
  EXTENSIONS,
  type ExportChunk,
  type ExportFormat,
  collectChunks,
  formatChunks,
  toCsv,
  toJson,
  toMarkdown,
} from "./export";

const col = (name: string, type = "TEXT"): Column => ({ name, type });

describe("toCsv", () => {
  const cols = [col("id", "INT4"), col("name")];

  it("writes a header and one record per row, each ended by CRLF", () => {
    expect(toCsv(cols, [[1, "ann"], [2, "bob"]], ",")).toBe("id,name\r\n1,ann\r\n2,bob\r\n");
  });

  it("is just the header for no rows", () => {
    expect(toCsv(cols, [], ",")).toBe("id,name\r\n");
  });

  it("quotes fields with the separator, a quote, a CR or an LF", () => {
    const rows: Cell[][] = [[1, "a,b"], [2, 'say "hi"'], [3, "x\ny"], [4, "x\ry"]];
    expect(toCsv(cols, rows, ",")).toBe(
      'id,name\r\n1,"a,b"\r\n2,"say ""hi"""\r\n3,"x\ny"\r\n4,"x\ry"\r\n',
    );
  });

  it("quotes header names too, and keeps repeated names", () => {
    expect(toCsv([col("a,b"), col("a,b")], [[1, 2]], ",")).toBe('"a,b","a,b"\r\n1,2\r\n');
  });

  it("writes NULL as nothing, booleans and numbers plainly", () => {
    expect(toCsv([col("a"), col("b"), col("c"), col("d")], [[null, true, false, 1.5]], ",")).toBe(
      "a,b,c,d\r\n,true,false,1.5\r\n",
    );
  });

  it("separates with a semicolon or a tab, and then a comma is not quoted", () => {
    const rows: Cell[][] = [[1, "a,b"], [2, "a;b"], [3, "a\tb"]];
    expect(toCsv(cols, rows, ";")).toBe('id;name\r\n1;a,b\r\n2;"a;b"\r\n3;a\tb\r\n');
    expect(toCsv(cols, rows, "\t")).toBe('id\tname\r\n1\ta,b\r\n2\ta;b\r\n3\t"a\tb"\r\n');
  });
});

describe("toJson", () => {
  it("is an array of objects with two-space indent", () => {
    expect(toJson([col("id", "INT4"), col("name")], [[1, "ann"], [2, null]])).toBe(
      ['[', '  {', '    "id": 1,', '    "name": "ann"', '  },', '  {', '    "id": 2,', '    "name": null', '  }', ']'].join("\n"),
    );
  });

  it("is [] for no rows", () => {
    expect(toJson([col("id")], [])).toBe("[]");
  });

  it("dedups keys like rowAsJson", () => {
    expect(JSON.parse(toJson([col("id"), col("id"), col("id_2")], [[1, 2, 3]]))).toEqual([
      { id: 1, id_3: 2, id_2: 3 },
    ]);
  });

  it("keeps a column named __proto__ as a key", () => {
    const out = toJson([col("__proto__")], [[1]]);
    expect(out).toContain('"__proto__": 1');
    expect(Object.keys(JSON.parse(out)[0])).toEqual(["__proto__"]);
  });

  it("keeps big-integer strings as strings", () => {
    expect(JSON.parse(toJson([col("n", "INT8")], [["12345678901234567890"]]))).toEqual([
      { n: "12345678901234567890" },
    ]);
  });

  it("puts a valid JSON-typed cell in raw, digits intact, indented under its key", () => {
    const out = toJson([col("id", "INT4"), col("doc", "JSONB")], [[1, '{"n":12345678901234567890,"a":[1]}']]);
    expect(out).toBe(
      [
        "[",
        "  {",
        '    "id": 1,',
        '    "doc": {',
        '      "n": 12345678901234567890,',
        '      "a": [',
        "        1",
        "      ]",
        "    }",
        "  }",
        "]",
      ].join("\n"),
    );
    expect(JSON.parse(out)).toHaveLength(1);
  });

  it("puts a document too big to re-indent in as written, not as a string", () => {
    const deep = "[".repeat(50_000) + "]".repeat(50_000);
    expect(toJson([col("doc", "JSON")], [[deep]])).toContain(`"doc": ${deep}`);
  });

  it("puts an invalid JSON-typed cell in as a string", () => {
    expect(JSON.parse(toJson([col("doc", "JSON")], [["{not json"]]))).toEqual([{ doc: "{not json" }]);
  });

  it("keeps a TEXT cell that looks like JSON a string", () => {
    expect(JSON.parse(toJson([col("t")], [['{"a":1}']]))).toEqual([{ t: '{"a":1}' }]);
  });

  it("puts a NULL JSON-typed cell in as null", () => {
    expect(JSON.parse(toJson([col("doc", "JSONB")], [[null]]))).toEqual([{ doc: null }]);
  });

  it("parses back whatever goes in", () => {
    const cols = [col("a", "JSON"), col("b"), col("c", "BOOL")];
    const rows: Cell[][] = [['[1,{"x":null}]', 'q"\n\\', true], ["2", null, false]];
    expect(JSON.parse(toJson(cols, rows))).toEqual([
      { a: [1, { x: null }], b: 'q"\n\\', c: true },
      { a: 2, b: null, c: false },
    ]);
  });
});

describe("toMarkdown", () => {
  it("writes a header, a delimiter aligned by type, and a line per row", () => {
    expect(toMarkdown([col("id", "INT4"), col("name")], [[1, "ann"], [2, "bob"]])).toBe(
      "| id | name |\n| ---: | --- |\n| 1 | ann |\n| 2 | bob |\n",
    );
  });

  it("is a header and a delimiter for no rows", () => {
    expect(toMarkdown([col("id", "INT4")], [])).toBe("| id |\n| ---: |\n");
  });

  it("escapes backslashes and pipes, in names too", () => {
    expect(toMarkdown([col("a|b")], [["x|y"], ["c:\\d"]])).toBe("| a\\|b |\n| --- |\n| x\\|y |\n| c:\\\\d |\n");
  });

  it("turns line breaks into <br>", () => {
    expect(toMarkdown([col("t")], [["a\nb"], ["a\r\nb"]])).toBe("| t |\n| --- |\n| a<br>b |\n| a<br>b |\n");
  });

  it("writes NULL as *NULL*, so it differs from the text NULL", () => {
    expect(toMarkdown([col("t")], [[null], ["NULL"]])).toBe("| t |\n| --- |\n| *NULL* |\n| NULL |\n");
  });

  it("writes booleans and numbers plainly", () => {
    expect(toMarkdown([col("a", "BOOL"), col("b", "FLOAT8")], [[true, 1.5]])).toBe(
      "| a | b |\n| --- | ---: |\n| true | 1.5 |\n",
    );
  });
});

describe("EXTENSIONS", () => {
  it("has an extension per format", () => {
    expect(EXTENSIONS).toEqual({ csv: "csv", json: "json", markdown: "md" });
  });
});

describe("formatChunks", () => {
  const cols = [col("id", "INT4"), col("name")];
  const rows: Cell[][] = Array.from({ length: 50 }, (_, i) => [i, `customer ${i}`]);
  const texts = (chunks: Iterable<ExportChunk>) => [...chunks].map((c) => c.text);

  it.each<[ExportFormat, string]>([
    ["csv", toCsv(cols, rows, ";")],
    ["json", toJson(cols, rows)],
    ["markdown", toMarkdown(cols, rows)],
  ])("joins to the whole %s, at any size", (format, whole) => {
    expect(texts(formatChunks(format, cols, rows, ";")).join("")).toBe(whole);
    expect(texts(formatChunks(format, cols, rows, ";", 16)).join("")).toBe(whole);
  });

  it("counts the rows up to all of them", () => {
    const counts = [...formatChunks("csv", cols, rows, ",", 64)].map((c) => c.rows);
    expect(counts.length).toBeGreaterThan(1);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts.at(-1)).toBe(50);
  });

  it("has a chunk for an empty result", () => {
    expect([...formatChunks("json", cols, [], ",")]).toEqual([{ text: "[]", rows: 0 }]);
    expect([...formatChunks("csv", cols, [], ",")]).toEqual([{ text: "id,name\r\n", rows: 0 }]);
    expect([...formatChunks("markdown", cols, [], ",")]).toHaveLength(1);
  });

  it("cuts a cell longer than a chunk", () => {
    const chunks = [...formatChunks("csv", [col("a")], [["x".repeat(100)]], ",", 8)];
    expect(chunks.every((c) => c.text.length <= 8)).toBe(true);
    expect(chunks.map((c) => c.text).join("")).toBe(`a\r\n${"x".repeat(100)}\r\n`);
    expect(chunks.at(-1)?.rows).toBe(1);
  });

  it("never cuts a surrogate pair", () => {
    const text = "😀".repeat(10);
    for (const size of [2, 3, 4, 5]) {
      const chunks = texts(formatChunks("csv", [col("a")], [[text]], ",", size));
      expect(chunks.join("")).toBe(`a\r\n${text}\r\n`);
      for (const c of chunks) {
        expect(c).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
      }
    }
  });

  it("stays under the bridge's cap for the worst text", () => {
    const worst = JSON.stringify("\u0001".repeat(CHUNK_UNITS));
    expect(new TextEncoder().encode(worst).length).toBeLessThan(64 * 1024 * 1024);
  });
});

describe("collectChunks", () => {
  it("gathers the texts and reports the rows", async () => {
    const seen: number[] = [];
    const chunks = [
      { text: "a", rows: 2 },
      { text: "b", rows: 5 },
    ];
    const { signal } = new AbortController();
    expect(await collectChunks(chunks, (n) => seen.push(n), signal)).toEqual(["a", "b"]);
    expect(seen).toEqual([0, 2, 5]);
  });

  it("stops when canceled", async () => {
    const controller = new AbortController();
    const chunks = [
      { text: "a", rows: 2 },
      { text: "b", rows: 5 },
    ];
    const texts = await collectChunks(
      chunks,
      (n) => {
        if (n === 2) controller.abort();
      },
      controller.signal,
    );
    expect(texts).toEqual(["a"]);
  });
});
