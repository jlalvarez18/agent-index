import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { fileClusterSqlForTesting, findFileClusters } from "../../src/core/file-clusters.js";
import { indexTarget } from "../../src/core/indexer.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]

def save_value(key, value):
    semantic_cache = {"saved": value}
    return semantic_cache
`
  );
  await writeFile(
    path.join(root, "pkg", "noise.py"),
    Array.from(
      { length: 30 },
      (_, index) => `def semantic_cache_noise_${index}():\n    return "semantic cache noise"\n`
    ).join("\n")
  );
  await writeFile(
    path.join(root, "tests", "test_cache.py"),
    `def test_load_value():
    assert load_value("x") == "x"
`
  );
  await indexTarget(root);
  return root;
}

describe("findFileClusters", () => {
  test("groups matching symbols into ranked low-token file clusters", async () => {
    const root = await fixtureProject();

    const result = findFileClusters(
      {
        terms: ["load_value", "semantic", "cache"],
        roles: ["source"],
        pathHints: ["pkg/cache.py"]
      },
      { target: root, limit: 3 }
    );

    expect(result.clusters[0]).toMatchObject({
      file: "pkg/cache.py",
      role: "source",
      matchedChunks: expect.any(Number)
    });
    expect(result.clusters[0].symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "load_value",
          kind: "function"
        })
      ])
    );
    expect(result.clusters[0].why).toEqual(expect.arrayContaining(["path hint match", "symbol name match", "role match"]));
    expect(result.clusters[0].evidence).toContain("semantic_cache");
    expect(result.clusters[0].evidence?.length).toBeLessThanOrEqual(96);
    expect(result.clusters[0].contextTokens).toBeLessThan(80);
  });

  test("can cluster only test files for test-discovery navigation", async () => {
    const root = await fixtureProject();

    const result = findFileClusters(
      {
        terms: ["load_value", "cache"],
        roles: ["test"]
      },
      { target: root, limit: 3 }
    );

    expect(result.clusters.map((cluster) => cluster.file)).toEqual(["tests/test_cache.py"]);
  });

  test("can treat tokenized structured path hints as hard file-path filters", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-token-path-filter-"));
    await mkdir(path.join(root, "pkg", "algorithms", "tests"), { recursive: true });
    await mkdir(path.join(root, "pkg", "community", "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "algorithms", "tests", "test_cuts.py"),
      `def test_mixing_expansion():
    mixing_expansion_conductance_cut_size = "cuts"
    return mixing_expansion_conductance_cut_size
