import { describe, expect, test } from "vitest";
import type { SourceFile } from "../../src/core/schema.js";
import { extractGo } from "../../src/core/extractors/go.js";

function sourceFile(text: string, relativePath = "pkg/server/handler.go", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "go",
    role,
    text
  };
}

describe("extractGo", () => {
  test("extracts packages, imports, interfaces, structs, functions, methods, chunks, and calls", () => {
    const result = extractGo(
      sourceFile(`package server

import (
    "context"
    "fmt"

    "github.com/acme/project/pkg/store"
)

type Loader interface {
    Load(context.Context, string) (store.Record, error)
}

type Handler struct {
    loader Loader
}

func NewHandler(loader Loader) *Handler {
    return &Handler{loader: loader}
}

func (h *Handler) Serve(ctx context.Context, key string) error {
    record, err := h.loader.Load(ctx, key)
    if err != nil {
        return fmt.Errorf("load record %s: %w", key, err)
    }
    return writeRecord(record)
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
        name: "pkg/server/handler.go",
        qualifiedName: "pkg/server/handler.go",
        kind: "module",
        parentSymbolName: undefined
      },
      {
        name: "Loader",
        qualifiedName: "Loader",
        kind: "class",
        parentSymbolName: "pkg/server/handler.go"
      },
      {
        name: "Handler",
        qualifiedName: "Handler",
        kind: "class",
        parentSymbolName: "pkg/server/handler.go"
      },
      {
        name: "NewHandler",
        qualifiedName: "NewHandler",
        kind: "function",
        parentSymbolName: "pkg/server/handler.go"
      },
      {
        name: "Serve",
        qualifiedName: "Handler.Serve",
        kind: "method",
        parentSymbolName: "Handler"
      }
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "pkg/server/handler.go",
          targetName: "context",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "pkg/server/handler.go",
          targetName: "github.com/acme/project/pkg/store",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "Handler.Serve",
          targetName: "Load",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Handler.Serve",
          targetName: "Errorf",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Handler.Serve",
          targetName: "writeRecord",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );

    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "Handler.Serve",
          startLine: 22,
          endLine: 28,
          text: expect.stringContaining('fmt.Errorf("load record %s: %w"')
        })
      ])
    );
  });

  test("extracts table tests and subtests as navigable test symbols", () => {
    const result = extractGo(
      sourceFile(
        `package server

import "testing"

func TestServe(t *testing.T) {
    tests := []struct {
        name string
        key string
    }{
        {name: "missing record", key: "missing"},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            handler := NewHandler(fakeLoader{})
            if err := handler.Serve(t.Context(), tt.key); err == nil {
                t.Fatal("expected error")
            }
        })
    }
}
`,
        "pkg/server/handler_test.go",
        "test"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "TestServe",
          qualifiedName: "TestServe",
          kind: "function",
          parentSymbolName: "pkg/server/handler_test.go"
        }),
        expect.objectContaining({
          name: "subtest_missing_record",
          qualifiedName: "TestServe.subtest_missing_record",
          kind: "function",
          parentSymbolName: "TestServe"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "TestServe",
          targetName: "NewHandler",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "TestServe",
          targetName: "Serve",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });
});
