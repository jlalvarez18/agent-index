import { describe, expect, test } from "vitest";
import type { SourceFile } from "../../src/core/schema.js";
import { extractJson } from "../../src/core/extractors/json.js";

function sourceFile(text: string, relativePath = "src/compiler/diagnosticMessages.json"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "json",
    role: "source",
    text
  };
}

describe("extractJson", () => {
  test("indexes JSON files as searchable module chunks without fake symbols", () => {
    const result = extractJson(
      sourceFile(`{
  "Cannot_find_name_0": {
    "code": 2304,
    "category": "Error",
    "key": "TS2304"
  }
}
`)
    );

    expect(result.symbols).toEqual([
      {
        name: "src/compiler/diagnosticMessages.json",
        qualifiedName: "src/compiler/diagnosticMessages.json",
        kind: "module",
        startLine: 1,
        endLine: 7
      }
    ]);
    expect(result.chunks).toEqual([
      expect.objectContaining({
        symbolName: "src/compiler/diagnosticMessages.json",
        startLine: 1,
        endLine: 7,
        text: expect.stringContaining("TS2304")
      })
    ]);
    expect(result.edges).toEqual([]);
  });
});