`
    );
    await writeFile(
      path.join(root, "pkg", "community", "tests", "test_quality.py"),
      `def test_community_expansion():
    mixing_expansion_conductance_cut_size = "community"
    return mixing_expansion_conductance_cut_size
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["mixing_expansion", "conductance", "cut_size"],
        symbolKinds: ["function"],
        roles: ["test"],
        pathHints: ["algorithms cuts"],
        pathMode: "filter"
      },
      { target: root, limit: 5 }
    );

    expect(result.clusters.map((cluster) => cluster.file)).toEqual(["pkg/algorithms/tests/test_cuts.py"]);
  });

  test("uses a path-first query plan for hard file-path filters", () => {
    const queryPlan = fileClusterSqlForTesting({
      terms: ["cursor", "row count", "preserve", "memoize", "closed", "execution option"],
      symbolKinds: ["method", "function"],
      roles: ["source"],
      pathHints: ["lib/sqlalchemy/engine"],
      pathMode: "filter"
    });

    expect(queryPlan.kind).toBe("path-filter");
    expect(queryPlan.sql).not.toContain("chunk_fts match");
    expect(queryPlan.sql).toContain("idx_files_role_path");
  });

  test("uses path hints as an FTS prefilter before broad fallback", () => {
    const queryPlan = fileClusterSqlForTesting({
      terms: ["radius", "neighbors", "merge"],
      symbolKinds: ["class", "method", "function"],
      roles: ["source"],
      pathHints: ["neighbors", "pairwise distances reduction"]
    });

    expect(queryPlan.kind).toBe("path-hint-prefilter");
    expect(queryPlan.sql).toContain("chunk_fts match");
    expect(queryPlan.sql).toContain("lower(f.path) like");
    expect(queryPlan.fallback?.kind).toBe("fts");
  });

  test("uses bounded term FTS for broad task-term queries with loose path hints", () => {
    const queryPlan = fileClusterSqlForTesting({
      terms: ["radius", "neighbors", "sort", "results", "distance", "brute", "float32", "query", "batch", "merge"],
      symbolKinds: ["class", "method", "function"],
      roles: ["source"],
      pathHints: ["neighbors", "pairwise distances reduction"],
      limit: 6
    });

    expect(queryPlan.kind).toBe("bounded-term-fts");
    expect(queryPlan.fallback).toBeUndefined();
  });

  test("uses bounded per-term FTS for broad behavior queries without path hints", () => {
    const queryPlan = fileClusterSqlForTesting({
      terms: ["streaming", "async", "iterator", "response", "cleanup", "completion", "resources"],
      symbolKinds: ["method", "function"],
      roles: ["source"],
      limit: 1
    });

    expect(queryPlan.kind).toBe("bounded-term-fts");
    expect(queryPlan.sql).toContain("candidate_chunks");
    expect(queryPlan.sql).toContain("boundedTerm0");
  });

  test("keeps regular FTS for broad behavior queries that need several clusters", () => {
    const queryPlan = fileClusterSqlForTesting({
      terms: ["capture", "captured", "stdout", "stderr", "setup", "call", "teardown", "report", "section"],
      symbolKinds: ["method", "function"],
      roles: ["source"],
      limit: 5
    });

    expect(queryPlan.kind).toBe("fts");
  });

  test("keeps soft path prefilters for broad queries with several module hints", () => {
    const queryPlan = fileClusterSqlForTesting({
      terms: ["lock file", "lock entries", "same version", "source", "repository", "environment marker", "install operations"],
      symbolKinds: ["class", "method", "function"],
      roles: ["source"],
      pathHints: ["installation", "packages", "puzzle"]
    });

    expect(queryPlan.kind).toBe("path-hint-prefilter");
    expect(queryPlan.fallback?.kind).toBe("fts");
  });

  test("boosts Kotlin ViewModel Flow and Gradle ownership clusters for navigation tasks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-kotlin-"));
    await mkdir(path.join(root, "app", "src", "main", "kotlin", "com", "acme", "checkout"), { recursive: true });
    await mkdir(path.join(root, "core", "src", "main", "kotlin", "com", "acme", "model"), { recursive: true });
    await writeFile(
      path.join(root, "app", "src", "main", "kotlin", "com", "acme", "checkout", "CheckoutViewModel.kt"),
      `package com.acme.checkout

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.StateFlow

class CheckoutViewModel : ViewModel() {
    fun refresh() {
        viewModelScope.launch {
            payments.collect { emitAnalytics(it) }
        }
    }
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
    await writeFile(
      path.join(root, "core", "src", "main", "kotlin", "com", "acme", "model", "PaymentState.kt"),
      `package com.acme.model

data class PaymentState(val label: String)
`
    );
    await indexTarget(root);

    const flowResult = findFileClusters(
      {
        terms: ["CheckoutViewModel", "StateFlow", "viewModelScope", "collect", "launch"],
        symbolKinds: ["class", "method", "function"],
        roles: ["source"],
        pathHints: ["app/src/main/kotlin"]
      },
      { target: root, limit: 3 }
    );
    expect(flowResult.clusters[0]).toMatchObject({
      file: "app/src/main/kotlin/com/acme/checkout/CheckoutViewModel.kt",
      language: "kotlin"
    });
    expect(flowResult.clusters[0].why).toContain("Kotlin navigation signal match");

    const gradleResult = findFileClusters(
      {
        terms: ["Gradle", "implementation", "project", "core", "model", "module", "wiring"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["build.gradle.kts"]
      },
      { target: root, limit: 3 }
    );
    expect(gradleResult.clusters[0]).toMatchObject({
      file: "app/build.gradle.kts",
      language: "kotlin"
    });
    expect(gradleResult.clusters[0].why).toContain("Kotlin navigation signal match");
  });

  test("boosts Maven pom.xml ownership clusters for Kotlin JVM dependency tasks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-maven-"));
    await writeFile(
      path.join(root, "pom.xml"),
      `<project>
  <groupId>com.acme</groupId>
  <artifactId>checkout-parent</artifactId>
  <dependencies>
    <dependency>
      <groupId>org.jetbrains.kotlinx</groupId>
      <artifactId>kotlinx-coroutines-core</artifactId>
    </dependency>
  </dependencies>
</project>
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["Maven", "dependency", "kotlinx", "coroutines", "artifact"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["pom.xml"]
      },
      { target: root, limit: 3 }
    );

    expect(result.clusters[0]).toMatchObject({
      file: "pom.xml",
      language: "xml"
    });
    expect(result.clusters[0].why).toContain("build tool ownership match");
  });

  test("boosts Cython backend clusters for mixed Python-to-Cython navigation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-cython-"));
    await mkdir(path.join(root, "sklearn", "cluster"), { recursive: true });
    await writeFile(
      path.join(root, "sklearn", "cluster", "_dbscan.py"),
      `def dbscan(X):
    """Python dispatcher for dbscan core neighborhoods labels stack backend."""
    return X
`
    );
    await writeFile(
      path.join(root, "sklearn", "cluster", "_dbscan_inner.pyx"),
      `from libcpp.vector cimport vector
from sklearn.utils._typedefs cimport uint8_t, intp_t

def dbscan_inner(const uint8_t[::1] is_core, object[:] neighborhoods, intp_t[::1] labels):
    cdef vector[intp_t] stack
    while stack.size() > 0:
        labels[stack.back()] = 1
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["dbscan", "cython", "core", "neighborhoods", "labels", "stack", "backend"],
        symbolKinds: ["function"],
        roles: ["source"],
        pathHints: ["cluster"]
      },
      { target: root, limit: 3 }
    );

    expect(result.clusters[0]).toMatchObject({
      file: "sklearn/cluster/_dbscan_inner.pyx",
      language: "cython"
    });
    expect(result.clusters[0].why).toContain("Cython navigation signal match");
  });

  test("boosts Rails topology files for feature navigation tasks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-rails-"));
    await mkdir(path.join(root, "app", "controllers"), { recursive: true });
    await mkdir(path.join(root, "app", "models"), { recursive: true });
    await mkdir(path.join(root, "app", "jobs"), { recursive: true });
    await mkdir(path.join(root, "app", "mailers"), { recursive: true });
    await mkdir(path.join(root, "app", "serializers"), { recursive: true });
    await mkdir(path.join(root, "app", "policies"), { recursive: true });
    await mkdir(path.join(root, "config"), { recursive: true });
    await writeFile(
      path.join(root, "config", "routes.rb"),
      `Rails.application.routes.draw do
  resources :users, only: [:destroy]
end
`
    );
    await writeFile(
      path.join(root, "app", "controllers", "users_controller.rb"),
      `class UsersController < ApplicationController
  def destroy
    authorize User
    DeleteUserJob.perform_later(params[:id])
    render json: UserSerializer.new(current_user)
  end
end
`
    );
    await writeFile(
      path.join(root, "app", "models", "user.rb"),
      `class User < ApplicationRecord
  has_many :audit_events
  before_destroy :archive_profile
end
`
    );
    await writeFile(path.join(root, "app", "jobs", "delete_user_job.rb"), "class DeleteUserJob < ApplicationJob\n  queue_as :default\nend\n");
    await writeFile(path.join(root, "app", "mailers", "user_mailer.rb"), "class UserMailer < ApplicationMailer\n  def deleted(user)\n  end\nend\n");
    await writeFile(path.join(root, "app", "serializers", "user_serializer.rb"), "class UserSerializer\n  def initialize(user)\n  end\nend\n");
    await writeFile(path.join(root, "app", "policies", "user_policy.rb"), "class UserPolicy\n  def destroy?\n    user.admin?\n  end\nend\n");
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["user", "destroy", "delete", "authorize", "serializer", "job", "mailer", "policy", "route"],
        symbolKinds: ["class", "method"],
        roles: ["source"],
        pathHints: ["app", "config/routes"]
      },
      { target: root, limit: 7 }
    );

    expect(result.clusters.map((cluster) => cluster.file)).toEqual(
      expect.arrayContaining([
        "config/routes.rb",
        "app/controllers/users_controller.rb",
        "app/models/user.rb",
        "app/jobs/delete_user_job.rb",
        "app/mailers/user_mailer.rb",
        "app/serializers/user_serializer.rb",
        "app/policies/user_policy.rb"
      ])
    );
    expect(result.clusters.filter((cluster) => cluster.why.includes("Rails navigation signal match")).map((cluster) => cluster.file)).toEqual(
      expect.arrayContaining(["app/controllers/users_controller.rb", "config/routes.rb", "app/jobs/delete_user_job.rb"])
    );
  });

  test("keeps explicitly requested Rails job methods in the cluster symbol shortlist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-rails-job-symbols-"));
    await mkdir(path.join(root, "app", "jobs", "regular"), { recursive: true });
    await writeFile(
      path.join(root, "app", "jobs", "regular", "user_email.rb"),
      `module Jobs
  class UserEmail < ::Jobs::Base
    include Skippable
    sidekiq_options queue: "low"

    def quit_email_early?
      SiteSetting.disable_emails == "yes"
    end

    def execute(args)
      send_user_email(args)
    end

    def send_user_email(args)
      message_for_email(args[:user], args[:type])
    end

    def set_skip_context(type)
      @skip_context = type
    end

    def message_for_email(user, type)
      return skip_message(SkippedEmailLog.reason_types[:user_email_seen_recently]) if type == "digest"
      UserNotifications.digest(user)
    end
  end
end
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["Jobs::UserEmail", "execute", "send_user_email", "message_for_email", "SkippedEmailLog", "sidekiq_options"],
        symbolKinds: ["class", "method"],
        roles: ["source"],
        pathHints: ["app/jobs/regular/user_email.rb"]
      },
      { target: root, limit: 1 }
    );

    expect(result.clusters[0]?.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(["Jobs::UserEmail.execute", "Jobs::UserEmail.send_user_email", "Jobs::UserEmail.message_for_email"])
    );
  });

  test("boosts Gradle version catalog clusters for Kotlin alias ownership tasks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-catalog-"));
    await mkdir(path.join(root, "gradle"), { recursive: true });
    await writeFile(
      path.join(root, "gradle", "libs.versions.toml"),
      `[versions]
coroutines = "1.8.1"

[libraries]
kotlinx-coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["version", "catalog", "kotlinx", "coroutines", "library", "alias"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["libs.versions.toml"]
      },
      { target: root, limit: 3 }
    );

    expect(result.clusters[0]).toMatchObject({
      file: "gradle/libs.versions.toml",
      language: "toml"
    });
    expect(result.clusters[0].why).toContain("build tool ownership match");
  });

  test("prefers files with broader task-term coverage over repeated partial noise", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-coverage-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "redirects.py"),
      `def preserve_redirect_history(response):
    history = response.history
    return history

def build_manual_next_request(request):
    next_request = request.copy()
    return next_request
`
    );
    await writeFile(
      path.join(root, "pkg", "noise.py"),
      Array.from(
        { length: 24 },
        (_, index) => `def redirect_history_noise_${index}(response):\n    return response.history\n`
      ).join("\n")
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["redirect", "history", "next_request"],
        roles: ["source"]
      },
      { target: root, limit: 2 }
    );

    expect(result.clusters[0]).toMatchObject({
      file: "pkg/redirects.py"
    });
    expect(result.clusters[0].why).toContain("broader task-term coverage");
  });

  test("uses file basename task terms to break adapter-method ties", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-path-"));
    await mkdir(path.join(root, "pkg", "contrib"), { recursive: true });
    await mkdir(path.join(root, "pkg", "http"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "contrib", "handlers.py"),
      `class StaticHandler:
    async def get_response_async(self, request):
        return request
`
    );
    await writeFile(
      path.join(root, "pkg", "http", "response.py"),
      `class StreamingResponse:
    async def __aiter__(self):
        yield b""

    def set_streaming_iterator(self, iterator):
        self.iterator = iterator
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["streaming", "async", "iterator", "response"],
        symbolKinds: ["method", "function"],
        roles: ["source"]
      },
      { target: root, limit: 2 }
    );

    expect(result.clusters[0]).toMatchObject({
      file: "pkg/http/response.py"
    });
    expect(result.clusters[0].evidence).toContain("set_streaming_iterator");
    expect(result.clusters[0].why).toContain("file name matches task terms");
  });

  test("retains enough matched symbols for downstream completion scoring", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-symbol-cap-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "backend.py"),
      `class RadiusNeighbors:
    def compute(self):
        return self._finalize_results()

    def _parallel_on_X_prange_iter_finalize(self):
        return self._merge_vectors()

    def _parallel_on_Y_finalize(self):
        return self._merge_vectors()

    def _parallel_on_Y_init(self):
        return self.chunks

    def _parallel_on_X_init(self):
        return self.chunks

    def _merge_vectors(self):
        return []

    def _finalize_results(self):
        return []
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["radius", "neighbors", "sort", "results", "merge", "vectors", "finalize"],
        symbolKinds: ["class", "method"],
        roles: ["source"]
      },
      { target: root, limit: 1 }
    );

    expect(result.clusters[0].symbols.map((symbol) => symbol.name)).toContain("RadiusNeighbors._merge_vectors");
  });

  test("keeps late task-relevant symbols ahead of earlier generic symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-symbol-relevance-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "default.py"),
      `${Array.from({ length: 16 }, (_, index) => `class Generic${index}:\n    def option_${index}(self):\n        return "cursor option"\n`).join("\n")}

