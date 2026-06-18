import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import {
  findRelatedTests,
  findRelatedTestsBatch,
  relatedTestCandidateSqlForTesting,
  relatedTestRowSqlForTesting
} from "../../src/core/related-tests.js";

describe("findRelatedTests", () => {
  test("ranks tests by source path and symbol evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "cache.py"), "def load_value(key):\n    return key\n");
    await writeFile(
      path.join(root, "tests", "test_cache.py"),
      `def test_load_value():
    assert load_value("x") == "x"
`
    );
    await writeFile(
      path.join(root, "tests", "test_other.py"),
      `def test_unrelated():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/cache.py",
      symbol: "load_value"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_cache.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test path includes source stem", "test body mentions source symbol", "test calls source symbol"])
    );
    expect(result.matches.map((match) => match.file)).not.toContain("tests/test_other.py");
  });

  test("uses import evidence when test filenames do not match source filenames", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-imports-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "service.py"), "def create_client():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "test_api_behavior.py"),
      `from pkg import service

def test_client_factory():
    assert service.create_client() is not None
`
    );
    await writeFile(
      path.join(root, "tests", "test_unrelated.py"),
      `def test_unrelated():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/service.py"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_api_behavior.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toContain("test imports source module");
  });

  test("links Rails controllers to matching RSpec controller specs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-ruby-"));
    await mkdir(path.join(root, "app", "controllers", "admin"), { recursive: true });
    await mkdir(path.join(root, "spec", "controllers"), { recursive: true });
    await writeFile(
      path.join(root, "app", "controllers", "admin", "users_controller.rb"),
      `module Admin
  class UsersController < ApplicationController
    def show
      render json: UserSerializer.new(current_user)
    end
  end
end
`
    );
    await writeFile(
      path.join(root, "spec", "controllers", "users_controller_spec.rb"),
      `RSpec.describe Admin::UsersController do
  describe "#show" do
    it "renders the current user" do
      get :show
      expect(response).to have_http_status(:ok)
    end
  end
end
`
    );
    await writeFile(
      path.join(root, "spec", "controllers", "reports_controller_spec.rb"),
      `RSpec.describe ReportsController do
  it "is unrelated" do
    expect(true).to eq(true)
  end
end
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "app/controllers/admin/users_controller.rb",
      symbol: "Admin::UsersController.show",
      terms: ["current user", "render"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "spec/controllers/users_controller_spec.rb"
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test path includes source stem", "test body mentions source symbol", "test body matches task terms"])
    );
    expect(result.matches).toHaveLength(1);
  });

  test("links Rails request specs to controller actions through RSpec source mentions and route calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-ruby-request-"));
    await mkdir(path.join(root, "app", "controllers"), { recursive: true });
    await mkdir(path.join(root, "config"), { recursive: true });
    await mkdir(path.join(root, "spec", "requests"), { recursive: true });
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
    DeleteUserJob.perform_later(params[:id])
    redirect_to users_path
  end
end
`
    );
    await writeFile(
      path.join(root, "spec", "requests", "account_deletion_spec.rb"),
      `RSpec.describe UsersController, type: :request do
  let(:user) { create(:user) }

  it "queues deletion from the destroy route" do
    perform_enqueued_jobs do
      delete user_path(user)
    end
  end
end
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "app/controllers/users_controller.rb",
      symbol: "UsersController.destroy",
      terms: ["destroy", "delete", "queued", "route"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "spec/requests/account_deletion_spec.rb"
    });
    expect(result.matches[0].why).toEqual(expect.arrayContaining(["RSpec describes source symbol", "request spec exercises Rails route"]));
  });

  test("links Cython source modules to Python tests that import their package sidecar", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-cython-"));
    await mkdir(path.join(root, "sklearn", "cluster"), { recursive: true });
    await mkdir(path.join(root, "sklearn", "cluster", "tests"), { recursive: true });
    await writeFile(
      path.join(root, "sklearn", "cluster", "_dbscan_inner.pyx"),
      `from libcpp.vector cimport vector

def dbscan_inner(is_core, neighborhoods, labels):
    cdef vector[int] stack
    return labels
`
    );
    await writeFile(
      path.join(root, "sklearn", "cluster", "tests", "test_dbscan.py"),
      `from sklearn.cluster import _dbscan_inner

def test_dbscan_inner_core_neighborhoods():
    labels = _dbscan_inner.dbscan_inner([True], [[0]], [-1])
    assert labels is not None
`
    );
    await writeFile(
      path.join(root, "sklearn", "cluster", "tests", "test_other.py"),
      `def test_unrelated():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "sklearn/cluster/_dbscan_inner.pyx",
      symbol: "dbscan_inner",
      terms: ["core", "neighborhoods"],
      limit: 2
    });

    expect(result.matches[0]).toMatchObject({
      file: "sklearn/cluster/tests/test_dbscan.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test imports source module", "test body mentions source symbol", "test calls source symbol"])
    );
  });

  test("links Go source files to table-driven subtests through imports, calls, and source stems", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-go-"));
    await mkdir(path.join(root, "internal", "server"), { recursive: true });
    await mkdir(path.join(root, "test", "integration"), { recursive: true });
    await writeFile(
      path.join(root, "internal", "server", "handler.go"),
      `package server

type Handler struct{}

func (h *Handler) Serve(key string) error {
    return nil
}
`
    );
    await writeFile(
      path.join(root, "test", "integration", "handler_behavior_test.go"),
      `package integration

import (
    "testing"

    "github.com/acme/project/internal/server"
)

func TestHandlerServe(t *testing.T) {
    tests := []struct {
        name string
        key string
    }{
        {name: "missing record", key: "missing"},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            handler := &server.Handler{}
            if err := handler.Serve(tt.key); err != nil {
                t.Fatal(err)
            }
        })
    }
}
`
    );
    await writeFile(
      path.join(root, "test", "integration", "unrelated_test.go"),
      `package integration

import "testing"

func TestUnrelated(t *testing.T) {
    t.Fatal("unrelated")
}
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "internal/server/handler.go",
      symbol: "Handler.Serve",
      terms: ["missing", "record"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "test/integration/handler_behavior_test.go"
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test imports source module", "test calls source symbol", "test path includes source stem", "test body matches task terms"])
    );
    expect(result.matches[0].symbols).toEqual(expect.arrayContaining(["TestHandlerServe", "TestHandlerServe.subtest_missing_record"]));
  });

  test("links C source files to tests through header includes, calls, and source stems", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-c-"));
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
      `#include "../include/cache.h"

CacheEntry *cache_lookup(CacheEntry *head, const char *key) {
    return head;
}
`
    );
    await writeFile(
      path.join(root, "tests", "test_cache_lookup.c"),
      `#include "../include/cache.h"

void test_cache_lookup_missing_key(void) {
    cache_lookup(0, "missing");
}
`
    );
    await writeFile(
      path.join(root, "tests", "test_unrelated.c"),
      `void test_unrelated(void) {}
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/cache.c",
      symbol: "cache_lookup",
      terms: ["missing", "key"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_cache_lookup.c"
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test imports source module", "test calls source symbol", "test path includes source stem", "test body matches task terms"])
    );
    expect(result.matches[0].symbols).toEqual(expect.arrayContaining(["test_cache_lookup_missing_key"]));
  });

  test("links PHP source files to PHPUnit tests through imports, calls, and source stems", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-php-"));
    await mkdir(path.join(root, "app", "Services"), { recursive: true });
    await mkdir(path.join(root, "tests", "Feature"), { recursive: true });
    await writeFile(
      path.join(root, "app", "Services", "CheckoutService.php"),
      `<?php

namespace App\\Services;

final class CheckoutService
{
    public function findOrderWithLineItems(string $id): array
    {
        return ['id' => $id, 'line_items' => []];
    }
}
`
    );
    await writeFile(
      path.join(root, "tests", "Feature", "CheckoutServiceTest.php"),
      `<?php

use App\\Services\\CheckoutService;

it('loads line items for an order', function () {
    $order = (new CheckoutService())->findOrderWithLineItems('ord_123');
    expect($order['line_items'])->toBeArray();
});
`
    );
    await writeFile(
      path.join(root, "tests", "Feature", "UnrelatedTest.php"),
      `<?php

it('does something unrelated', function () {
    expect(true)->toBeTrue();
});
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "app/Services/CheckoutService.php",
      symbol: "CheckoutService::findOrderWithLineItems",
      terms: ["line", "items", "order"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/Feature/CheckoutServiceTest.php"
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test imports source module", "test calls source symbol", "test path includes source stem", "test body matches task terms"])
    );
    expect(result.matches[0].symbols).toEqual(
      expect.arrayContaining(["tests/Feature/CheckoutServiceTest.php::it.loads.line.items.for.an.order"])
    );
  });

  test("links Rust source files to integration tests through use imports and method calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-rust-"));
    await mkdir(path.join(root, "src", "runtime"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "src", "runtime", "mod.rs"),
      `pub struct Runtime;

impl Runtime {
    pub fn spawn(&self, task: Task) {
        schedule(task);
    }
}
`
    );
    await writeFile(
      path.join(root, "tests", "runtime_tests.rs"),
      `use agent_runtime::runtime::Runtime;

#[test]
fn spawns_task_on_runtime() {
    let runtime = Runtime;
    runtime.spawn(task());
}
`
    );
    await writeFile(
      path.join(root, "tests", "unrelated_tests.rs"),
      `#[test]
fn unrelated() {
    assert!(true);
}
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/runtime/mod.rs",
      symbol: "runtime.Runtime.spawn",
      terms: ["spawn", "task"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/runtime_tests.rs"
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test imports source module", "test calls source symbol", "test body matches task terms"])
    );
    expect(result.matches[0].symbols).toEqual(expect.arrayContaining(["runtime_tests.spawns_task_on_runtime"]));
  });

  test("links C++ source files to gtest coverage through includes, calls, and source stems", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-cpp-"));
    await mkdir(path.join(root, "source", "common", "router"), { recursive: true });
    await mkdir(path.join(root, "test", "common", "router"), { recursive: true });
    await writeFile(
      path.join(root, "source", "common", "router", "route_matcher.cc"),
      `#include "source/common/router/route_matcher.h"

namespace envoy::router {

class RouteMatcher {
public:
  MatchResult MatchRoute(const RequestHeaders& headers) const {
    return trie_->Find(headers.Path());
  }
};

}  // namespace envoy::router
`
    );
    await writeFile(
      path.join(root, "test", "common", "router", "route_matcher_test.cc"),
      `#include "source/common/router/route_matcher.h"

#include "gtest/gtest.h"

namespace envoy::router {

TEST(RouteMatcherTest, MatchRouteFindsRouteEntry) {
  RouteMatcher matcher;
  EXPECT_TRUE(matcher.MatchRoute(RequestHeaders()).ok());
}

}  // namespace envoy::router
`
    );
    await writeFile(
      path.join(root, "test", "common", "router", "unrelated_test.cc"),
      `#include "gtest/gtest.h"

TEST(UnrelatedTest, DoesNothing) {
  EXPECT_TRUE(true);
}
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "source/common/router/route_matcher.cc",
      symbol: "envoy::router::RouteMatcher.MatchRoute",
      terms: ["route", "entry"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "test/common/router/route_matcher_test.cc"
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test imports source module", "test calls source symbol", "test path includes source stem", "test body matches task terms"])
    );
    expect(result.matches[0].symbols).toEqual(expect.arrayContaining(["envoy::router::RouteMatcherTest.MatchRouteFindsRouteEntry"]));
  });

  test("links C# source files to xUnit, NUnit, or MSTest-style coverage through using directives, calls, and source stems", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-csharp-"));
    await mkdir(path.join(root, "src", "Checkout.Api", "Controllers"), { recursive: true });
    await mkdir(path.join(root, "tests", "Checkout.Api.Tests", "Controllers"), { recursive: true });
    await writeFile(
      path.join(root, "src", "Checkout.Api", "Controllers", "CheckoutController.cs"),
      `namespace Acme.Checkout.Api.Controllers;

public sealed class CheckoutController
{
    public CheckoutReceipt Submit(CheckoutCommand command)
    {
        return Handle(command);
    }
}
`
    );
    await writeFile(
      path.join(root, "tests", "Checkout.Api.Tests", "Controllers", "CheckoutControllerTests.cs"),
      `using Acme.Checkout.Api.Controllers;
using Xunit;

namespace Acme.Checkout.Api.Tests.Controllers;

public sealed class CheckoutControllerTests
{
    [Fact]
    public void Submit_returns_receipt_for_valid_command()
    {
        var controller = new CheckoutController();
        var receipt = controller.Submit(new CheckoutCommand());
        Assert.NotNull(receipt);
    }
}
`
    );
    await writeFile(
      path.join(root, "tests", "Checkout.Api.Tests", "Controllers", "UnrelatedTests.cs"),
      `using Xunit;

public sealed class UnrelatedTests
{
    [Fact]
    public void Does_nothing()
    {
        Assert.True(true);
    }
}
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/Checkout.Api/Controllers/CheckoutController.cs",
      symbol: "Acme.Checkout.Api.Controllers.CheckoutController.Submit",
      terms: ["receipt", "valid", "command"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/Checkout.Api.Tests/Controllers/CheckoutControllerTests.cs"
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test imports source module", "test calls source symbol", "test path includes source stem", "test body matches task terms"])
    );
    expect(result.matches[0].symbols).toEqual(
      expect.arrayContaining(["Acme.Checkout.Api.Tests.Controllers.CheckoutControllerTests.Submit_returns_receipt_for_valid_command"])
    );
  });

  test("links C# tests through indexed source namespaces when paths do not mirror namespaces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-csharp-namespace-"));
    await mkdir(path.join(root, "src", "Web", "Controllers"), { recursive: true });
    await mkdir(path.join(root, "tests", "Behavior"), { recursive: true });
    await writeFile(
      path.join(root, "src", "Web", "Controllers", "CheckoutEndpoint.cs"),
      `namespace Acme.Checkout.Api.Controllers;

public sealed class CheckoutEndpoint
{
    public CheckoutReceipt Submit(CheckoutCommand command)
    {
        return new CheckoutReceipt(command.Id);
    }
}
`
    );
    await writeFile(
      path.join(root, "tests", "Behavior", "SubmissionBehaviorTests.cs"),
      `using Acme.Checkout.Api.Controllers;
using Xunit;

namespace Acme.Checkout.Tests.Behavior;

public sealed class SubmissionBehaviorTests
{
    [Fact]
    public void Submit_returns_receipt_for_command()
    {
        var endpoint = new CheckoutEndpoint();
        var receipt = endpoint.Submit(new CheckoutCommand());
        Assert.NotNull(receipt);
    }
}
`
    );
    await writeFile(
      path.join(root, "tests", "Behavior", "UnrelatedTests.cs"),
      `using Xunit;

public sealed class UnrelatedTests
{
    [Fact]
    public void Does_nothing()
    {
        Assert.True(true);
    }
}
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/Web/Controllers/CheckoutEndpoint.cs",
      limit: 1
    });

    expect(result.candidateFilesScored).toBe(1);
    expect(result.matches[0]).toMatchObject({
      file: "tests/Behavior/SubmissionBehaviorTests.cs"
    });
    expect(result.matches[0].why).toContain("test imports source module");
  });

  test("can batch related-test discovery for multiple source symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-batch-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "alpha.py"), "def alpha_workflow():\n    return 'alpha'\n");
    await writeFile(path.join(root, "pkg", "bravo.py"), "def bravo_workflow():\n    return 'bravo'\n");
    await writeFile(
      path.join(root, "tests", "test_alpha.py"),
      `from pkg.alpha import alpha_workflow

def test_alpha_workflow():
    assert alpha_workflow() == "alpha"
`
    );
    await writeFile(
      path.join(root, "tests", "test_bravo.py"),
      `from pkg.bravo import bravo_workflow

def test_bravo_workflow():
    assert bravo_workflow() == "bravo"
`
    );
    await indexTarget(root);

    const results = findRelatedTestsBatch({
      target: root,
      sources: [
        { sourceFile: "pkg/alpha.py", symbol: "alpha_workflow" },
        { sourceFile: "pkg/bravo.py", symbol: "bravo_workflow" }
      ],
      limit: 1
    });

    expect(results.map((result) => result.sourceFile)).toEqual(["pkg/alpha.py", "pkg/bravo.py"]);
    expect(results.map((result) => result.matches[0].file)).toEqual(["tests/test_alpha.py", "tests/test_bravo.py"]);
  });

  test("multi-source discovery counts shared candidate rows once", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-shared-candidates-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "alpha.py"), "def alpha_workflow():\n    return 'alpha'\n");
    await writeFile(path.join(root, "pkg", "bravo.py"), "def bravo_workflow():\n    return 'bravo'\n");
    await writeFile(
      path.join(root, "tests", "test_alpha.py"),
      `from pkg.alpha import alpha_workflow

def test_alpha_workflow():
    assert alpha_workflow() == "alpha"
`
    );
    await writeFile(
      path.join(root, "tests", "test_bravo.py"),
      `from pkg.bravo import bravo_workflow

def test_bravo_workflow():
    assert bravo_workflow() == "bravo"
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/alpha.py",
      sourceFiles: ["pkg/alpha.py", "pkg/bravo.py"],
      terms: ["workflow"],
      limit: 2
    });

    expect(result.candidateFilesScored).toBe(2);
    expect(result.matches.map((match) => match.file)).toEqual(["tests/test_alpha.py", "tests/test_bravo.py"]);
  });

  test("keeps the discovered source symbol for the primary source in multi-source discovery", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-multi-source-symbol-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "routing.py"), "def serialize_response(value):\n    return value\n");
    await writeFile(path.join(root, "pkg", "applications.py"), "def response_model_endpoint(value):\n    return value\n");
    await writeFile(
      path.join(root, "tests", "test_schema_ref.py"),
      `from pkg import applications

def test_endpoint_response_model_schema():
    assert applications.response_model_endpoint("validate serialize endpoint return response model")
`
    );
    for (let index = 0; index < 20; index += 1) {
      await writeFile(
        path.join(root, "tests", `test_schema_ref_${index}.py`),
        `from pkg import applications

def test_endpoint_response_model_schema_${index}():
    assert applications.response_model_endpoint("validate serialize endpoint return response model")
`
      );
    }
    await writeFile(
      path.join(root, "tests", "test_serialize_response_model.py"),
      `def test_response_model_return_value_is_serialized():
    response_model = {"name": "x"}
    serialized = "endpoint return response model"
    assert response_model and serialized
`
    );
    await writeFile(
      path.join(root, "tests", "test_serialize_response_plain.py"),
      `def test_response_model_return_value_is_serialized_plain():
    response_model = {"name": "x"}
    serialized = "endpoint return response model"
    assert response_model and serialized
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/routing.py",
      sourceFiles: ["pkg/routing.py", "pkg/applications.py"],
      symbol: "serialize_response",
      terms: ["validate", "serialize", "endpoint", "return", "response", "model"],
      limit: 2
    });

    expect(result.candidateFilesScored).toBeLessThan(10);
    expect(result.matches[0]).toMatchObject({
      file: "tests/test_serialize_response_model.py"
    });
    expect(result.matches[0].why).toContain("test path includes symbol name");
  });

  test("uses source-symbol path candidates before broad task-term test floods", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-symbol-path-prune-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests", "noise"), { recursive: true });
    await writeFile(path.join(root, "pkg", "routing.py"), "def serialize_response(value):\n    return value\n");
    await writeFile(path.join(root, "pkg", "applications.py"), "def serialize_endpoint(value):\n    return value\n");
    for (const suffix of ["model", "dataclass", "plain"]) {
      await writeFile(
        path.join(root, "tests", `test_serialize_response_${suffix}.py`),
        `def test_serialize_response_${suffix}():
    response_model = "endpoint return response model"
    assert response_model
`
      );
    }
    for (let index = 0; index < 30; index += 1) {
      await writeFile(
        path.join(root, "tests", "noise", `test_schema_${index}.py`),
        `def test_schema_${index}():
    assert "validate serialize endpoint return response model"
`
      );
    }
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/routing.py",
      sourceFiles: ["pkg/routing.py", "pkg/applications.py"],
      symbol: "serialize_response",
      terms: ["validate", "serialize", "endpoint", "return", "response", "model"],
      limit: 3
    });

    expect(result.candidateFilesScored).toBeLessThan(10);
    expect(result.matches.map((match) => match.file)).toEqual([
      "tests/test_serialize_response_model.py",
      "tests/test_serialize_response_dataclass.py",
      "tests/test_serialize_response_plain.py"
    ]);
    expect(result.matches[0].why).toContain("test path includes symbol name");
  });

  test("hydrates highest-evidence candidate tests before broad task-term candidates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-ranked-candidate-page-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests", "noise"), { recursive: true });
    await writeFile(path.join(root, "pkg", "response.py"), "def close_streaming_response(iterator):\n    return iterator\n");
    await writeFile(
      path.join(root, "tests", "test_httpwrappers.py"),
      `def test_streaming_response_cleanup_iterator_resources():
    assert "streaming async cleanup iterator resources streaming cleanup"
`
    );
    for (let index = 0; index < 40; index += 1) {
      await writeFile(
        path.join(root, "tests", "noise", `test_async_cleanup_${index}.py`),
        `def test_async_cleanup_${index}():
    assert "streaming async cleanup"
`
      );
    }
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/response.py",
      symbol: "close_streaming_response",
      terms: ["streaming", "async", "cleanup", "iterator", "resources"],
      limit: 1
    });

    expect(result.candidateFilesScored).toBeLessThan(20);
    expect(result.matches[0]).toMatchObject({
      file: "tests/test_httpwrappers.py"
    });
  });

  test("prunes unrelated test files before scoring full text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-pruned-candidates-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests", "client"), { recursive: true });
    await mkdir(path.join(root, "tests", "noise"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client.py"), "def send_redirect():\n    return 'redirect'\n");
    await writeFile(
      path.join(root, "tests", "client", "test_redirects.py"),
      `from pkg import client

def test_redirect_history():
    assert client.send_redirect() == "redirect"
`
    );
    for (let index = 0; index < 40; index += 1) {
      await writeFile(
        path.join(root, "tests", "noise", `test_noise_${index}.py`),
        `def test_noise_${index}():
    unrelated_payload = "${"noise ".repeat(200)}"
    assert unrelated_payload
`
      );
    }
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client.py",
      symbol: "send_redirect",
      terms: ["redirect", "history"],
      limit: 1
    });

    expect(result.candidateFilesScored).toBeLessThan(10);
    expect(result.matches[0]).toMatchObject({
      file: "tests/client/test_redirects.py"
    });
  });

  test("does not let broad task terms or package roots flood candidate tests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-broad-path-prune-"));
    await mkdir(path.join(root, "networkx", "classes"), { recursive: true });
    await mkdir(path.join(root, "networkx", "classes", "tests"), { recursive: true });
    await mkdir(path.join(root, "networkx", "algorithms", "tests"), { recursive: true });
    await writeFile(path.join(root, "networkx", "classes", "function.py"), "def path_weight():\n    return 1\n");
    await writeFile(
      path.join(root, "networkx", "classes", "tests", "test_function.py"),
      `from networkx.classes import function

def test_pathweight():
    assert function.path_weight() == 1
`
    );
    for (let index = 0; index < 30; index += 1) {
      await writeFile(
        path.join(root, "networkx", "algorithms", "tests", `test_weight_path_${index}.py`),
        `def test_weight_path_${index}():
    assert "path weight default"
`
      );
    }
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "networkx/classes/function.py",
      symbol: "path_weight",
      terms: ["path", "cost", "edge", "weight", "missing", "default", "invalid"],
      limit: 1
    });

    expect(result.candidateFilesScored).toBeLessThan(5);
    expect(result.matches[0]).toMatchObject({
      file: "networkx/classes/tests/test_function.py"
    });
  });

  test("ignores generic source package directories when source stem identifies tests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-generic-package-token-prune-"));
    await mkdir(path.join(root, "networkx", "algorithms"), { recursive: true });
    await mkdir(path.join(root, "networkx", "algorithms", "tests"), { recursive: true });
    await mkdir(path.join(root, "networkx", "algorithms", "approximation", "tests"), { recursive: true });
    await writeFile(path.join(root, "networkx", "algorithms", "cuts.py"), "def mixing_expansion(graph):\n    return graph\n");
    await writeFile(
      path.join(root, "networkx", "algorithms", "tests", "test_cuts.py"),
      `from networkx.algorithms import cuts

def test_mixing_expansion():
    assert cuts.mixing_expansion("weighted total graph size") == "weighted total graph size"
`
    );
    for (let index = 0; index < 60; index += 1) {
      await writeFile(
        path.join(root, "networkx", "algorithms", "approximation", "tests", `test_algorithm_${index}.py`),
        `def test_algorithm_${index}():
    assert "weighted graph size"
`
      );
    }
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "networkx/algorithms/cuts.py",
      symbol: "mixing_expansion",
      terms: ["weighted", "graph", "size"],
      limit: 5
    });

    expect(result.candidateFilesScored).toBeLessThan(10);
    expect(result.matches[0]).toMatchObject({
      file: "networkx/algorithms/tests/test_cuts.py"
    });
  });

  test("uses high-signal import candidates instead of broad fallback scans", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-prune-fallback-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests", "noise"), { recursive: true });
    await mkdir(path.join(root, "tests", "regression"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client.py"), "def send_redirect():\n    return 'redirect'\n");
    await writeFile(
      path.join(root, "tests", "noise", "test_redirect_placeholder.py"),
      `def test_placeholder():
    assert True
`
    );
    await writeFile(
      path.join(root, "tests", "regression", "test_behavior.py"),
      `from pkg import client

def test_history_behavior():
    assert client.send_redirect() == "redirect"
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client.py",
      symbol: "send_redirect",
      terms: ["redirect"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/regression/test_behavior.py"
    });
    expect(result.candidateFilesScored).toBe(1);
  });

  test("merges related tests across multiple plausible source files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-multi-source-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "reporting.py"),
      `def format_report_section(phase):
    return f"Captured stdout during {phase}"
`
    );
    await writeFile(
      path.join(root, "pkg", "capture.py"),
      `def route_captured_output(phase):
    return f"captured stdout stderr {phase}"
`
    );
    await writeFile(
      path.join(root, "tests", "test_reporting.py"),
      `from pkg.reporting import format_report_section

def test_report_section_label():
    assert format_report_section("setup")
`
    );
    await writeFile(
      path.join(root, "tests", "test_capture.py"),
      `from pkg.capture import route_captured_output

def test_captured_stdout_stderr_setup_call_teardown():
    for phase in ["setup", "call", "teardown"]:
        assert route_captured_output(phase)
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/reporting.py",
      sourceFiles: ["pkg/reporting.py", "pkg/capture.py"],
      terms: ["captured", "stdout", "stderr", "setup", "call", "teardown", "report", "section"],
      limit: 1
    });

    expect(result.sourceFile).toBe("pkg/reporting.py");
    expect(result.sourceFiles).toEqual(["pkg/reporting.py", "pkg/capture.py"]);
    expect(result.matches[0]).toMatchObject({
      file: "tests/test_capture.py"
    });
  });

  test("uses task terms to disambiguate tests that import the same source module", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-task-terms-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests", "client"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client.py"), "def send_redirect():\n    return 'redirect'\n");
    await writeFile(
      path.join(root, "tests", "client", "test_auth.py"),
      `from pkg import client

def test_auth_flow():
    assert client.send_redirect()
`
    );
    await writeFile(
      path.join(root, "tests", "client", "test_redirects.py"),
      `from pkg import client

def test_next_request_preserves_redirect_history():
    next_request = client.send_redirect()
    assert next_request == "redirect"
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client.py",
      symbol: "send_redirect",
      terms: ["next_request", "redirect", "history"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/client/test_redirects.py"
    });
    expect(result.matches[0].why).toContain("test body matches task terms");
  });

  test("uses task terms in test paths to rank behavior-focused test files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-task-path-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "routing.py"), "def serialize_response(value):\n    return value\n");
    await writeFile(
      path.join(root, "tests", "test_custom_route_class.py"),
      `from pkg import routing

def test_custom_route_class_response_model():
    assert routing.serialize_response({"name": "x"})
`
    );
    await writeFile(
      path.join(root, "tests", "test_serialize_response_model.py"),
      `def test_response_model_return_value_is_serialized():
    response_model = {"name": "x"}
    serialized = "endpoint return response model"
    assert response_model and serialized
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/routing.py",
      terms: ["validate", "serialize", "endpoint", "return", "response", "model"],
      limit: 2
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_serialize_response_model.py"
    });
    expect(result.matches[0].why).toContain("test path matches task terms");
  });

  test("uses dense task-term coverage to find behavior tests outside mirrored source paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-task-term-candidates-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await mkdir(path.join(root, "tests", "engine"), { recursive: true });
    await mkdir(path.join(root, "tests", "sql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "default.py"),
      `def setup_result_proxy(cursor):
    return cursor.rowcount
`
    );
    await writeFile(
      path.join(root, "tests", "engine", "test_execute.py"),
      `from pkg.engine import default

def test_execute_cursor():
    assert default.setup_result_proxy(object())
`
    );
    await writeFile(
      path.join(root, "tests", "sql", "test_resultset.py"),
      `def test_rowcount_always_called_when_preserved():
    cursor = "cursor"
    rowcount = "rowcount"
    statements = ["select", "insert", "update", "delete"]
    preserve = "preserve"
    assert cursor and rowcount and statements and preserve
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/engine/default.py",
      terms: ["cursor", "rowcount", "preserve", "select", "insert", "update", "delete"],
      limit: 2
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/sql/test_resultset.py"
    });
    expect(result.matches[0].why).toContain("strong task-term coverage");
  });

  test("uses FTS task-term candidates before substring fallback scans", () => {
    const candidateQuery = relatedTestCandidateSqlForTesting({
      target: "/repo",
      sourceFile: "django/http/response.py",
      terms: ["streaming", "async", "cleanup", "iterator", "resources"]
    });

    expect(candidateQuery.sql).toContain("chunk_fts match");
    expect(candidateQuery.fallbackSql).toContain("lower(candidate_c.text) like");
  });

  test("does not hydrate test symbols while scoring candidate rows", () => {
    const rowQuery = relatedTestRowSqlForTesting(["tests/sql/test_resultset.py"]);

    expect(rowQuery).not.toContain("test_symbols");
    expect(rowQuery).not.toContain("group_concat(qualified_name) as symbols");
    expect(rowQuery).toContain("test_edges");
  });

  test("filters candidate test row text by task terms before grouping", () => {
    const rowQuery = relatedTestRowSqlForTesting(["tests/sql/test_resultset.py"], ["rowcount", "preserve"]);

    expect(rowQuery).toContain("candidate_chunks");
    expect(rowQuery).toContain("lower(c.text) like @testTextTerm0");
    expect(rowQuery).toContain("lower(c.text) like @testTextTerm1");
    expect(rowQuery).toContain("group_concat(candidate_chunks.text");
  });

  test("hydrates compact task-relevant symbols for large related test files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-compact-symbols-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "result.py"),
      `class CursorResult:
    def rowcount(self):
        return 1
`
    );
    await writeFile(
      path.join(root, "tests", "test_resultset.py"),
      `from pkg.result import CursorResult


class CursorResultTest:
${Array.from({ length: 80 }, (_, index) => `    def test_unrelated_${index}(self):\n        assert True\n`).join("\n")}
    def cursor_wrapper(self):
        return CursorResult()

    def test_no_rowcount_on_selects_inserts(self):
        result = self.cursor_wrapper()
        assert result.rowcount() == 1

    def test_rowcount_always_called_when_preserve_rowcount(self):
        result = self.cursor_wrapper()
        assert result.rowcount() == 1
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/result.py",
      symbol: "CursorResult.rowcount",
      terms: ["cursor", "rowcount", "select", "insert", "preserve"],
      limit: 1
    });

    expect(result.matches[0].symbols).toEqual(
      expect.arrayContaining([
        "CursorResultTest.cursor_wrapper",
        "CursorResultTest.test_no_rowcount_on_selects_inserts",
        "CursorResultTest.test_rowcount_always_called_when_preserve_rowcount"
      ])
    );
    expect(result.matches[0].symbols).not.toContain("CursorResultTest.test_unrelated_0");
    expect(result.matches[0].symbols.length).toBeLessThanOrEqual(32);
  });

  test("falls back to substring task-term candidates when FTS tokenization misses compounds", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-fts-fallback-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await mkdir(path.join(root, "tests", "sql"), { recursive: true });
    await writeFile(path.join(root, "pkg", "engine", "default.py"), "def setup_result_proxy(cursor):\n    return cursor.rowcount\n");
    await writeFile(
      path.join(root, "tests", "sql", "test_resultset.py"),
      `def test_rowcount_preserved():
    cursor = "cursor"
    rowcount = "rowcount"
    preserve = "preserve"
    assert cursor and rowcount and preserve
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/engine/default.py",
      terms: ["cursor", "row count", "preserve"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/sql/test_resultset.py"
    });
  });

  test("matches imports for common src package layouts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-src-layout-"));
    await mkdir(path.join(root, "src", "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "src", "pkg", "service.py"), "def create_client():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "test_api_behavior.py"),
      `from pkg import service

def test_client_factory():
    assert service.create_client() is not None
`
    );
    await writeFile(
      path.join(root, "tests", "test_unrelated.py"),
      `def test_unrelated():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/pkg/service.py"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_api_behavior.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toContain("test imports source module");
  });

  test("resolves JavaScript relative imports to source files for related-test ranking", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-js-relative-imports-"));
    await mkdir(path.join(root, "src", "runtime"), { recursive: true });
    await mkdir(path.join(root, "specs", "browser"), { recursive: true });
    await mkdir(path.join(root, "specs", "noise"), { recursive: true });
    await writeFile(
      path.join(root, "src", "runtime", "client.ts"),
      `export function createRuntimeClient(config) {
  return { config };
}
`
    );
    await writeFile(
      path.join(root, "specs", "browser", "http.spec.ts"),
      `import { createRuntimeClient } from "../../src/runtime/client";

describe("browser http behavior", () => {
  it("creates a runtime client", () => {
    expect(createRuntimeClient({ baseUrl: "/" }).config.baseUrl).toBe("/");
  });
});
`
    );
    await writeFile(
      path.join(root, "specs", "noise", "runtime.spec.ts"),
      `describe("runtime words", () => {
  it("mentions client config terms without importing the source", () => {
    expect("runtime client config create").toBeTruthy();
  });
});
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/runtime/client.ts",
      symbol: "createRuntimeClient",
      terms: ["runtime", "client", "config"],
      limit: 2
    });

    expect(result.matches[0]).toMatchObject({
      file: "specs/browser/http.spec.ts"
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test imports source module", "test calls source symbol"])
    );
  });

  test("resolves TypeScript index imports to source index modules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-ts-index-imports-"));
    await mkdir(path.join(root, "src", "features", "payments"), { recursive: true });
    await mkdir(path.join(root, "tests", "integration"), { recursive: true });
    await writeFile(
      path.join(root, "src", "features", "payments", "index.ts"),
      `export function createPaymentIntent(params) {
  return params;
}
`
    );
    await writeFile(
      path.join(root, "tests", "integration", "checkout.test.ts"),
      `import { createPaymentIntent } from "../../src/features/payments";

test("checkout creates payment intent", () => {
  expect(createPaymentIntent({ amount: 100 }).amount).toBe(100);
});
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/features/payments/index.ts",
      symbol: "createPaymentIntent",
      terms: ["checkout", "payment", "intent"],
      limit: 1
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/integration/checkout.test.ts"
    });
    expect(result.matches[0].why).toContain("test imports source module");
  });

  test("resolves common TypeScript path aliases to source modules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-ts-path-aliases-"));
    await mkdir(path.join(root, "src", "client"), { recursive: true });
    await mkdir(path.join(root, "src", "client", "__tests__"), { recursive: true });
    await writeFile(
      path.join(root, "src", "client", "api.ts"),
      `export function createClient(options) {
  return { options };
}
`
    );
    await writeFile(
      path.join(root, "src", "client", "__tests__", "api.test.ts"),
      `import { createClient } from "@/client/api";

test.each([
  ["/api"],
  ["/rpc"]
])("createClient forwards base url %s", (baseUrl) => {
  expect(createClient({ baseUrl }).options.baseUrl).toBe(baseUrl);
});
`
    );
    await writeFile(
      path.join(root, "src", "client", "__tests__", "noise.test.ts"),
      `test("mentions create client words without alias import", () => {
  expect("create client api base url").toBeTruthy();
});
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/client/api.ts",
      symbol: "createClient",
      terms: ["createClient", "base url"],
      limit: 2
    });

    expect(result.matches[0]).toMatchObject({
      file: "src/client/__tests__/api.test.ts",
      symbols: ["test_createClient_forwards_base_url_s"]
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test imports source module", "test calls source symbol"])
    );
  });

  test("uses fixture arguments that match the source file stem", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-fixture-stem-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "cache.py"), "def load_value(key):\n    return key\n");
    await writeFile(
      path.join(root, "tests", "test_runtime_behavior.py"),
      `def test_runtime_cache(cache):
    assert cache.load_value("x") == "x"
`
    );
    await writeFile(
      path.join(root, "tests", "test_unrelated.py"),
      `def test_unrelated(other):
    assert other
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/cache.py"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_runtime_behavior.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toContain("test uses related fixture");
  });

  test("uses fixture arguments that match noun-like source symbol suffixes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-fixture-symbol-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "factory.py"), "def create_client():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "test_runtime_behavior.py"),
      `def test_runtime_client(client):
    assert client is not None
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/factory.py",
      symbol: "create_client"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_runtime_behavior.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toContain("test uses related fixture");
  });

  test("uses parametrized cases to disambiguate related tests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-parametrize-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client.py"), "def send_request():\n    return 'ok'\n");
    await writeFile(
      path.join(root, "tests", "test_auth.py"),
      `from pkg import client

def test_auth_flow():
    assert client.send_request() == "ok"
`
    );
    await writeFile(
      path.join(root, "tests", "test_redirects.py"),
      `import pytest
from pkg import client

@pytest.mark.parametrize(
    "status, expected",
    [(302, "redirect-history"), (303, "redirect-history")],
    ids=["redirect-history-302", "redirect-history-303"],
)
def test_redirect_history(status, expected):
    assert client.send_request() == "ok"
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client.py",
      symbol: "send_request",
      terms: ["redirect", "history"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_redirects.py",
      firstLine: 2
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["parametrized cases match task terms", "test body matches task terms"])
    );
  });

  test("uses parametrized cases that mention source target aliases", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-parametrize-target-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "factory.py"), "def create_client():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "test_factory_cases.py"),
      `import pytest

@pytest.mark.parametrize("kind", ["client", "client-alias"])
def test_runtime_factory(kind):
    assert kind
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/factory.py",
      symbol: "create_client"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_factory_cases.py",
      firstLine: 3
    });
    expect(result.matches[0].why).toContain("parametrized cases mention source target");
  });

  test("uses mirrored package layout when test filenames do not name the source file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-layout-"));
    await mkdir(path.join(root, "pkg", "client"), { recursive: true });
    await mkdir(path.join(root, "tests", "client"), { recursive: true });
    await mkdir(path.join(root, "tests", "server"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client", "session.py"), "def open_session():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "client", "test_runtime_behavior.py"),
      `def test_runtime_behavior():
    assert True
`
    );
    await writeFile(
      path.join(root, "tests", "server", "test_runtime_behavior.py"),
      `def test_runtime_behavior():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client/session.py"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/client/test_runtime_behavior.py"
    });
    expect(result.matches[0].why).toContain("test path mirrors source package layout");
    expect(result.matches.map((match) => match.file)).not.toContain("tests/server/test_runtime_behavior.py");
  });

  test("prefers external regression tests over package test helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-external-root-"));
    await mkdir(path.join(root, "pkg", "http"), { recursive: true });
    await mkdir(path.join(root, "pkg", "test"), { recursive: true });
    await mkdir(path.join(root, "tests", "httpwrappers"), { recursive: true });
    await writeFile(path.join(root, "pkg", "http", "response.py"), "def stream_response():\n    return 'streaming response'\n");
    await writeFile(
      path.join(root, "pkg", "test", "client.py"),
      `from pkg.http import response

def test_client_response_helper():
    assert response.stream_response()
`
    );
    await writeFile(
      path.join(root, "tests", "httpwrappers", "tests.py"),
      `from pkg.http import response

def test_streaming_response_cleanup():
    assert response.stream_response() == "streaming response"
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/http/response.py",
      terms: ["streaming", "response", "cleanup"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/httpwrappers/tests.py"
    });
    expect(result.matches[0].why).toContain("external test root");
  });

  test("ignores generic mirrored layout tokens", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-layout-stopwords-"));
    await mkdir(path.join(root, "pkg", "core"), { recursive: true });
    await mkdir(path.join(root, "tests", "core"), { recursive: true });
    await writeFile(path.join(root, "pkg", "core", "engine.py"), "def run_engine():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "core", "test_runtime_behavior.py"),
      `def test_runtime_behavior():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/core/engine.py"
    });

    expect(result.matches).toEqual([]);
  });

  test("uses Rust integration-test imports and calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-rust-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "src", "cache.rs"),
      `pub fn load_value(key: &str) -> String {
    key.to_string()
}
`
    );
    await writeFile(
      path.join(root, "tests", "cache_integration.rs"),
      `use crate::cache::load_value;

#[test]
fn preserves_loaded_value() {
    assert_eq!(load_value("x"), "x");
}
`
    );
    await writeFile(
      path.join(root, "tests", "noise.rs"),
      `#[test]
fn mentions_cache_without_calling_source() {
    let cache_label = "cache";
    assert_eq!(cache_label, "cache");
}
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/cache.rs",
      symbol: "load_value",
      terms: ["loaded", "value"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/cache_integration.rs",
      firstLine: 1
    });
    expect(result.matches[0].why).toEqual(expect.arrayContaining(["test imports source module", "test calls source symbol"]));
  });

  test("resolves SwiftPM testable imports and XCTest method calls to source files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-swift-"));
    await mkdir(path.join(root, "Sources", "App"), { recursive: true });
    await mkdir(path.join(root, "Tests", "AppTests"), { recursive: true });
    await writeFile(
      path.join(root, "Sources", "App", "CheckoutViewModel.swift"),
      `import Foundation

struct CheckoutViewModel {
    func submit(cart: Cart) async throws -> Receipt {
        try await ReceiptLoader().load(cart)
    }
}
`
    );
    await writeFile(
      path.join(root, "Tests", "AppTests", "CheckoutViewModelTests.swift"),
      `import XCTest
@testable import App

final class CheckoutViewModelTests: XCTestCase {
    func testSubmitLoadsReceipt() async throws {
        let model = CheckoutViewModel()
        let receipt = try await model.submit(cart: .fixture)
        XCTAssertEqual(receipt.id, "fixture")
    }
}
`
    );
    await writeFile(
      path.join(root, "Tests", "AppTests", "NoiseTests.swift"),
      `import XCTest

final class NoiseTests: XCTestCase {
    func testMentionsCheckoutWords() {
        XCTAssertTrue("checkout submit receipt".isEmpty == false)
    }
}
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "Sources/App/CheckoutViewModel.swift",
      symbol: "CheckoutViewModel.submit",
      terms: ["submit", "receipt"],
      limit: 2
    });

    expect(result.matches[0]).toMatchObject({
      file: "Tests/AppTests/CheckoutViewModelTests.swift",
      firstLine: 2,
      symbols: expect.arrayContaining(["CheckoutViewModelTests.testSubmitLoadsReceipt"])
    });
    expect(result.matches[0].why).toEqual(expect.arrayContaining(["test imports source module", "test calls source symbol"]));
  });
});
