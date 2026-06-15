import { describe, expect, test } from "vitest";
import type { SourceFile } from "../../src/core/schema.js";
import { extractRust } from "../../src/core/extractors/rust.js";

function sourceFile(text: string): SourceFile {
  return {
    absolutePath: "/repo/pydantic-core/src/serializers/computed_fields.rs",
    relativePath: "pydantic-core/src/serializers/computed_fields.rs",
    language: "rust",
    role: "source",
    text
  };
}

describe("extractRust", () => {
  test("extracts structs, free functions, impl methods, and chunks", () => {
    const result = extractRust(
      sourceFile(`pub struct ComputedFields {
    fields: Vec<String>,
}

impl ComputedFields {
    pub fn new() -> Self {
        Self { fields: vec![] }
    }

    pub fn serialize(&self) {
        self.serialize_item();
    }
}

fn helper() {
    ComputedFields::new();
}
`)
    );

    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual([
      {
        name: "pydantic-core/src/serializers/computed_fields.rs",
        qualifiedName: "pydantic-core/src/serializers/computed_fields.rs",
        kind: "module",
        parentSymbolName: undefined
      },
      {
        name: "ComputedFields",
        qualifiedName: "ComputedFields",
        kind: "class",
        parentSymbolName: "pydantic-core/src/serializers/computed_fields.rs"
      },
      {
        name: "new",
        qualifiedName: "ComputedFields.new",
        kind: "method",
        parentSymbolName: "ComputedFields"
      },
      {
        name: "serialize",
        qualifiedName: "ComputedFields.serialize",
        kind: "method",
        parentSymbolName: "ComputedFields"
      },
      {
        name: "helper",
        qualifiedName: "helper",
        kind: "function",
        parentSymbolName: "pydantic-core/src/serializers/computed_fields.rs"
      }
    ]);

    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "ComputedFields.serialize",
          text: expect.stringContaining("pub fn serialize")
        })
      ])
    );
  });
});
