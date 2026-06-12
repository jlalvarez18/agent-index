import { describe, expect, test } from "vitest";
import type { SourceFile } from "../../src/core/schema.js";
import { extractPython } from "../../src/core/extractors/python.js";

function sourceFile(text: string): SourceFile {
  return {
    absolutePath: "/repo/pkg/cache.py",
    relativePath: "pkg/cache.py",
    language: "python",
    text
  };
}

describe("extractPython", () => {
  test("extracts modules, classes, functions, methods, chunks, imports, and calls", () => {
    const result = extractPython(
      sourceFile(`import os
from pkg.store import Store

class Cache:
    def get(self, key):
        return load_value(key)

def load_value(key):
    return Store().read(key)
`)
    );

    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual([
      {
        name: "pkg/cache.py",
        qualifiedName: "pkg/cache.py",
        kind: "module",
        startLine: 1,
        endLine: 9,
        parentSymbolName: undefined
      },
      {
        name: "Cache",
        qualifiedName: "Cache",
        kind: "class",
        startLine: 4,
        endLine: 6,
        parentSymbolName: "pkg/cache.py"
      },
      {
        name: "get",
        qualifiedName: "Cache.get",
        kind: "method",
        startLine: 5,
        endLine: 6,
        parentSymbolName: "Cache"
      },
      {
        name: "load_value",
        qualifiedName: "load_value",
        kind: "function",
        startLine: 8,
        endLine: 9,
        parentSymbolName: "pkg/cache.py"
      }
    ]);

    expect(result.chunks.map((chunk) => ({
      symbolName: chunk.symbolName,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text
    }))).toContainEqual({
      symbolName: "Cache.get",
      startLine: 5,
      endLine: 6,
      text: "    def get(self, key):\n        return load_value(key)"
    });

    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "pkg/cache.py",
          targetName: "os",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "pkg/cache.py",
          targetName: "pkg.store",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "pkg/cache.py",
          targetName: "Cache",
          kind: "file_contains_symbol",
          confidence: "exact"
        },
        {
          sourceSymbolName: "Cache",
          targetName: "Cache.get",
          kind: "symbol_contains_symbol",
          confidence: "exact"
        },
        {
          sourceSymbolName: "Cache.get",
          targetName: "load_value",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "load_value",
          targetName: "Store",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "load_value",
          targetName: "read",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("parses large Python files through Tree-sitter without native string argument failures", () => {
    const largeSource = Array.from({ length: 7000 }, (_, index) => `def generated_${index}():\n    return ${index}\n`).join("\n");

    const result = extractPython(sourceFile(largeSource));

    expect(result.symbols).toContainEqual(
      expect.objectContaining({
        name: "generated_6999",
        qualifiedName: "generated_6999",
        kind: "function"
      })
    );
  });

  test("extracts decorated functions and methods using the decorated source range", () => {
    const result = extractPython(
      sourceFile(`@click.command()
@click.option("--verbose")
def main(verbose):
    return verbose

class Response:
    @property
    def json(self):
        return {}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "main",
          qualifiedName: "main",
          kind: "function",
          startLine: 1,
          endLine: 4,
          parentSymbolName: "pkg/cache.py"
        }),
        expect.objectContaining({
          name: "json",
          qualifiedName: "Response.json",
          kind: "method",
          startLine: 7,
          endLine: 9,
          parentSymbolName: "Response"
        })
      ])
    );

    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "main",
          startLine: 1,
          endLine: 4,
          text: '@click.command()\n@click.option("--verbose")\ndef main(verbose):\n    return verbose'
        }),
        expect.objectContaining({
          symbolName: "Response.json",
          startLine: 7,
          endLine: 9,
          text: "    @property\n    def json(self):\n        return {}"
        })
      ])
    );
  });
});