class DefaultExecutionContext:
    def _has_rowcount(self):
        return self.cursor.rowcount

    def _setup_result_proxy(self):
        preserve_rowcount = self.execution_options.get("preserve_rowcount")
        return preserve_rowcount
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["cursor", "row count", "preserve", "execution option"],
        symbolKinds: ["method", "function"],
        roles: ["source"],
        pathHints: ["pkg/engine"],
        pathMode: "filter"
      },
      { target: root, limit: 1 }
    );

    expect(result.clusters[0].symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(["DefaultExecutionContext._has_rowcount", "DefaultExecutionContext._setup_result_proxy"])
    );
  });

  test("reranks symbols for soft path-hinted clusters so late behavior helpers stay visible", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-soft-symbol-relevance-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "canvas.py"),
      `${Array.from({ length: 18 }, (_, index) => `class Generic${index}:\n    def generic_${index}(self):\n        return "chain group apply_async options canvas"\n`).join("\n")}

def chain_group_apply_async_options(options, tasks):
    return "chain group apply_async options canvas"
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["canvas", "chain", "group", "apply_async", "options"],
        symbolKinds: ["class", "method", "function"],
        roles: ["source"],
        pathHints: ["pkg", "canvas"]
      },
      { target: root, limit: 1 }
    );

    expect(result.clusters[0].symbols.map((symbol) => symbol.name)).toContain("chain_group_apply_async_options");
  });
});
