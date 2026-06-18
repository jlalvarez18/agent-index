import Database from "better-sqlite3";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    "class Cache:\n    def get(self, key):\n        return load_value(key)\n\ndef load_value(key):\n    return key\n"
  );
  return root;
}

describe("indexTarget", () => {
  test("writes files, symbols, chunks, edges, and FTS rows into the local index", async () => {
    const root = await fixtureProject();

    const stats = await indexTarget(root);

    expect(stats.indexPath).toBe(path.join(root, ".codeindex", "index.sqlite"));
    expect(stats).toMatchObject({
      files: 1,
      symbols: 4,
      chunks: 4
    });
    expect(stats.edges).toBeGreaterThanOrEqual(4);

    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language, role from files").all();
    const symbols = db.prepare("select name, qualified_name, kind from symbols order by id").all();
    const fts = db.prepare("select chunk_id, symbol_name, file_path from chunk_fts").all();
    const indexes = db
      .prepare("select name from sqlite_master where type = 'index' and name like 'idx_%' order by name")
      .all()
      .map((row) => (row as { name: string }).name);
    db.close();

    expect(files).toEqual([{ path: "pkg/cache.py", language: "python", role: "source" }]);
    expect(symbols).toEqual([
      { name: "pkg/cache.py", qualified_name: "pkg/cache.py", kind: "module" },
      { name: "Cache", qualified_name: "Cache", kind: "class" },
      { name: "get", qualified_name: "Cache.get", kind: "method" },
      { name: "load_value", qualified_name: "load_value", kind: "function" }
    ]);
    expect(fts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol_name: "Cache.get", file_path: "pkg/cache.py" }),
        expect.objectContaining({ symbol_name: "load_value", file_path: "pkg/cache.py" })
      ])
    );
    expect(indexes).toEqual([
      "idx_chunks_file_id",
      "idx_edges_source_kind_target",
      "idx_edges_source_symbol_id",
      "idx_files_role",
      "idx_files_role_path",
      "idx_symbols_file_id",
      "idx_symbols_file_kind_qualified"
    ]);
  });

  test("writes file roles into the local index", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-roles-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await mkdir(path.join(root, "examples"), { recursive: true });
    await mkdir(path.join(root, "fixtures"), { recursive: true });
    await mkdir(path.join(root, "tools"), { recursive: true });
    await mkdir(path.join(root, "benchmarks"), { recursive: true });
    await mkdir(path.join(root, "t", "unit"), { recursive: true });
    await writeFile(path.join(root, "pkg", "service.py"), "def source_symbol():\n    return 1\n");
    await writeFile(path.join(root, "tests", "test_service.py"), "def test_symbol():\n    return 1\n");
    await writeFile(path.join(root, "docs", "snippet.py"), "def docs_symbol():\n    return 1\n");
    await writeFile(path.join(root, "examples", "demo.py"), "def example_symbol():\n    return 1\n");
    await writeFile(path.join(root, "fixtures", "data.py"), "def fixture_symbol():\n    return 1\n");
    await writeFile(path.join(root, "tools", "gen.py"), "def tool_symbol():\n    return 1\n");
    await writeFile(path.join(root, "benchmarks", "bench.py"), "def benchmark_symbol():\n    return 1\n");
    await writeFile(path.join(root, "t", "unit", "test_tasks.py"), "def celery_test_symbol():\n    return 1\n");

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, role from files order by path").all();
    db.close();

    expect(files).toEqual([
      { path: "benchmarks/bench.py", role: "benchmark" },
      { path: "docs/snippet.py", role: "docs" },
      { path: "examples/demo.py", role: "example" },
      { path: "fixtures/data.py", role: "fixture" },
      { path: "pkg/service.py", role: "source" },
      { path: "t/unit/test_tasks.py", role: "test" },
      { path: "tests/test_service.py", role: "test" },
      { path: "tools/gen.py", role: "tool" }
    ]);
  });

  test("indexes Rust source files alongside Python files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-rust-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "pydantic-core", "src", "serializers"), { recursive: true });
    await writeFile(path.join(root, "pkg", "main.py"), "def model_dump_json():\n    return 'json'\n");
    await writeFile(
      path.join(root, "pydantic-core", "src", "serializers", "computed_fields.rs"),
      `pub struct ComputedFields {}

impl ComputedFields {
    pub fn serialize(&self) {
        exclude_computed_fields();
    }
}
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("pydantic-core/src/serializers/computed_fields.rs");
    db.close();

    expect(files).toEqual([
      { path: "pkg/main.py", language: "python" },
      { path: "pydantic-core/src/serializers/computed_fields.rs", language: "rust" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "serializers.computed_fields.ComputedFields", kind: "class" },
        { qualified_name: "serializers.computed_fields.ComputedFields.serialize", kind: "method" }
      ])
    );
  });

  test("indexes Ruby source files with qualified symbols and edges", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-ruby-"));
    await mkdir(path.join(root, "app", "controllers", "admin"), { recursive: true });
    await mkdir(path.join(root, "spec", "controllers"), { recursive: true });
    await writeFile(
      path.join(root, "app", "controllers", "admin", "users_controller.rb"),
      `require "json"

module Admin
  class UsersController < ApplicationController
    include Auditable

    def show
      audit_show
      render json: UserSerializer.new(current_user)
    end

    def audit_show
      AuditLogger.info("show")
    end
  end
end
`
    );
    await writeFile(
      path.join(root, "spec", "controllers", "users_controller_spec.rb"),
      `RSpec.describe Admin::UsersController do
  it "renders the current user" do
    get :show
  end
end
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language, role from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where qualified_name like 'Admin%' order by qualified_name")
      .all();
    const edges = db
      .prepare(
        `
        select source.qualified_name as source, e.target_name, e.kind
        from edges e
        left join symbols source on source.id = e.source_symbol_id
        order by source.qualified_name, e.kind, e.target_name
        `
      )
      .all();
    db.close();

    expect(files).toEqual([
      { path: "app/controllers/admin/users_controller.rb", language: "ruby", role: "source" },
      { path: "spec/controllers/users_controller_spec.rb", language: "ruby", role: "test" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "Admin", kind: "module" },
        { qualified_name: "Admin::UsersController", kind: "class" },
        { qualified_name: "Admin::UsersController.show", kind: "method" }
      ])
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        {
          source: "app/controllers/admin/users_controller.rb",
          target_name: "json",
          kind: "symbol_imports_module"
        },
        {
          source: "Admin::UsersController",
          target_name: "ApplicationController",
          kind: "symbol_conforms_to"
        },
        {
          source: "Admin::UsersController",
          target_name: "Auditable",
          kind: "symbol_conforms_to"
        },
        {
          source: "Admin::UsersController.show",
          target_name: "Admin::UsersController.audit_show",
          kind: "symbol_calls_name"
        },
        {
          source: "Admin::UsersController.show",
          target_name: "UserSerializer",
          kind: "symbol_calls_name"
        }
      ])
    );
  });

  test("indexes Rust crate metadata and resolves trait implementations across files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-rust-traits-"));
    await mkdir(path.join(root, "src", "runtime"), { recursive: true });
    await writeFile(
      path.join(root, "Cargo.toml"),
      `[package]
name = "agent-runtime"
version = "0.1.0"

[dependencies]
tokio = "1"

[[bin]]
name = "agent-runtime-cli"
path = "src/main.rs"
`
    );
    await writeFile(
      path.join(root, "src", "runtime", "executor.rs"),
      `pub trait Executor {
    fn spawn(&self, task: Task);
}
`
    );
    await writeFile(
      path.join(root, "src", "runtime", "mod.rs"),
      `use crate::runtime::executor::Executor;

pub struct Runtime;

impl Runtime {
    pub fn spawn(&self, task: Task) {
        schedule(task);
    }
}

impl Executor for Runtime {
    fn spawn(&self, task: Task) {
        self.spawn(task);
    }
}
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language, role from files order by path").all();
    const rustSymbols = db
      .prepare("select qualified_name, kind from symbols where qualified_name like 'runtime.%' or qualified_name like 'cargo.%' order by qualified_name")
      .all();
    const edges = db
      .prepare(
        `
        select source.qualified_name as source, target.qualified_name as target, e.target_name, e.kind
        from edges e
        join symbols source on source.id = e.source_symbol_id
        left join symbols target on target.id = e.target_symbol_id
        where e.kind = 'symbol_conforms_to'
        order by source.qualified_name, e.target_name
        `
      )
      .all();
    db.close();

    expect(files).toEqual([
      { path: "Cargo.toml", language: "toml", role: "source" },
      { path: "src/runtime/executor.rs", language: "rust", role: "source" },
      { path: "src/runtime/mod.rs", language: "rust", role: "source" }
    ]);
    expect(rustSymbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "cargo.package.agent_runtime", kind: "method" },
        { qualified_name: "cargo.dependency.tokio", kind: "method" },
        { qualified_name: "runtime.executor.Executor", kind: "class" },
        { qualified_name: "runtime.executor.Executor.spawn", kind: "method" },
        { qualified_name: "runtime.Runtime", kind: "class" },
        { qualified_name: "runtime.Runtime.spawn", kind: "method" }
      ])
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        {
          source: "runtime.Runtime",
          target: "runtime.executor.Executor",
          target_name: "Executor",
          kind: "symbol_conforms_to"
        },
        {
          source: "runtime.Runtime.spawn",
          target: "runtime.executor.Executor.spawn",
          target_name: "runtime.executor.Executor.spawn",
          kind: "symbol_conforms_to"
        }
      ])
    );
  });

  test("indexes Cython template source files alongside Python files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-cython-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "sklearn", "metrics", "_pairwise_distances_reduction"), { recursive: true });
    await writeFile(path.join(root, "pkg", "main.py"), "def radius_neighbors():\n    return 'python api'\n");
    await writeFile(
      path.join(root, "sklearn", "metrics", "_pairwise_distances_reduction", "_radius_neighbors.pyx.tp"),
      `from sklearn.metrics._pairwise_distances_reduction._base cimport BaseDistancesReduction{{name_suffix}}

cdef class RadiusNeighbors{{name_suffix}}(BaseDistancesReduction{{name_suffix}}):
    def compute(self, sort_results=False):
        return self._finalize_results()

    def _finalize_results(self):
        return []
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp");
    const edges = db
      .prepare(
        `
        select source.qualified_name as source, e.target_name, e.kind
        from edges e
        left join symbols source on source.id = e.source_symbol_id
        join files f on f.id = source.file_id
        where f.path = ?
        order by e.kind, source.qualified_name, e.target_name
        `
      )
      .all("sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp");
    db.close();

    expect(files).toEqual([
      { path: "pkg/main.py", language: "python" },
      { path: "sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp", language: "cython" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "RadiusNeighbors", kind: "class" },
        { qualified_name: "RadiusNeighbors.compute", kind: "method" },
        { qualified_name: "RadiusNeighbors._finalize_results", kind: "method" }
      ])
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        {
          source: "sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp",
          target_name: "sklearn.metrics._pairwise_distances_reduction._base",
          kind: "symbol_imports_module"
        },
        {
          source: "RadiusNeighbors",
          target_name: "BaseDistancesReduction",
          kind: "symbol_conforms_to"
        },
        {
          source: "RadiusNeighbors.compute",
          target_name: "_finalize_results",
          kind: "symbol_calls_name"
        }
      ])
    );
  });

  test("indexes C source, headers, tests, and C build ownership files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-c-"));
    await mkdir(path.join(root, "include"), { recursive: true });
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "include", "cache.h"),
      `typedef struct CacheEntry CacheEntry;
CacheEntry *cache_lookup(CacheEntry *head, const char *key);
`
    );
    await writeFile(
      path.join(root, "src", "cache.c"),
      `#include "cache.h"
#include <string.h>

typedef struct CacheEntry {
    const char *key;
} CacheEntry;

CacheEntry *cache_lookup(CacheEntry *head, const char *key) {
    if (strcmp(head->key, key) == 0) {
        return head;
    }
    return 0;
}
`
    );
    await writeFile(
      path.join(root, "tests", "test_cache.c"),
      `#include "../include/cache.h"

void test_cache_lookup(void) {
    cache_lookup(0, "missing");
}
`
    );
    await writeFile(path.join(root, "Makefile"), "cache_test: tests/test_cache.o src/cache.o\n");

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language, role from files order by path").all();
    const sourceSymbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("src/cache.c");
    const testSymbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("tests/test_cache.c");
    const makeSymbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("Makefile");
    const edges = db
      .prepare(
        `
        select source.qualified_name as source, e.target_name, e.kind
        from edges e
        join symbols source on source.id = e.source_symbol_id
        order by source.qualified_name, e.target_name
        `
      )
      .all();
    db.close();

    expect(files).toEqual([
      { path: "Makefile", language: "c", role: "source" },
      { path: "include/cache.h", language: "c", role: "source" },
      { path: "src/cache.c", language: "c", role: "source" },
      { path: "tests/test_cache.c", language: "c", role: "test" }
    ]);
    expect(sourceSymbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "CacheEntry", kind: "class" },
        { qualified_name: "cache_lookup", kind: "function" }
      ])
    );
    expect(testSymbols).toEqual(expect.arrayContaining([{ qualified_name: "test_cache_lookup", kind: "function" }]));
    expect(makeSymbols).toEqual(expect.arrayContaining([{ qualified_name: "make.target.cache_test", kind: "method" }]));
    expect(edges).toEqual(
      expect.arrayContaining([
        { source: "src/cache.c", target_name: "cache.h", kind: "symbol_imports_module" },
        { source: "cache_lookup", target_name: "strcmp", kind: "symbol_calls_name" },
        { source: "test_cache_lookup", target_name: "cache_lookup", kind: "symbol_calls_name" },
        { source: "make.target.cache_test", target_name: "tests/test_cache.o", kind: "symbol_calls_name" }
      ])
    );
  });

  test("resolves Swift protocol conformances and requirement implementations across files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-swift-protocols-"));
    await mkdir(path.join(root, "Sources", "Checkout"), { recursive: true });
    await writeFile(
      path.join(root, "Sources", "Checkout", "PaymentAuthorizing.swift"),
      `protocol PaymentAuthorizing {
    func authorize(_ request: PaymentRequest) async throws -> Receipt
}
`
    );
    await writeFile(
      path.join(root, "Sources", "Checkout", "CheckoutViewModel.swift"),
      `struct CheckoutViewModel: PaymentAuthorizing {
    func authorize(_ request: PaymentRequest) async throws -> Receipt {
        try await gateway.authorize(request)
    }
}
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const edges = db
      .prepare(
        `
        select source.qualified_name as source, target.qualified_name as target, e.target_name, e.kind
        from edges e
        join symbols source on source.id = e.source_symbol_id
        left join symbols target on target.id = e.target_symbol_id
        where e.kind = 'symbol_conforms_to'
        order by source.qualified_name, e.target_name
        `
      )
      .all();
    db.close();

    expect(edges).toEqual(
      expect.arrayContaining([
        {
          source: "CheckoutViewModel",
          target: "PaymentAuthorizing",
          target_name: "PaymentAuthorizing",
          kind: "symbol_conforms_to"
        },
        {
          source: "CheckoutViewModel.authorize",
          target: "PaymentAuthorizing.authorize",
          target_name: "PaymentAuthorizing.authorize",
          kind: "symbol_conforms_to"
        }
      ])
    );
  });

  test("indexes Kotlin source, Gradle Kotlin DSL files, and resolves interface implementations across files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-kotlin-"));
    await mkdir(path.join(root, "core", "src", "main", "kotlin", "com", "acme", "checkout"), { recursive: true });
    await mkdir(path.join(root, "app", "src", "main", "kotlin", "com", "acme", "checkout"), { recursive: true });
    await writeFile(
      path.join(root, "core", "src", "main", "kotlin", "com", "acme", "checkout", "PaymentRepository.kt"),
      `package com.acme.checkout

import kotlinx.coroutines.flow.Flow

interface PaymentRepository {
    fun observePayments(): Flow<PaymentState>
}
`
    );
    await writeFile(
      path.join(root, "app", "src", "main", "kotlin", "com", "acme", "checkout", "CheckoutViewModel.kt"),
      `package com.acme.checkout

class CheckoutViewModel(
    private val repository: PaymentRepository
) : PaymentRepository {
    override fun observePayments() = repository.observePayments()
}
`
    );
    await writeFile(
      path.join(root, "app", "build.gradle.kts"),
      `plugins {
    id("com.android.application")
    kotlin("android")
}

dependencies {
    implementation(project(":core:model"))
}
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("app/src/main/kotlin/com/acme/checkout/CheckoutViewModel.kt");
    const edges = db
      .prepare(
        `
        select source.qualified_name as source, target.qualified_name as target, e.target_name, e.kind
        from edges e
        join symbols source on source.id = e.source_symbol_id
        left join symbols target on target.id = e.target_symbol_id
        where e.kind = 'symbol_conforms_to'
        order by source.qualified_name, e.target_name
        `
      )
      .all();
    db.close();

    expect(files).toEqual([
      { path: "app/build.gradle.kts", language: "kotlin" },
      { path: "app/src/main/kotlin/com/acme/checkout/CheckoutViewModel.kt", language: "kotlin" },
      { path: "core/src/main/kotlin/com/acme/checkout/PaymentRepository.kt", language: "kotlin" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "com.acme.checkout.CheckoutViewModel", kind: "class" },
        { qualified_name: "com.acme.checkout.CheckoutViewModel.observePayments", kind: "method" }
      ])
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        {
          source: "com.acme.checkout.CheckoutViewModel",
          target: "com.acme.checkout.PaymentRepository",
          target_name: "PaymentRepository",
          kind: "symbol_conforms_to"
        },
        {
          source: "com.acme.checkout.CheckoutViewModel.observePayments",
          target: "com.acme.checkout.PaymentRepository.observePayments",
          target_name: "com.acme.checkout.PaymentRepository.observePayments",
          kind: "symbol_conforms_to"
        }
      ])
    );
  });

  test("indexes Java source files and resolves interface implementations across files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-java-"));
    await mkdir(path.join(root, "core", "src", "main", "java", "com", "acme", "checkout"), { recursive: true });
    await mkdir(path.join(root, "app", "src", "main", "java", "com", "acme", "checkout"), { recursive: true });
    await writeFile(
      path.join(root, "core", "src", "main", "java", "com", "acme", "checkout", "PaymentRepository.java"),
      `package com.acme.checkout;

public interface PaymentRepository {
    PaymentState findById(String id);
}
`
    );
    await writeFile(
      path.join(root, "app", "src", "main", "java", "com", "acme", "checkout", "CheckoutService.java"),
      `package com.acme.checkout;

import org.springframework.stereotype.Service;

@Service
public class CheckoutService implements PaymentRepository {
    @Override
    public PaymentState findById(String id) {
        return repository.findById(id);
    }
}
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("app/src/main/java/com/acme/checkout/CheckoutService.java");
    const edges = db
      .prepare(
        `
        select source.qualified_name as source, target.qualified_name as target, e.target_name, e.kind
        from edges e
        join symbols source on source.id = e.source_symbol_id
        left join symbols target on target.id = e.target_symbol_id
        where e.kind = 'symbol_conforms_to'
        order by source.qualified_name, e.target_name
        `
      )
      .all();
    db.close();

    expect(files).toEqual([
      { path: "app/src/main/java/com/acme/checkout/CheckoutService.java", language: "java" },
      { path: "core/src/main/java/com/acme/checkout/PaymentRepository.java", language: "java" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "com.acme.checkout.CheckoutService", kind: "class" },
        { qualified_name: "com.acme.checkout.CheckoutService.findById", kind: "method" }
      ])
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        {
          source: "com.acme.checkout.CheckoutService",
          target: "com.acme.checkout.PaymentRepository",
          target_name: "PaymentRepository",
          kind: "symbol_conforms_to"
        },
        {
          source: "com.acme.checkout.CheckoutService.findById",
          target: "com.acme.checkout.PaymentRepository.findById",
          target_name: "com.acme.checkout.PaymentRepository.findById",
          kind: "symbol_conforms_to"
        }
      ])
    );
  });

  test("indexes C++ source, headers, build ownership, and resolves interface implementations across files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-cpp-"));
    await mkdir(path.join(root, "include", "acme", "checkout"), { recursive: true });
    await mkdir(path.join(root, "source", "common", "checkout"), { recursive: true });
    await writeFile(path.join(root, "CMakeLists.txt"), "add_library(checkout_core source/common/checkout/checkout_service.cc)\n");
    await writeFile(
      path.join(root, "include", "acme", "checkout", "payment_repository.h"),
      `#pragma once

namespace acme::checkout {

class PaymentRepository {
public:
  virtual ~PaymentRepository() = default;
  virtual PaymentState FindById(const std::string& id) const = 0;
};

}  // namespace acme::checkout
`
    );
    await writeFile(
      path.join(root, "source", "common", "checkout", "checkout_service.cc"),
      `#include "acme/checkout/payment_repository.h"

namespace acme::checkout {

class CheckoutService final : public PaymentRepository {
public:
  PaymentState FindById(const std::string& id) const override {
    return gateway_->Fetch(id);
  }
};

}  // namespace acme::checkout
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("source/common/checkout/checkout_service.cc");
    const edges = db
      .prepare(
        `
        select source.qualified_name as source, target.qualified_name as target, e.target_name, e.kind
        from edges e
        join symbols source on source.id = e.source_symbol_id
        left join symbols target on target.id = e.target_symbol_id
        where e.kind = 'symbol_conforms_to'
        order by source.qualified_name, e.target_name
        `
      )
      .all();
    db.close();

    expect(files).toEqual([
      { path: "CMakeLists.txt", language: "cpp" },
      { path: "include/acme/checkout/payment_repository.h", language: "cpp" },
      { path: "source/common/checkout/checkout_service.cc", language: "cpp" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "acme::checkout::CheckoutService", kind: "class" },
        { qualified_name: "acme::checkout::CheckoutService.FindById", kind: "method" }
      ])
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        {
          source: "acme::checkout::CheckoutService",
          target: "acme::checkout::PaymentRepository",
          target_name: "PaymentRepository",
          kind: "symbol_conforms_to"
        },
        {
          source: "acme::checkout::CheckoutService.FindById",
          target: "acme::checkout::PaymentRepository.FindById",
          target_name: "acme::checkout::PaymentRepository.FindById",
          kind: "symbol_conforms_to"
        }
      ])
    );
  });

  test("indexes Maven pom.xml ownership symbols for Kotlin JVM projects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-maven-"));
    await writeFile(
      path.join(root, "pom.xml"),
      `<project>
  <groupId>com.acme</groupId>
  <artifactId>checkout-parent</artifactId>
  <modules>
    <module>checkout-core</module>
  </modules>
  <dependencies>
    <dependency>
      <groupId>org.jetbrains.kotlinx</groupId>
      <artifactId>kotlinx-coroutines-core</artifactId>
    </dependency>
  </dependencies>
</project>
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db.prepare("select qualified_name, kind from symbols order by id").all();
    db.close();

    expect(files).toEqual([{ path: "pom.xml", language: "xml" }]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "maven.project.checkout_parent", kind: "method" },
        { qualified_name: "maven.module.checkout_core", kind: "method" },
        { qualified_name: "maven.dependency.org_jetbrains_kotlinx_kotlinx_coroutines_core", kind: "method" }
      ])
    );
  });

  test("indexes Gradle version catalog aliases for Kotlin dependency ownership", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-version-catalog-"));
    await mkdir(path.join(root, "gradle"), { recursive: true });
    await writeFile(
      path.join(root, "gradle", "libs.versions.toml"),
      `[versions]
coroutines = "1.8.1"

[libraries]
kotlinx-coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }

