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
        qualifiedName: "serializers.computed_fields.ComputedFields",
        kind: "class",
        parentSymbolName: "pydantic-core/src/serializers/computed_fields.rs"
      },
      {
        name: "new",
        qualifiedName: "serializers.computed_fields.ComputedFields.new",
        kind: "method",
        parentSymbolName: "serializers.computed_fields.ComputedFields"
      },
      {
        name: "serialize",
        qualifiedName: "serializers.computed_fields.ComputedFields.serialize",
        kind: "method",
        parentSymbolName: "serializers.computed_fields.ComputedFields"
      },
      {
        name: "helper",
        qualifiedName: "serializers.computed_fields.helper",
        kind: "function",
        parentSymbolName: "pydantic-core/src/serializers/computed_fields.rs"
      }
    ]);

    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "serializers.computed_fields.ComputedFields.serialize",
          text: expect.stringContaining("pub fn serialize")
        })
      ])
    );
  });

  test("extracts modules, traits, trait impls, macros, imports, call edges, and inline tests", () => {
    const result = extractRust(
      sourceFile(`use crate::runtime::{Builder, Handle};
use std::future::Future as StdFuture;

pub mod runtime;
mod io;

#[macro_export]
macro_rules! trace_ready {
    () => {};
}

pub trait Executor {
    fn spawn(&self, task: Task);
}

pub struct Runtime {
    handle: Handle,
}

impl Runtime {
    pub fn new() -> Self {
        Builder::new().build()
    }

    pub async fn spawn(&self, task: Task) {
        self.handle.spawn(task);
        trace_ready!();
    }
}

impl Executor for Runtime {
    fn spawn(&self, task: Task) {
        self.spawn(task);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn spawns_task() {
        Runtime::new().spawn(task());
    }
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.runtime", kind: "module" }),
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.io", kind: "module" }),
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.trace_ready", kind: "function" }),
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.Executor", kind: "class" }),
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.Executor.spawn", kind: "method" }),
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.Runtime", kind: "class" }),
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.Runtime.new", kind: "method" }),
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.Runtime.spawn", kind: "method" }),
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.tests", kind: "module" }),
        expect.objectContaining({ qualifiedName: "serializers.computed_fields.tests.spawns_task", kind: "function" })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "pydantic-core/src/serializers/computed_fields.rs",
          targetName: "crate::runtime::Builder",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "pydantic-core/src/serializers/computed_fields.rs",
          targetName: "crate::runtime::Handle",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "serializers.computed_fields.Runtime",
          targetName: "Executor",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "serializers.computed_fields.Runtime.new",
          targetName: "Builder",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "serializers.computed_fields.Runtime.spawn",
          targetName: "trace_ready",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "serializers.computed_fields.tests.spawns_task",
          targetName: "Runtime",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });
});
