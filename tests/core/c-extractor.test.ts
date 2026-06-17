import { describe, expect, test } from "vitest";
import { extractC } from "../../src/core/extractors/c.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "src/cache.c", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "c",
    role,
    text
  };
}

describe("extractC", () => {
  test("extracts includes, macros, typedefs, structs, functions, chunks, and calls", () => {
    const result = extractC(
      sourceFile(`#include "cache.h"
#include <string.h>

#define CACHE_FOREACH(entry, cache) for ((entry) = (cache)->head; (entry); (entry) = (entry)->next)

typedef enum {
    CACHE_OK,
    CACHE_MISS
} CacheStatus;

typedef struct CacheEntry {
    const char *key;
    struct CacheEntry *next;
} CacheEntry;

typedef int (*cache_visit_fn)(CacheEntry *entry);

static CacheEntry *cache_lookup(CacheEntry *head, const char *key);

CacheEntry *cache_lookup(CacheEntry *head, const char *key) {
    if (strcmp(head->key, key) == 0) {
        return head;
    }
    return cache_miss(key);
}

void cache_walk(CacheEntry *entry, cache_visit_fn visitor) {
    CACHE_FOREACH(entry, entry) {
        visitor(entry);
    }
}
`)
    );

    expect(
      result.symbols.map((symbol) => ({
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        kind: symbol.kind,
        parentSymbolName: symbol.parentSymbolName
      }))
    ).toEqual([
      { name: "src/cache.c", qualifiedName: "src/cache.c", kind: "module", parentSymbolName: undefined },
      { name: "CACHE_FOREACH", qualifiedName: "CACHE_FOREACH", kind: "typealias", parentSymbolName: "src/cache.c" },
      { name: "CacheStatus", qualifiedName: "CacheStatus", kind: "class", parentSymbolName: "src/cache.c" },
      { name: "CacheEntry", qualifiedName: "CacheEntry", kind: "class", parentSymbolName: "src/cache.c" },
      { name: "cache_visit_fn", qualifiedName: "cache_visit_fn", kind: "typealias", parentSymbolName: "src/cache.c" },
      { name: "cache_lookup", qualifiedName: "cache_lookup", kind: "function", parentSymbolName: "src/cache.c" },
      { name: "cache_walk", qualifiedName: "cache_walk", kind: "function", parentSymbolName: "src/cache.c" }
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "src/cache.c", targetName: "cache.h", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "src/cache.c", targetName: "src/cache.h", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "src/cache.c", targetName: "string.h", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "cache_lookup", targetName: "strcmp", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "cache_lookup", targetName: "cache_miss", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "cache_walk", targetName: "CACHE_FOREACH", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([expect.objectContaining({ symbolName: "cache_lookup", text: expect.stringContaining("cache_miss") })])
    );
  });

  test("extracts CMake, Meson, and Make build ownership signals", () => {
    const cmake = extractC(
      sourceFile(
        `project(cache C)
add_library(cache src/cache.c include/cache.h)
target_sources(cache PRIVATE src/cache_eviction.c)
`,
        "CMakeLists.txt"
      )
    );
    const meson = extractC(sourceFile(`executable('cache-test', 'tests/test_cache.c')\n`, "meson.build"));
    const make = extractC(sourceFile(`cache_test: tests/test_cache.o src/cache.o\n`, "Makefile"));

    expect(cmake.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ qualifiedName: "cmake.project.cache", kind: "method" }),
        expect.objectContaining({ qualifiedName: "cmake.add_library.cache", kind: "method" }),
        expect.objectContaining({ qualifiedName: "cmake.target_sources.cache", kind: "method" })
      ])
    );
    expect(cmake.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "cmake.add_library.cache", targetName: "src/cache.c", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(meson.symbols).toEqual(expect.arrayContaining([expect.objectContaining({ qualifiedName: "meson.executable.cache_test" })]));
    expect(make.symbols).toEqual(expect.arrayContaining([expect.objectContaining({ qualifiedName: "make.target.cache_test" })]));
  });

  test("extracts multi-line public C function definitions", () => {
    const result = extractC(
      sourceFile(`int sqlite3BtreeIndexMoveto(
  BtCursor *pCur,
  UnpackedRecord *pIdxKey,
  int *pRes
){
  assert(pCur);
  return moveToRoot(pCur);
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "sqlite3BtreeIndexMoveto",
          qualifiedName: "sqlite3BtreeIndexMoveto",
          kind: "function",
          startLine: 1,
          endLine: 8
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "sqlite3BtreeIndexMoveto", targetName: "moveToRoot", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
  });
});