[plugins]
kotlin-multiplatform = { id = "org.jetbrains.kotlin.multiplatform", version = "2.0.0" }
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db.prepare("select qualified_name, kind from symbols order by id").all();
    db.close();

    expect(files).toEqual([{ path: "gradle/libs.versions.toml", language: "toml" }]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "gradle.catalog.version.coroutines", kind: "method" },
        { qualified_name: "gradle.catalog.library.kotlinx_coroutines_core", kind: "method" },
        { qualified_name: "gradle.catalog.plugin.kotlin_multiplatform", kind: "method" }
      ])
    );
  });

  test("indexes TypeScript, TSX, and JavaScript family files alongside Python files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-typescript-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "src", "views"), { recursive: true });
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(path.join(root, "pkg", "main.py"), "def dashboard():\n    return 'python api'\n");
    await writeFile(
      path.join(root, "src", "views", "DashboardScreen.tsx"),
      `import { invoke } from "@tauri-apps/api/core";

export const DashboardScreen = () => {
  invoke("get_roadmap");
  return null;
};
`
    );
    await writeFile(
      path.join(root, "src", "lib", "client.mjs"),
      `export const apiClient = {
  async listPayments(params) {
    return fetch("/payments", { params });
  }
};
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("src/views/DashboardScreen.tsx");
    const jsSymbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("src/lib/client.mjs");
    const edges = db
      .prepare("select target_name, kind from edges where source_symbol_id is not null order by target_name")
      .all();
    db.close();

    expect(files).toEqual([
      { path: "pkg/main.py", language: "python" },
      { path: "src/lib/client.mjs", language: "javascript" },
      { path: "src/views/DashboardScreen.tsx", language: "typescript" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "src/views/DashboardScreen.tsx", kind: "module" },
        { qualified_name: "DashboardScreen", kind: "function" }
      ])
    );
    expect(jsSymbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "src/lib/client.mjs", kind: "module" },
        { qualified_name: "apiClient", kind: "class" },
        { qualified_name: "apiClient.listPayments", kind: "method" }
      ])
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        { target_name: "@tauri-apps/api/core", kind: "symbol_imports_module" },
        { target_name: "invoke", kind: "symbol_calls_name" }
      ])
    );
  });

  test("indexes JSON config and diagnostic files as module chunks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-json-"));
    await mkdir(path.join(root, "src", "compiler"), { recursive: true });
    await writeFile(
      path.join(root, "src", "compiler", "diagnosticMessages.json"),
      `{
  "Cannot_find_name_0": {
    "code": 2304,
    "key": "TS2304"
  }
}
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language, role from files order by path").all();
    const symbols = db.prepare("select qualified_name, kind from symbols order by id").all();
    const fts = db.prepare("select symbol_name, file_path from chunk_fts").all();
    db.close();

    expect(files).toEqual([{ path: "src/compiler/diagnosticMessages.json", language: "json", role: "source" }]);
    expect(symbols).toEqual([{ qualified_name: "src/compiler/diagnosticMessages.json", kind: "module" }]);
    expect(fts).toEqual([
      {
        symbol_name: "src/compiler/diagnosticMessages.json",
        file_path: "src/compiler/diagnosticMessages.json"
      }
    ]);
  });

  test("rejects a missing target before creating an index directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-missing-"));
    const missing = path.join(root, "missing-project");

    await expect(indexTarget(missing)).rejects.toThrow("Target does not exist");
    await expect(access(missing)).rejects.toThrow();
  });
});
