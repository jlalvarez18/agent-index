import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { queryAgentIndex, queryIndex, rankHybridMatches } from "../../src/core/query.js";
import type { QueryMatch } from "../../src/core/schema.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `class Cache:
    def get(self, key):
        return load_value(key)

def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  return root;
}

describe("queryIndex", () => {
  test("returns the expected symbol in top results with line citations and nearby edges", async () => {
    const root = await fixtureProject();
    await indexTarget(root);

    const result = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5 });

    expect(result.query).toBe("where is semantic cache loaded?");
    expect(result.matches[0]).toMatchObject({
      symbol: "load_value",
      kind: "function",
      file: "pkg/cache.py",
      lines: [5, 7]
    });
    expect(result.matches[0].score).toBeGreaterThan(0);
    expect(result.matches[0].why).toEqual(expect.arrayContaining(["matched source text"]));
    expect(result.matches[0].evidence).toContain("semantic_cache");
    expect(result.matches[0].evidence?.length).toBeLessThanOrEqual(96);
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "called_by_name",
          symbol: "Cache.get"
        })
      ])
    );
  });

  test("can return plain FTS results without symbol boosts or graph expansion", async () => {
    const root = await fixtureProject();
    await indexTarget(root);

    const result = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5, mode: "fts" });

    expect(result.mode).toBe("fts");
    expect(result.matches[0].why).toEqual(["plain FTS match"]);
    expect(result.matches[0].evidence).toContain("semantic_cache");
    expect(result.matches[0].neighbors).toEqual([]);
  });

  test("accepts structured agent queries with terms, symbol kind filters, support-code exclusion, and expansion control", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-structured-"));
    await mkdir(path.join(root, "pkg", "webhooks"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "webhooks", "security.py"),
      `class WebhookSignatureVerifier:
    """Webhook signature verifier container."""

def verify_signature(payload, signature):
    """Verify webhook signature before accepting the payload."""
    webhook_signature_validated = True
    return webhook_signature_validated
`
    );
    await writeFile(
      path.join(root, "tests", "test_webhooks.py"),
      `def verify_signature_test_helper(payload, signature):
    """Verify webhook signature inside tests only."""
    return True
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["webhook", "signature", "verify"],
        symbolKinds: ["function", "method"],
        pathHints: ["webhooks", "security"],
        excludeSupportCode: true,
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.query).toBe("webhook signature verify");
    expect(result.matches[0]).toMatchObject({
      symbol: "verify_signature",
      kind: "function",
      file: "pkg/webhooks/security.py"
    });
    expect(result.matches[0].why).toContain("path hint match");
    expect(result.matches.map((match) => match.kind)).not.toContain("class");
    expect(result.matches.map((match) => match.file)).not.toContain("tests/test_webhooks.py");
    expect(result.matches[0].neighbors).toEqual([]);
  });

  test("applies structured kind and role filters before the FTS candidate cap", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-sql-filter-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    const noisyTests = Array.from(
      { length: 40 },
      (_, index) => `def semantic_cache_test_${index}():
    semantic_cache_loaded = "test helper"
    return semantic_cache_loaded
`
    ).join("\n");
    await writeFile(path.join(root, "tests", "test_cache.py"), noisyTests);
    await writeFile(
      path.join(root, "pkg", "cache.py"),
      `def load_value(key):
    semantic_cache_loaded = key
    return semantic_cache_loaded
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["semantic", "cache", "loaded"],
        symbolKinds: ["function"],
        roles: ["source"],
        expand: []
      },
      { target: root, mode: "fts", limit: 5 }
    );

    expect(result.matches.map((match) => match.file)).toEqual(["pkg/cache.py"]);
    expect(result.matches[0]).toMatchObject({ symbol: "load_value", kind: "function" });
  });

  test("hybrid mode surfaces Ruby controller methods with namespace and path hints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-ruby-"));
    await mkdir(path.join(root, "app", "controllers", "admin"), { recursive: true });
    await mkdir(path.join(root, "app", "serializers"), { recursive: true });
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
      path.join(root, "app", "serializers", "user_serializer.rb"),
      `class UserSerializer
  def initialize(user)
    @user = user
  end
end
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["Admin", "UsersController", "render", "current_user"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["app/controllers/admin"],
        expand: ["parents"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Admin::UsersController.show",
      kind: "method",
      file: "app/controllers/admin/users_controller.rb"
    });
    expect(result.matches[0].why).toContain("path hint match");
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "incoming_symbol_contains_symbol",
          symbol: "Admin::UsersController"
        })
      ])
    );
  });

  test("graph expansion surfaces resolved Ruby sibling method calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-ruby-sibling-calls-"));
    await mkdir(path.join(root, "app", "jobs"), { recursive: true });
    await writeFile(
      path.join(root, "app", "jobs", "user_email_job.rb"),
      `class UserEmailJob < ApplicationJob
  def execute(args)
    send_user_email(args)
  end

  def send_user_email(args)
    message_for_email(args[:user])
  end

  def message_for_email(user)
    UserMailer.digest(user).deliver_later
  end
end
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["execute", "send_user_email", "message_for_email"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["app/jobs"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 3 }
    );

    const execute = result.matches.find((match) => match.symbol === "UserEmailJob.execute");
    expect(execute?.neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "symbol_calls_name",
          symbol: "UserEmailJob.send_user_email",
          file: "app/jobs/user_email_job.rb"
        })
      ])
    );
  });

  test("hybrid mode surfaces Dart Flutter controller methods with path and role hints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-dart-"));
    await mkdir(path.join(root, "lib", "src", "checkout"), { recursive: true });
    await mkdir(path.join(root, "test", "checkout"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "src", "checkout", "checkout_controller.dart"),
      `import 'package:flutter/foundation.dart';

class CheckoutController extends ChangeNotifier {
  CheckoutController(this.repository);

  final PaymentRepository repository;
  String statusText = 'idle';

  Future<void> submit(Cart cart) async {
    statusText = 'submitting';
    final receipt = await repository.authorize(cart);
    statusText = receipt.label;
    notifyListeners();
  }
}
`
    );
    await writeFile(
      path.join(root, "test", "checkout", "checkout_controller_test.dart"),
      `import 'package:flutter_test/flutter_test.dart';

void main() {
  test('submit updates status text', () async {
    final controller = CheckoutController(FakePaymentRepository());
    await controller.submit(Cart.empty());
    expect(controller.statusText, 'paid');
  });
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["submit", "authorize", "receipt", "notifyListeners"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["lib/src/checkout"],
        expand: ["parents", "callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "CheckoutController.submit",
      kind: "method",
      file: "lib/src/checkout/checkout_controller.dart"
    });
    expect(result.matches[0].why).toContain("path hint match");
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "incoming_symbol_contains_symbol", symbol: "CheckoutController" }),
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "authorize" }),
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "notifyListeners" })
      ])
    );
  });

  test("hybrid mode surfaces Ruby DSL task and Cucumber scenario symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-ruby-dsl-"));
    await mkdir(path.join(root, "lib", "tasks"), { recursive: true });
    await mkdir(path.join(root, "features"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "tasks", "reports.rake"),
      `namespace :reports do
  desc "Refresh reporting cache"
  task refresh: :environment do
    Reports::RefreshJob.perform_now
  end
end
`
    );
    await writeFile(
      path.join(root, "features", "sign_in.feature"),
      `Feature: User sign in
  Scenario: Locked account
    Given a locked account
    Then sign in is denied
`
    );
    await indexTarget(root);

    const taskResult = await queryAgentIndex(
      {
        terms: ["reports", "refresh", "RefreshJob", "reporting cache"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["lib/tasks"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const scenarioResult = await queryAgentIndex(
      {
        terms: ["locked account", "sign in", "denied"],
        symbolKinds: ["method"],
        roles: ["test"],
        pathHints: ["features"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(taskResult.matches[0]).toMatchObject({
      symbol: "rake.reports.refresh",
      kind: "method",
      file: "lib/tasks/reports.rake"
    });
    expect(scenarioResult.matches[0]).toMatchObject({
      symbol: "feature.User_sign_in.locked_account",
      kind: "method",
      file: "features/sign_in.feature"
    });
  });

  test("hybrid mode surfaces typed generic TypeScript client and config symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-typescript-generics-"));
    await mkdir(path.join(root, "src", "client"), { recursive: true });
    await writeFile(
      path.join(root, "src", "client", "api.ts"),
      `export const createClient: ClientFactory = async <TRequest extends RequestOptions>(
  request: TRequest
): Promise<Client<TRequest>> => {
  return buildClient(request);
};

export async function loadConfig<TOptions extends UserConfig>(options: TOptions): Promise<ResolvedConfig> {
  return resolveConfig(options);
}

class ApiClient {
  request<TResponse>(config: RequestConfig): Promise<TResponse> {
    return dispatchRequest(config);
  }
}
`
    );
    await indexTarget(root);

    const clientResult = await queryAgentIndex(
      {
        terms: ["create", "client", "request", "factory"],
        symbolKinds: ["function"],
        roles: ["source"],
        pathHints: ["client", "api"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const configResult = await queryAgentIndex(
      {
        terms: ["load", "config", "resolve", "options"],
        symbolKinds: ["function"],
        roles: ["source"],
        pathHints: ["client", "api"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const requestResult = await queryAgentIndex(
      {
        terms: ["ApiClient", "request", "dispatch", "config"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["client", "api"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(clientResult.matches[0]).toMatchObject({
      symbol: "createClient",
      file: "src/client/api.ts"
    });
    expect(configResult.matches[0]).toMatchObject({
      symbol: "loadConfig",
      file: "src/client/api.ts"
    });
    expect(requestResult.matches[0]).toMatchObject({
      symbol: "ApiClient.request",
      file: "src/client/api.ts"
    });
  });

  test("hybrid mode surfaces C++ override methods and build ownership symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-cpp-"));
    await mkdir(path.join(root, "source", "common", "router"), { recursive: true });
    await writeFile(
      path.join(root, "source", "common", "router", "route_matcher.cc"),
      `#include "source/common/router/route_matcher.h"

namespace envoy::router {

class RouteMatcher final : public Matcher {
public:
  MatchResult MatchRoute(const RequestHeaders& headers) const override {
    return trie_->Find(headers.Path()).Map(&MatchResult::FromRouteEntry);
  }
};

}  // namespace envoy::router
`
    );
    await writeFile(
      path.join(root, "CMakeLists.txt"),
      `add_library(envoy_router source/common/router/route_matcher.cc)
target_link_libraries(envoy_router PUBLIC envoy_http)
`
    );
    await indexTarget(root);

    const methodResult = await queryAgentIndex(
      {
        terms: ["RouteMatcher", "MatchRoute", "headers", "trie", "Find"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["source/common/router"],
        expand: ["parents"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const buildResult = await queryAgentIndex(
      {
        terms: ["envoy", "router", "target", "link", "http"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["CMakeLists.txt"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(methodResult.matches[0]).toMatchObject({
      symbol: "envoy::router::RouteMatcher.MatchRoute",
      kind: "method",
      file: "source/common/router/route_matcher.cc"
    });
    expect(methodResult.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "incoming_symbol_contains_symbol",
          symbol: "envoy::router::RouteMatcher"
        })
      ])
    );
    expect(buildResult.matches[0]).toMatchObject({
      symbol: "cmake.target.envoy_router",
      file: "CMakeLists.txt"
    });
  });

  test("hybrid mode surfaces Laravel-style PHP controller methods", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-php-"));
    await mkdir(path.join(root, "app", "Http", "Controllers"), { recursive: true });
    await writeFile(
      path.join(root, "app", "Http", "Controllers", "CheckoutController.php"),
      `<?php

namespace App\\Http\\Controllers;

use App\\Services\\CheckoutService;

final class CheckoutController
{
    public function show(string $id): JsonResponse
    {
        $order = $this->checkoutService->findOrderWithLineItems($id);
        return response()->json($order);
    }
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["CheckoutController", "show", "findOrderWithLineItems", "json"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["app/Http/Controllers"],
        expand: ["parents", "callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "App\\Http\\Controllers\\CheckoutController::show",
      kind: "method",
      file: "app/Http/Controllers/CheckoutController.php"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "incoming_symbol_contains_symbol",
          symbol: "App\\Http\\Controllers\\CheckoutController"
        }),
        expect.objectContaining({
          relation: "symbol_calls_name",
          symbol: "findOrderWithLineItems"
        })
      ])
    );
  });

  test("hybrid mode surfaces Laravel route wiring symbols for controller actions and middleware", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-php-routes-"));
    await mkdir(path.join(root, "routes"), { recursive: true });
    await mkdir(path.join(root, "app", "Http", "Controllers"), { recursive: true });
    await writeFile(
      path.join(root, "routes", "web.php"),
      `<?php

use App\\Http\\Controllers\\OrderController;
use Illuminate\\Support\\Facades\\Route;

Route::middleware('auth')
    ->prefix('orders')
    ->group(function () {
        Route::get('/{order}', [OrderController::class, 'show'])
            ->name('orders.show')
            ->middleware('can:view,order');
    });
`
    );
    await writeFile(
      path.join(root, "app", "Http", "Controllers", "OrderController.php"),
      `<?php

namespace App\\Http\\Controllers;

final class OrderController
{
    public function show(string $order): View
    {
        return view('orders.show');
    }
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["orders.show", "OrderController", "show", "middleware", "can:view"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["routes"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "routes/web.php::route.get.orders.show",
      kind: "method",
      file: "routes/web.php"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "OrderController::show" }),
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "can:view,order" })
      ])
    );
  });

  test("hybrid mode surfaces Laravel service provider container bindings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-php-provider-"));
    await mkdir(path.join(root, "app", "Providers"), { recursive: true });
    await mkdir(path.join(root, "app", "Contracts"), { recursive: true });
    await mkdir(path.join(root, "app", "Services"), { recursive: true });
    await mkdir(path.join(root, "app", "Http", "Middleware"), { recursive: true });
    await writeFile(
      path.join(root, "app", "Providers", "PaymentServiceProvider.php"),
      `<?php

namespace App\\Providers;

use App\\Contracts\\PaymentGateway;
use App\\Http\\Middleware\\EnsureTenant;
use App\\Services\\StripePaymentGateway;
use Illuminate\\Support\\ServiceProvider;

final class PaymentServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PaymentGateway::class, StripePaymentGateway::class);
        $this->app->singleton('tenant.middleware', fn ($app) => new EnsureTenant($app->make(PaymentGateway::class)));
    }

    public function boot(): void
    {
        $this->app['router']->aliasMiddleware('tenant', EnsureTenant::class);
    }
}
`
    );
    await writeFile(
      path.join(root, "app", "Contracts", "PaymentGateway.php"),
      `<?php
namespace App\\Contracts;
interface PaymentGateway {}
`
    );
    await writeFile(
      path.join(root, "app", "Services", "StripePaymentGateway.php"),
      `<?php
namespace App\\Services;
final class StripePaymentGateway implements PaymentGateway {}
`
    );
    await writeFile(
      path.join(root, "app", "Http", "Middleware", "EnsureTenant.php"),
      `<?php
namespace App\\Http\\Middleware;
final class EnsureTenant {}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["PaymentGateway", "StripePaymentGateway", "bind", "container"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["app/Providers"],
        expand: ["callees", "parents"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "App\\Providers\\PaymentServiceProvider::binding.PaymentGateway",
      kind: "method",
      file: "app/Providers/PaymentServiceProvider.php"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "PaymentGateway" }),
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "StripePaymentGateway" }),
        expect.objectContaining({
          relation: "incoming_symbol_contains_symbol",
          symbol: "App\\Providers\\PaymentServiceProvider"
        })
      ])
    );
  });

  test("hybrid mode surfaces Symfony YAML service wiring symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-yaml-services-"));
    await mkdir(path.join(root, "config"), { recursive: true });
    await mkdir(path.join(root, "src", "Command"), { recursive: true });
    await writeFile(
      path.join(root, "config", "services.yaml"),
      `services:
  App\\Command\\ImportOrdersCommand:
    arguments:
      $gateway: '@App\\Contracts\\PaymentGateway'
    tags:
      - { name: 'console.command', command: 'app:import-orders' }
`
    );
    await writeFile(
      path.join(root, "src", "Command", "ImportOrdersCommand.php"),
      `<?php
namespace App\\Command;
final class ImportOrdersCommand {}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["ImportOrdersCommand", "PaymentGateway", "console.command", "app:import-orders"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["config/services.yaml"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "config/services.yaml::service.ImportOrdersCommand",
      kind: "method",
      file: "config/services.yaml"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "App\\Contracts\\PaymentGateway" }),
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "app:import-orders" })
      ])
    );
  });

  test("hybrid mode surfaces Symfony XML service wiring symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-xml-services-"));
    await mkdir(path.join(root, "config"), { recursive: true });
    await mkdir(path.join(root, "src", "Command"), { recursive: true });
    await writeFile(
      path.join(root, "config", "services.xml"),
      `<container xmlns="http://symfony.com/schema/dic/services">
  <services>
    <service id="App\\Command\\ImportOrdersCommand">
      <argument type="service" id="App\\Contracts\\PaymentGateway" />
      <tag name="console.command" command="app:import-orders" />
    </service>
  </services>
</container>
`
    );
    await writeFile(
      path.join(root, "src", "Command", "ImportOrdersCommand.php"),
      `<?php
namespace App\\Command;
final class ImportOrdersCommand {}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["ImportOrdersCommand", "PaymentGateway", "console.command", "app:import-orders"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["config/services.xml"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "config/services.xml::service.ImportOrdersCommand",
      kind: "method",
      file: "config/services.xml"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "App\\Contracts\\PaymentGateway" }),
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "app:import-orders" })
      ])
    );
  });

  test("hybrid mode surfaces C implementation functions over headers and build files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-c-"));
    await mkdir(path.join(root, "include"), { recursive: true });
    await mkdir(path.join(root, "src"), { recursive: true });
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

CacheEntry *cache_lookup(CacheEntry *head, const char *key) {
    if (strcmp(head->key, key) == 0) {
        return head;
    }
    return cache_miss(key);
}
`
    );
    await writeFile(path.join(root, "Makefile"), "cache_test: src/cache.o\n");
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["cache_lookup", "strcmp", "cache_miss"],
        symbolKinds: ["function"],
        roles: ["source"],
        pathHints: ["src", "cache"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "cache_lookup",
      kind: "function",
      file: "src/cache.c"
    });
    expect(result.matches[0].why).toContain("path hint match");
  });

  test("hybrid mode surfaces C# controller and service methods", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-csharp-"));
    await mkdir(path.join(root, "src", "Checkout.Api", "Controllers"), { recursive: true });
    await mkdir(path.join(root, "src", "Checkout.Application"), { recursive: true });
    await writeFile(
      path.join(root, "src", "Checkout.Api", "Controllers", "CheckoutController.cs"),
      `using Microsoft.AspNetCore.Mvc;
using Acme.Checkout.Application;

namespace Acme.Checkout.Api.Controllers;

[ApiController]
public sealed class CheckoutController : ControllerBase
{
    private readonly CheckoutService service;

    public CheckoutController(CheckoutService service)
    {
        this.service = service;
    }

    public IActionResult Submit(CheckoutCommand command)
    {
        var receipt = service.Handle(command);
        return Ok(receipt);
    }
}
`
    );
    await writeFile(
      path.join(root, "src", "Checkout.Application", "CheckoutService.cs"),
      `namespace Acme.Checkout.Application;

public sealed class CheckoutService : ICheckoutHandler
{
    public CheckoutReceipt Handle(CheckoutCommand command)
    {
        return ProcessPayment(command);
    }
}
`
    );
    await indexTarget(root);

    const controllerResult = await queryAgentIndex(
      {
        terms: ["Submit", "receipt", "Handle"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["Checkout.Api", "Controllers"],
        expand: ["parents"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const serviceResult = await queryAgentIndex(
      {
        terms: ["CheckoutService", "Handle", "ProcessPayment"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["Checkout.Application"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(controllerResult.matches[0]).toMatchObject({
      symbol: "Acme.Checkout.Api.Controllers.CheckoutController.Submit",
      kind: "method",
      file: "src/Checkout.Api/Controllers/CheckoutController.cs"
    });
    expect(controllerResult.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "incoming_symbol_contains_symbol",
          symbol: "Acme.Checkout.Api.Controllers.CheckoutController"
        })
      ])
    );
    expect(serviceResult.matches[0]).toMatchObject({
      symbol: "Acme.Checkout.Application.CheckoutService.Handle",
      kind: "method",
      file: "src/Checkout.Application/CheckoutService.cs"
    });
  });

  test("uses path hints for file-path scoring without turning them into source-text intent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-path-hints-"));
    await mkdir(path.join(root, "pkg", "templates"), { recursive: true });
    await mkdir(path.join(root, "pkg", "notes"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "templates", "loader.py"),
      `def render_to_string(context):
    selected_template = context
    return selected_template
`
    );
    await writeFile(
      path.join(root, "pkg", "notes", "loader.py"),
      `def document_template_loader():
    """Discuss template loader behavior without rendering the selected template."""
    return "template loader notes"
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["render", "selected", "template"],
        symbolKinds: ["function"],
        pathHints: ["templates"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.query).toBe("render selected template");
    expect(result.matches[0]).toMatchObject({
      symbol: "render_to_string",
      file: "pkg/templates/loader.py"
    });
    expect(result.matches[0].why).toContain("path hint match");
    expect(result.matches.find((match) => match.symbol === "document_template_loader")?.why).not.toContain(
      "path hint match"
    );
  });

  test("can treat structured path hints as hard file-path filters", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-path-filter-"));
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

    const result = await queryAgentIndex(
      {
        terms: ["mixing_expansion", "conductance", "cut_size"],
        symbolKinds: ["function"],
        roles: ["test"],
        pathHints: ["algorithms/tests/test_cuts.py"],
        pathMode: "filter",
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches.map((match) => match.file)).toEqual(["pkg/algorithms/tests/test_cuts.py"]);
  });

  test("can treat tokenized structured path hints as hard file-path filters", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-token-path-filter-"));
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

    const result = await queryAgentIndex(
      {
        terms: ["mixing_expansion", "conductance", "cut_size"],
        symbolKinds: ["function"],
        roles: ["test"],
        pathHints: ["algorithms cuts"],
        pathMode: "filter",
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches.map((match) => match.file)).toEqual(["pkg/algorithms/tests/test_cuts.py"]);
  });

  test("boosts tests that contain exact API evidence over generic validator noise", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-test-api-evidence-"));
    await mkdir(path.join(root, "tests", "validation"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "validation", "test_constraints.py"),
      `def test_full_clean_validate_constraints_false():
    obj.full_clean(validate_constraints=False)
    assert obj.errors == {}
`
    );
    await writeFile(
      path.join(root, "tests", "validation", "test_validators.py"),
      Array.from(
        { length: 25 },
        (_, index) => `def test_generic_validator_${index}():
    validate_constraints = "generic validator noise"
    full_clean = "mentioned without API call"
    return validate_constraints, full_clean
`
      ).join("\n")
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["Model.full_clean", "full_clean", "validate_constraints"],
        symbolKinds: ["function"],
        roles: ["test"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "test_full_clean_validate_constraints_false",
      file: "tests/validation/test_constraints.py"
    });
    expect(result.matches[0].why).toContain("test API evidence match");
  });

  test("can find Rust core implementation symbols in mixed Python and Rust repos", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-rust-core-"));
    await mkdir(path.join(root, "pydantic"), { recursive: true });
    await mkdir(path.join(root, "pydantic-core", "src", "serializers"), { recursive: true });
    await writeFile(
      path.join(root, "pydantic", "main.py"),
      `class BaseModel:
    def model_dump_json(self):
        return self.__pydantic_serializer__.to_json().decode()
`
    );
    await writeFile(
      path.join(root, "pydantic-core", "src", "serializers", "computed_fields.rs"),
      `pub struct ComputedFields {}

impl ComputedFields {
    pub fn serialize(&self) {
        if exclude_computed_fields() {
            return;
        }
    }
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["ComputedFields.serialize", "computed_fields", "exclude_computed_fields"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["pydantic-core/src/serializers"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "serializers.computed_fields.ComputedFields.serialize",
      kind: "method",
      file: "pydantic-core/src/serializers/computed_fields.rs"
    });
  });

  test("structured hybrid queries prefer Rust impl methods over trait declarations and modules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-rust-impl-"));
    await mkdir(path.join(root, "src", "runtime"), { recursive: true });
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

pub struct Runtime {
    handle: Handle,
}

impl Runtime {
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
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["Runtime.spawn", "spawn", "handle", "trace_ready", "task"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["src/runtime"],
        expand: ["callees", "parents"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "runtime.Runtime.spawn",
      kind: "method",
      file: "src/runtime/mod.rs"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "symbol_conforms_to",
          symbol: "runtime.executor.Executor.spawn"
        })
      ])
    );
  });

  test("boosts Cython backend symbols for Cython-shaped navigation tasks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-cython-backend-"));
    await mkdir(path.join(root, "sklearn", "cluster"), { recursive: true });
    await writeFile(
      path.join(root, "sklearn", "cluster", "_dbscan.py"),
      `def dbscan(X):
    """Python dispatcher mentioning dbscan core neighborhoods labels stack backend."""
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

    const result = await queryAgentIndex(
      {
        terms: ["dbscan", "inner", "cython", "core", "neighborhoods", "labels", "stack"],
        symbolKinds: ["function"],
        roles: ["source"],
        pathHints: ["cluster"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "dbscan_inner",
      kind: "function",
      file: "sklearn/cluster/_dbscan_inner.pyx"
    });
    expect(result.matches[0].why).toContain("Cython navigation signal match");
  });

  test("filters structured agent queries by stored file role", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-roles-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "json_tools.py"),
      `def print_json(data):
    """Print JSON from production code."""
    return data
`
    );
    await writeFile(
      path.join(root, "tests", "test_json_tools.py"),
      `def test_print_json():
    """Test print_json behavior."""
    return True
`
    );
    await writeFile(
      path.join(root, "docs", "json_example.py"),
      `def docs_print_json():
    """Document print_json behavior."""
    return True
`
    );
    await indexTarget(root);

    const testsOnly = await queryAgentIndex(
      { terms: ["print_json"], symbolKinds: ["function"], roles: ["test"] },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const sourceOnly = await queryAgentIndex(
      { terms: ["print_json"], symbolKinds: ["function"], roles: ["source"] },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const testsAndDocs = await queryAgentIndex(
      { terms: ["print_json"], symbolKinds: ["function"], roles: ["test", "docs"] },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(testsOnly.matches.map((match) => match.file)).toEqual(["tests/test_json_tools.py"]);
    expect(sourceOnly.matches.map((match) => match.file)).toEqual(["pkg/json_tools.py"]);
    expect(testsAndDocs.matches.map((match) => match.file).sort()).toEqual([
      "docs/json_example.py",
      "tests/test_json_tools.py"
    ]);
  });

  test("keeps excludeSupportCode behavior using stored source roles", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-exclude-support-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "cache.py"), "def semantic_cache():\n    return 1\n");
    await writeFile(path.join(root, "tests", "test_cache.py"), "def semantic_cache_test():\n    return 1\n");
    await indexTarget(root);

    const result = await queryAgentIndex(
      { terms: ["semantic", "cache"], symbolKinds: ["function"], excludeSupportCode: true },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches.map((match) => match.file)).toEqual(["pkg/cache.py"]);
  });

  test("hybrid mode can keep lexical FTS candidates while adding graph context", async () => {
    const root = await fixtureProject();
    await indexTarget(root);

    const fts = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5, mode: "fts" });
    const hybrid = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5, mode: "hybrid" });

    expect(hybrid.mode).toBe("hybrid");
    expect(hybrid.matches.map((match) => match.symbol).sort()).toEqual(
      fts.matches.map((match) => match.symbol).sort()
    );
    expect(hybrid.matches.some((match) => match.neighbors.length > 0)).toBe(true);
    expect(hybrid.matches[0].why).toContain("matched source text");
  });

  test("hybrid ranking boosts lexical function hits without blocking stronger precise symbols", () => {
    const matches = [
      hybridItem(match("support_notes", "function", 9), 1),
      hybridItem(match("pkg/module.py", "module", 12), 2),
      hybridItem(match("Client.send", "method", 14), undefined)
    ];

    const ranked = rankHybridMatches(matches, 3);

    expect(ranked.map((item) => item.symbol)).toEqual(["Client.send", "support_notes", "pkg/module.py"]);
  });

  test("hybrid ranking breaks ties toward exact function symbols over broad contextual methods", () => {
    const broadMethod = {
      ...match("Connection._clean_up_response_headers_for_sending", "method", 19.5),
      why: [
        "matched source text",
        "file path match",
        "symbol name match",
        "method name match",
        "method owner/source match"
      ]
    };
    const exactFunction = {
      ...match("_keep_alive", "function", 23.5),
      why: [
        "matched source text",
        "file path match",
        "symbol name match",
        "exact symbol name match",
        "symbol token coverage match"
      ]
    };

    const ranked = rankHybridMatches([hybridItem(broadMethod, 1), hybridItem(exactFunction, 9)], 2);

    expect(ranked.map((item) => item.symbol)).toEqual([
      "_keep_alive",
      "Connection._clean_up_response_headers_for_sending"
    ]);
  });

  test("hybrid mode prefers direct owner action methods over sibling context methods", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-owner-action-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "connection.py"),
      `class Connection:
    def send(self, event):
        """Send message ping pong and close events while enforcing connection state transitions."""
        return event

    def events(self):
        """Convert received frames into message ping pong and close events."""
        return []
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the connection send message ping pong and close events while enforcing state transitions?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({ symbol: "Connection.send", file: "pkg/connection.py" });
    expect(result.matches[0].why).toContain("direct owner action intent");
  });

  test("hybrid mode prefers event conversion methods over lower-level frame streams", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-frame-event-conversion-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "frame_protocol.py"),
      `class FrameProtocol:
    def received_frames(self):
        """Yield received websocket frames."""
        return []
`
    );
    await writeFile(
      path.join(root, "pkg", "connection.py"),
      `class Connection:
    def events(self):
        """Convert received WebSocket frames into Ping Pong Close TextMessage and BytesMessage events."""
        return []
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does wsproto convert received WebSocket frames into Ping Pong Close TextMessage and BytesMessage events?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({ symbol: "Connection.events", file: "pkg/connection.py" });
    expect(result.matches[0].why).toContain("frame event conversion intent");
  });

  test("hybrid mode prefers extension negotiation orchestration over abstract extension hooks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-extension-negotiation-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "extensions.py"),
      `class Extension:
    def accept(self, offer):
        """Accept an extension offer."""
        return offer

    def finalize(self, offer):
        """Finalize an accepted extension."""
        return offer
`
    );
    await writeFile(
      path.join(root, "pkg", "handshake.py"),
      `def server_extensions_handshake(requested, supported):
    """Agree on requested WebSocket extensions and format the response header."""
    return requested, supported

def client_extensions_handshake(accepted, supported):
    """Finalize accepted client WebSocket extensions and reject unrecognized extension names."""
    return accepted, supported
`
    );
    await indexTarget(root);

    const serverResult = await queryIndex(
      "where does the server agree on requested WebSocket extensions and format the response header?",
      { target: root, limit: 5, mode: "hybrid" }
    );
    const clientResult = await queryIndex(
      "where does the client finalize accepted WebSocket extensions and reject unrecognized extension names?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(serverResult.matches[0]).toMatchObject({
      symbol: "server_extensions_handshake",
      file: "pkg/handshake.py"
    });
    expect(serverResult.matches[0].why).toContain("extension negotiation intent");
    expect(clientResult.matches[0]).toMatchObject({
      symbol: "client_extensions_handshake",
      file: "pkg/handshake.py"
    });
    expect(clientResult.matches[0].why).toContain("extension negotiation intent");
  });

  test("hybrid ranking lifts precise owner/name methods over broad class containers", () => {
    const classContainer = match("Command", "class", 20.5);
    const preciseMethod = {
      ...match("Option.consume_value", "method", 19.5),
      why: ["matched source text", "symbol name match", "method owner/name match"]
    };

    const ranked = rankHybridMatches([hybridItem(classContainer, undefined), hybridItem(preciseMethod, undefined)], 2);

    expect(ranked.map((item) => item.symbol)).toEqual(["Option.consume_value", "Command"]);
  });

  test("hybrid ranking prefers non-module symbols when a module is only broad context", () => {
    const moduleContainer = match("pkg/types.py", "module", 15);
    const specificClass = {
      ...match("Path", "class", 13),
      why: ["matched source text", "symbol name match", "file path match"]
    };

    const ranked = rankHybridMatches([hybridItem(moduleContainer, undefined), hybridItem(specificClass, undefined)], 2);

    expect(ranked.map((item) => item.symbol)).toEqual(["Path", "pkg/types.py"]);
  });

  test("hybrid ranking demotes high-scoring module containers below concrete function symbols", () => {
    const moduleContainer = match("pkg/weighted.py", "module", 42.5);
    const concreteFunction = {
      ...match("_dijkstra_multisource", "function", 28.5),
      why: ["matched source text", "symbol name match", "file path match"]
    };

    const ranked = rankHybridMatches([hybridItem(moduleContainer, 1), hybridItem(concreteFunction, 3)], 2);

    expect(ranked.map((item) => item.symbol)).toEqual(["_dijkstra_multisource", "pkg/weighted.py"]);
  });

  test("hybrid ranking prefers early concrete lifecycle methods over broad class containers", () => {
    const classContainer = {
      ...match("WorkController", "class", 22.5),
      why: ["matched source text", "file path match", "symbol name match", "nearby graph edge"]
    };
    const concreteMethod = {
      ...match("WorkController.start", "method", 17.5),
      why: ["matched source text", "file path match", "symbol name match", "method name match"]
    };

    const ranked = rankHybridMatches([hybridItem(classContainer, 5), hybridItem(concreteMethod, 1)], 2);

    expect(ranked.map((item) => item.symbol)).toEqual(["WorkController.start", "WorkController"]);
  });

  test("structured hybrid queries prefer exact dunder methods over sibling owner methods", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-dunder-owner-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "cancel.py"),
      `class CancelStatus:
    pass

def current_task():
    return Task()

class Task:
    def _activate_cancel_status(self, status):
        self.status = status

class CancelScope:
    def __enter__(self):
        task = current_task()
        if self._relative_deadline:
            self._deadline = self._relative_deadline
        self._cancel_status = CancelStatus()
        task._activate_cancel_status(self._cancel_status)
        return self

    def relative_deadline(self):
        if self._relative_deadline:
            return self._relative_deadline
        return self._deadline
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: [
          "CancelScope.__enter__",
          "__enter__",
          "current_task",
          "relative_deadline",
          "cancel_status",
          "_activate_cancel_status"
        ],
        symbolKinds: ["method"],
        pathHints: ["cancel"],
        excludeSupportCode: true,
        expand: ["callees", "parents"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "CancelScope.__enter__",
      kind: "method",
      file: "pkg/cancel.py"
    });
  });

  test("structured path hints do not turn package __init__ files into dunder method intent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-dunder-path-hint-"));
    await mkdir(path.join(root, "pkg", "management"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "management", "__init__.py"),
      `class ManagementUtility:
    def __init__(self, argv):
        """Prepare command line management commands from argv."""
        self.argv = argv
        self.prog_name = "manage"

    def execute(self):
        """Execute command line management commands and dispatch subcommands."""
        subcommand = self.argv[1]
        return self.fetch_command(subcommand)

    def fetch_command(self, subcommand):
        return subcommand
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: [
          "ManagementUtility.execute",
          "execute",
          "command",
          "line",
          "management",
          "commands",
          "dispatch",
          "subcommands"
        ],
        symbolKinds: ["method"],
        pathHints: ["management", "__init__"],
        excludeSupportCode: true,
        expand: ["callees", "parents"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "ManagementUtility.execute",
      kind: "method",
      file: "pkg/management/__init__.py"
    });
  });

  test("hybrid mode prefers owner-matched implementation methods over class containers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-owner-implementation-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "types.py"),
      `"""Path type validation for existence and permissions."""

class Path:
    """Path parameter type handles existence and permissions."""

    def convert(self, value):
        exists = value.exists()
        readable = value.can_read()
        writable = value.can_write()
        permissions = (readable, writable)
        return exists, permissions
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Path validate existence and permissions?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Path.convert",
      kind: "method",
      file: "pkg/types.py"
    });
    expect(result.matches[0].why).toContain("method owner/source match");
  });

  test("hybrid mode exposes Swift protocol conformers through graph neighbors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-swift-conformance-"));
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
      `import SwiftUI

struct CheckoutViewModel: PaymentAuthorizing, ObservableObject {
    func authorize(_ request: PaymentRequest) async throws -> Receipt {
        try await Gateway().authorize(request)
    }
}

extension CheckoutViewModel: Sendable {
    func retry(_ request: PaymentRequest) async throws -> Receipt {
        try await authorize(request)
    }
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["PaymentAuthorizing", "authorize", "protocol"],
        symbolKinds: ["class"],
        roles: ["source"],
        pathHints: ["Sources/Checkout"],
        expand: ["children"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const protocolMatch = result.matches.find((match) => match.symbol === "PaymentAuthorizing");

    expect(protocolMatch).toMatchObject({
      symbol: "PaymentAuthorizing",
      kind: "class",
      file: "Sources/Checkout/PaymentAuthorizing.swift"
    });
    expect(protocolMatch?.neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "conformed_to_by",
          symbol: "CheckoutViewModel",
          file: "Sources/Checkout/CheckoutViewModel.swift"
        })
      ])
    );

    const requirementResult = await queryAgentIndex(
      {
        terms: ["PaymentAuthorizing", "authorize", "protocol", "implementation"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["Sources/Checkout"],
        expand: ["callers"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const requirementMatch = requirementResult.matches.find((match) => match.symbol === "PaymentAuthorizing.authorize");

    expect(requirementMatch).toMatchObject({
      symbol: "PaymentAuthorizing.authorize",
      kind: "method",
      file: "Sources/Checkout/PaymentAuthorizing.swift"
    });
    expect(requirementMatch?.neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "conformed_to_by",
          symbol: "CheckoutViewModel.authorize",
          file: "Sources/Checkout/CheckoutViewModel.swift"
        })
      ])
    );
  });

  test("hybrid mode finds Swift Package.swift target declarations for build-tooling tasks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-swift-package-"));
    await writeFile(
      path.join(root, "Package.swift"),
      `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CheckoutTools",
    products: [
        .executable(name: "checkout-cli", targets: ["CheckoutCLI"])
    ],
    targets: [
        .executableTarget(name: "CheckoutCLI", dependencies: ["ArgumentParser"]),
        .testTarget(name: "CheckoutCLITests", dependencies: ["CheckoutCLI"])
    ]
)
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["Package", "executableTarget", "testTarget", "CheckoutCLI"],
        symbolKinds: ["function"],
        roles: ["source"],
        pathHints: ["Package.swift"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "package",
      kind: "function",
      file: "Package.swift"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "symbol_contains_symbol", symbol: "package.executableTarget.CheckoutCLI" }),
        expect.objectContaining({ relation: "symbol_contains_symbol", symbol: "package.testTarget.CheckoutCLITests" })
      ])
    );

    const testTargetResult = await queryAgentIndex(
      {
        terms: ["CheckoutCLITests", "testTarget", "CheckoutCLI", "dependencies"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["Package.swift"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(testTargetResult.matches[0]).toMatchObject({
      symbol: "package.testTarget.CheckoutCLITests",
      kind: "method",
      file: "Package.swift"
    });
    expect(testTargetResult.matches[0].neighbors).toEqual(
      expect.arrayContaining([expect.objectContaining({ relation: "symbol_calls_name", symbol: "CheckoutCLI" })])
    );
  });

  test("hybrid mode exposes Kotlin interface implementers and coroutine Flow methods through graph neighbors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-kotlin-conformance-"));
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

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.map

class CheckoutViewModel(
    private val repository: PaymentRepository
) : ViewModel(), PaymentRepository {
    override fun observePayments() = repository.observePayments()
        .map { state -> state.withUiCopy() }

    fun refresh() {
        viewModelScope.launch {
            observePayments().collect { emitAnalytics(it) }
        }
    }
}
`
    );
    await indexTarget(root);

    const interfaceResult = await queryAgentIndex(
      {
        terms: ["PaymentRepository", "observePayments", "interface"],
        symbolKinds: ["class"],
        roles: ["source"],
        pathHints: ["checkout"],
        expand: ["children"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    const interfaceMatch = interfaceResult.matches.find((match) => match.symbol === "com.acme.checkout.PaymentRepository");

    expect(interfaceMatch).toMatchObject({
      symbol: "com.acme.checkout.PaymentRepository",
      kind: "class",
      file: "core/src/main/kotlin/com/acme/checkout/PaymentRepository.kt"
    });
    expect(interfaceMatch?.neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "conformed_to_by",
          symbol: "com.acme.checkout.CheckoutViewModel",
          file: "app/src/main/kotlin/com/acme/checkout/CheckoutViewModel.kt"
        })
      ])
    );

    const flowResult = await queryAgentIndex(
      {
        terms: ["CheckoutViewModel", "refresh", "Flow", "collect", "launch"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["app/src/main"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(flowResult.matches[0]).toMatchObject({
      symbol: "com.acme.checkout.CheckoutViewModel.refresh",
      kind: "method",
      file: "app/src/main/kotlin/com/acme/checkout/CheckoutViewModel.kt"
    });
    expect(flowResult.matches[0].why).toContain("Kotlin navigation signal match");
    expect(flowResult.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "collect" }),
        expect.objectContaining({ relation: "symbol_calls_name", symbol: "launch" })
      ])
    );
  });

  test("hybrid mode finds Kotlin Gradle DSL module wiring", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-kotlin-gradle-"));
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(
      path.join(root, "settings.gradle.kts"),
      `pluginManagement {
    repositories { google(); mavenCentral() }
}

include(":app", ":core:model")
`
    );
    await writeFile(
      path.join(root, "app", "build.gradle.kts"),
      `plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "com.acme.checkout"
}

dependencies {
    implementation(project(":core:model"))
    testImplementation("junit:junit:4.13.2")
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["implementation", "project", "core", "model", "android"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["build.gradle.kts"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "gradle.implementation.core_model",
      kind: "method",
      file: "app/build.gradle.kts"
    });
    expect(result.matches[0].why).toContain("Kotlin navigation signal match");
    expect(result.matches[0].why).toContain("build tool ownership match");
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([expect.objectContaining({ relation: "symbol_calls_name", symbol: ":core:model" })])
    );
  });

  test("hybrid mode finds Maven pom.xml module and dependency ownership for Kotlin JVM projects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-maven-kotlin-"));
    await writeFile(
      path.join(root, "pom.xml"),
      `<project>
  <groupId>com.acme</groupId>
  <artifactId>checkout-parent</artifactId>
  <modules>
    <module>checkout-core</module>
    <module>checkout-app</module>
  </modules>
  <dependencies>
    <dependency>
      <groupId>org.jetbrains.kotlinx</groupId>
      <artifactId>kotlinx-coroutines-core</artifactId>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.jetbrains.kotlin</groupId>
        <artifactId>kotlin-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`
    );
    await indexTarget(root);

    const dependencyResult = await queryAgentIndex(
      {
        terms: ["Maven", "dependency", "kotlinx", "coroutines", "artifact"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["pom.xml"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    expect(dependencyResult.matches[0]).toMatchObject({
      symbol: "maven.dependency.org_jetbrains_kotlinx_kotlinx_coroutines_core",
      kind: "method",
      file: "pom.xml"
    });
    expect(dependencyResult.matches[0].why).toContain("build tool ownership match");
    expect(dependencyResult.matches[0].neighbors).toEqual(
      expect.arrayContaining([expect.objectContaining({ relation: "symbol_calls_name", symbol: "kotlinx-coroutines-core" })])
    );

    const moduleResult = await queryAgentIndex(
      {
        terms: ["Maven", "module", "checkout", "core"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["pom.xml"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    expect(moduleResult.matches[0]).toMatchObject({
      symbol: "maven.module.checkout_core",
      file: "pom.xml"
    });
    expect(moduleResult.matches[0].why).toContain("build tool ownership match");
  });

  test("exact Maven pom.xml path hints outrank nearby Gradle build-symbol noise", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-maven-path-hint-"));
    await mkdir(path.join(root, "libraries", "tools", "kotlin-maven-plugin"), { recursive: true });
    await mkdir(path.join(root, "repo", "gradle-build-conventions", "gradle-plugins-common", "src", "main", "kotlin"), { recursive: true });
    await writeFile(
      path.join(root, "libraries", "tools", "kotlin-maven-plugin", "pom.xml"),
      `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.jetbrains.kotlin</groupId>
  <artifactId>kotlin-maven-plugin</artifactId>
  <build>
    <plugins>
      <plugin>
        <groupId>org.jetbrains.kotlin</groupId>
        <artifactId>kotlin-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`
    );
    await writeFile(
      path.join(root, "repo", "gradle-build-conventions", "gradle-plugins-common", "src", "main", "kotlin", "gradle-plugin-common-configuration.gradle.kts"),
      `plugins {
    kotlin("jvm")
    id("com.gradle.plugin-publish")
}

dependencies {
    implementation(kotlin("stdlib"))
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["kotlin-maven-plugin", "maven.project", "artifactId", "pom"],
        symbolKinds: ["method"],
        roles: ["source", "tool"],
        pathHints: ["libraries/tools/kotlin-maven-plugin/pom.xml"],
        expand: []
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "maven.project.kotlin_maven_plugin",
      file: "libraries/tools/kotlin-maven-plugin/pom.xml"
    });
    expect(result.matches[0].why).toContain("path hint match");
  });

  test("hybrid mode finds Gradle version catalog aliases and Kotlin source-set ownership", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-gradle-catalog-"));
    await mkdir(path.join(root, "gradle"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
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
    await writeFile(
      path.join(root, "shared", "build.gradle.kts"),
      `plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    sourceSets {
        val commonMain by getting {
            dependencies {
                api(libs.kotlinx.coroutines.core)
            }
        }
    }
}
`
    );
    await indexTarget(root);

    const catalogResult = await queryAgentIndex(
      {
        terms: ["version", "catalog", "kotlinx", "coroutines", "library", "alias"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["libs.versions.toml"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    expect(catalogResult.matches[0]).toMatchObject({
      symbol: "gradle.catalog.library.kotlinx_coroutines_core",
      kind: "method",
      file: "gradle/libs.versions.toml"
    });
    expect(catalogResult.matches[0].why).toContain("build tool ownership match");

    const sourceSetResult = await queryAgentIndex(
      {
        terms: ["commonMain", "sourceSet", "api", "coroutines", "dependency"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["build.gradle.kts"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    expect(sourceSetResult.matches[0]).toMatchObject({
      symbol: "gradle.sourceSet.commonMain",
      kind: "method",
      file: "shared/build.gradle.kts"
    });
    expect(sourceSetResult.matches[0].why).toContain("build tool ownership match");
  });

  test("hybrid mode ranks Kotlin extension functions and DI annotation targets for agent navigation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-kotlin-extension-di-"));
    await mkdir(path.join(root, "app", "src", "main", "kotlin", "com", "acme", "checkout"), { recursive: true });
    await writeFile(
      path.join(root, "app", "src", "main", "kotlin", "com", "acme", "checkout", "PaymentExtensions.kt"),
      `package com.acme.checkout

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

fun Flow<PaymentState>.withUiCopy(): Flow<PaymentState> {
    return map { state -> state.copy(label = state.label.uppercase()) }
}
`
    );
    await writeFile(
      path.join(root, "app", "src", "main", "kotlin", "com", "acme", "checkout", "CheckoutModule.kt"),
      `package com.acme.checkout

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject

@Module
@InstallIn(SingletonComponent::class)
interface CheckoutModule {
    @Binds
    fun bindPaymentRepository(repository: RealPaymentRepository): PaymentRepository
}

class RealPaymentRepository @Inject constructor(): PaymentRepository
`
    );
    await indexTarget(root);

    const extensionResult = await queryAgentIndex(
      {
        terms: ["which", "extension", "Flow", "withUiCopy", "map"],
        symbolKinds: ["function"],
        roles: ["source"],
        pathHints: ["checkout"],
        expand: ["callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    expect(extensionResult.matches[0]).toMatchObject({
      symbol: "com.acme.checkout.Flow.withUiCopy",
      kind: "function",
      file: "app/src/main/kotlin/com/acme/checkout/PaymentExtensions.kt"
    });
    expect(extensionResult.matches[0].why).toContain("Kotlin navigation signal match");
    expect(extensionResult.matches[0].neighbors).toEqual(
      expect.arrayContaining([expect.objectContaining({ relation: "symbol_calls_name", symbol: "map" })])
    );

    const diResult = await queryAgentIndex(
      {
        terms: ["DI", "Hilt", "Module", "Binds", "Inject", "PaymentRepository"],
        symbolKinds: ["class", "method"],
        roles: ["source"],
        pathHints: ["checkout"],
        expand: ["children", "callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );
    expect(diResult.matches[0]).toMatchObject({
      symbol: "com.acme.checkout.CheckoutModule.bindPaymentRepository",
      kind: "method",
      file: "app/src/main/kotlin/com/acme/checkout/CheckoutModule.kt"
    });
    expect(diResult.matches[0].why).toContain("Kotlin navigation signal match");
  });

  test("hybrid mode finds methods inside constrained Swift extensions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-swift-constrained-extension-"));
    await mkdir(path.join(root, "Sources", "NIOCore"), { recursive: true });
    await writeFile(
      path.join(root, "Sources", "NIOCore", "EventLoopFuture.swift"),
      `struct EventLoopFuture<Value> {}

extension EventLoopFuture where Value == Void {
    func cascadeFailure(to promise: EventLoopPromise<Void>) {
        promise.fail(ChannelError.ioOnClosedChannel)
    }
}

extension EventLoopFuture: Sendable {
    func hop(to eventLoop: EventLoop) -> EventLoopFuture<Value> {
        flatMapThrowing { value in value }
    }
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["EventLoopFuture", "Value", "Void", "cascade", "failure", "promise"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["Sources/NIOCore"],
        expand: ["parents", "callees"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "EventLoopFuture.extension.Value_Void.cascadeFailure",
      kind: "method",
      file: "Sources/NIOCore/EventLoopFuture.swift"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "symbol_calls_name",
          symbol: "fail"
        })
      ])
    );
  });

  test("hybrid mode traces SwiftUI view body to view model actions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-swiftui-view-model-"));
    await mkdir(path.join(root, "Sources", "Checkout"), { recursive: true });
    await writeFile(
      path.join(root, "Sources", "Checkout", "CheckoutView.swift"),
      `import SwiftUI

@MainActor
final class CheckoutViewModel: ObservableObject {
    func submit() async throws {
        try await service.authorize()
    }
}

struct CheckoutView: View {
    @StateObject private var viewModel = CheckoutViewModel()

    var body: some View {
        Button("Pay") {
            Task {
                try? await viewModel.submit()
            }
        }
    }
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["SwiftUI", "CheckoutView", "body", "model", "submit", "Pay", "Button"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["Sources/Checkout"],
        expand: ["callees", "parents"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "CheckoutView.body",
      kind: "method",
      file: "Sources/Checkout/CheckoutView.swift"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "symbol_calls_name",
          symbol: "submit"
        })
      ])
    );
    expect(result.matches.map((match) => match.symbol)).toContain("CheckoutView.viewModel");
  });

  test("hybrid mode finds Swift error enum cases in Result and throws flows", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-swift-error-flow-"));
    await mkdir(path.join(root, "Sources", "Checkout"), { recursive: true });
    await writeFile(
      path.join(root, "Sources", "Checkout", "CheckoutService.swift"),
      `enum CheckoutError: Error {
    case paymentFailed(Error)
    case invalidCart, cancelled
}

struct CheckoutService {
    func submit(cart: Cart) async -> Result<Receipt, CheckoutError> {
        do {
            let receipt = try await gateway.authorize(cart)
            return .success(receipt)
        } catch {
            return .failure(mapError(error))
        }
    }

    func mapError(_ error: Error) -> CheckoutError {
        CheckoutError.paymentFailed(error)
    }
}
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["CheckoutError", "payment", "failed", "Result", "throws", "failure", "mapError"],
        symbolKinds: ["method"],
        roles: ["source"],
        pathHints: ["Sources/Checkout"],
        expand: ["callers", "parents"]
      },
      { target: root, mode: "hybrid", limit: 5 }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "CheckoutError.paymentFailed",
      kind: "method",
      file: "Sources/Checkout/CheckoutService.swift"
    });
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "called_by_name",
          symbol: "CheckoutService.mapError"
        })
      ])
    );
  });

  test("hybrid mode prefers exact class names over broader class-name substrings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-exact-class-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "graph.py"),
      `class MultiGraph:
    """Graph class adds nodes and edges with attributes and adjacency dictionaries."""

class Graph:
    """Graph class adds nodes and edges with attributes and adjacency dictionaries."""

class DiGraph:
    """Graph class adds nodes and edges with attributes and adjacency dictionaries."""
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does the Graph class add nodes and edges?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Graph",
      kind: "class",
      file: "pkg/graph.py"
    });
    expect(result.matches[0].why).toContain("exact class name match");
  });

  test("hybrid mode does not treat named graph algorithm questions as Graph class API requests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-graph-owner-scope-"));
    await mkdir(path.join(root, "networkx", "classes"), { recursive: true });
    await mkdir(path.join(root, "networkx", "generators"), { recursive: true });
    await writeFile(
      path.join(root, "networkx", "classes", "graph.py"),
      `class Graph:
    def nodes(self):
        barabasi_albert_graph_preferentially_attaching_new_nodes_high_degree_existing_nodes = []
        return barabasi_albert_graph_preferentially_attaching_new_nodes_high_degree_existing_nodes

    def degree(self):
        barabasi_albert_graph_preferentially_attaching_new_nodes_high_degree_existing_nodes = {}
        return barabasi_albert_graph_preferentially_attaching_new_nodes_high_degree_existing_nodes
`
    );
    await writeFile(
      path.join(root, "networkx", "generators", "random_graphs.py"),
      `def barabasi_albert_graph(n, m):
    """Grow a Barabasi Albert graph by preferentially attaching new nodes to high degree existing nodes."""
    return n, m
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does NetworkX grow a Barabasi Albert graph by preferentially attaching new nodes to high degree existing nodes?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "barabasi_albert_graph",
      kind: "function",
      file: "networkx/generators/random_graphs.py"
    });
    expect(result.matches.find((match) => match.symbol === "Graph.nodes")?.why).not.toContain("owner method intent");
  });

  test("hybrid mode prefers graph isomorphism implementations over generic Graph accessors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-graph-isomorphism-"));
    await mkdir(path.join(root, "networkx", "classes"), { recursive: true });
    await mkdir(path.join(root, "networkx", "algorithms", "isomorphism"), { recursive: true });
    await writeFile(
      path.join(root, "networkx", "classes", "graph.py"),
      `class Graph:
    def nodes(self):
        graph_isomorphism_optional_node_edge_matching_vf2_algorithm = []
        return graph_isomorphism_optional_node_edge_matching_vf2_algorithm

    def edges(self):
        graph_isomorphism_optional_node_edge_matching_vf2_algorithm = []
        return graph_isomorphism_optional_node_edge_matching_vf2_algorithm
`
    );
    await writeFile(
      path.join(root, "networkx", "algorithms", "isomorphism", "isomorph.py"),
      `def is_isomorphic(G1, G2, node_match=None, edge_match=None):
    """Test graph isomorphism with optional node and edge matching."""
    return True
`
    );
    await writeFile(
      path.join(root, "networkx", "algorithms", "isomorphism", "isomorphvf2.py"),
      `class GraphMatcher:
    """VF2 graph isomorphism matcher."""

    def is_isomorphic(self):
        return True
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does NetworkX test graph isomorphism with optional node and edge matching using the VF2 algorithm?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(["is_isomorphic", "GraphMatcher", "GraphMatcher.is_isomorphic"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].why).toContain("graph isomorphism intent");
  });

  test("hybrid mode does not boost methods for partial owner-token matches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-partial-owner-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "multipart.py"),
      `class MultipartStream:
    """Multipart form data stream encoder."""

    def __init__(self, data):
        multipart_form_data_encoded = data
        return None

    def get_content_length(self):
        multipart_form_data_length = 0
        return multipart_form_data_length
`
    );
    await indexTarget(root);

    const result = await queryIndex("where is multipart form data encoded?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "MultipartStream",
      kind: "class",
      file: "pkg/multipart.py"
    });
    expect(result.matches.find((match) => match.symbol === "MultipartStream.__init__")?.why).not.toContain(
      "method owner/source match"
    );
  });

  test("hybrid mode uses decorator target phrasing as an implementation hint", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-decorator-target-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "decorators.py"),
      `def command(f):
    attached_to_commands = f
    return attached_to_commands

def option(*param_decls):
    option_decorators_attached_to_commands = param_decls
    return option_decorators_attached_to_commands

class Command:
    def get_help_option(self):
        option_decorators_attached_to_commands = "helper option"
        return option_decorators_attached_to_commands
`
    );
    await indexTarget(root);

    const result = await queryIndex("where are option decorators attached to commands?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "option",
      kind: "function",
      file: "pkg/decorators.py"
    });
    expect(result.matches[0].why).toContain("decorator target match");
  });

  test("hybrid mode boosts multi-token symbol names covered by query terms", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-symbol-coverage-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "content.py"),
      `def encode_request(request):
    multipart_form_data_encoded = request
    return multipart_form_data_encoded

def encode_urlencoded_data(data):
    encoded_form_data = data
    return encoded_form_data

def encode_multipart_data(data):
    multipart_form_data_encoded = data
    return multipart_form_data_encoded
`
    );
    await indexTarget(root);

    const result = await queryIndex("where is multipart form data encoded?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "encode_multipart_data",
      kind: "function",
      file: "pkg/content.py"
    });
    expect(result.matches[0].why).toContain("symbol token coverage match");
  });

  test("hybrid mode prefers class representations for configuration questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-class-representation-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "api.py"),
      `def request(timeout=None):
    timeout_configuration_represented = timeout
    return timeout_configuration_represented
`
    );
    await writeFile(
      path.join(root, "pkg", "config.py"),
      `class Timeout:
    """Timeout configuration representation."""

    def __init__(self, value):
        self.value = value
`
    );
    await indexTarget(root);

    const result = await queryIndex("where is timeout configuration represented?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Timeout",
      kind: "class",
      file: "pkg/config.py"
    });
    expect(result.matches[0].why).toContain("representation class match");
  });

  test("hybrid mode can add an entrypoint intent candidate outside plain FTS matches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-entrypoint-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "__main__.py"),
      `def main():
    return run_app()

def run_app():
    return "ok"
`
    );
    await writeFile(
      path.join(root, "pkg", "notes.py"),
      `def describe_command_line_entrypoint():
    command_line_entrypoint_notes = "documentation only"
    return command_line_entrypoint_notes
`
    );
    await indexTarget(root);

    const fts = await queryIndex("where is the command line entrypoint?", {
      target: root,
      limit: 5,
      mode: "fts"
    });
    const hybrid = await queryIndex("where is the command line entrypoint?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(fts.matches[0].symbol).toBe("describe_command_line_entrypoint");
    expect(hybrid.matches[0]).toMatchObject({
      symbol: "main",
      file: "pkg/__main__.py"
    });
    expect(hybrid.matches[0].why).toContain("entrypoint intent match");
  });

  test("hybrid mode does not treat command line value handling as an entrypoint query", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-command-line-values-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "core.py"),
      `class Command:
    def main(self):
        command_line_entrypoint = "main command line entrypoint"
        return command_line_entrypoint

class Option:
    def consume_value(self, opts):
        command_line_values_defaults_prompts_environment_variables = opts
        return command_line_values_defaults_prompts_environment_variables
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does an option consume command line values, defaults, prompts, and environment variables?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Option.consume_value",
      kind: "method",
      file: "pkg/core.py"
    });
    expect(result.matches[0].why).not.toContain("entrypoint intent match");
  });

  test("hybrid mode does not treat CliRunner helper questions as entrypoint queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-cli-runner-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "core.py"),
      `class Command:
    def main(self, args=None):
        command_line_entrypoint = "main command invocation entrypoint"
        return command_line_entrypoint
`
    );
    await writeFile(
      path.join(root, "pkg", "testing.py"),
      `class CliRunner:
    def isolation(self):
        isolated_environment = "isolated test command environment"
        return isolated_environment

    def invoke(self, cli, args=None):
        command_in_isolation = self.isolation()
        return cli.main(args=args)
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does the test CliRunner invoke a command in isolation?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "CliRunner.invoke",
      kind: "method",
      file: "pkg/testing.py"
    });
    expect(result.matches[0].why).not.toContain("entrypoint intent match");
  });

  test("hybrid mode prefers matching child methods over broad class containers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-child-methods-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "core.py"),
      `class Option:
    """Options handle command line values, defaults, prompts, environment variables, and parsing."""

    command_line_values_defaults_prompts_environment_variables = "class overview"

    def consume_value(self, ctx, opts):
        value_source = "command line values defaults prompts environment variables"
        return value_source
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does an option consume command line values, defaults, prompts, and environment variables?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Option.consume_value",
      kind: "method",
      file: "pkg/core.py"
    });
    expect(result.matches[0].why).toContain("method owner/name match");
  });

  test("hybrid mode boosts high-signal implementation intents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-intents-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "export.py"),
      `def to_json(graph):
    return graph.to_json()
`
    );
    await writeFile(
      path.join(root, "pkg", "report.py"),
      `def generate():
    return "report"
`
    );
    await writeFile(
      path.join(root, "pkg", "cluster.py"),
      `def cluster_communities(graph):
    return graph
`
    );
    await writeFile(
      path.join(root, "pkg", "serve.py"),
      `def serve():
    return "mcp"
`
    );
    await writeFile(
      path.join(root, "pkg", "notes.py"),
      `def graph_json_export_notes():
    return "graph json export notes"

def report_generation_notes():
    return "report generation notes"

def community_detection_notes():
    return "community detection notes"

def mcp_server_notes():
    return "mcp server notes"
`
    );
    await indexTarget(root);

    await expectTopHybridSymbol(root, "where is graph json export handled?", "to_json");
    await expectTopHybridSymbol(root, "where is report generation?", "generate");
    await expectTopHybridSymbol(root, "where is community detection?", "cluster_communities");
    await expectTopHybridSymbol(root, "where is mcp server?", "serve");
  });

  test("hybrid mode expands generic action aliases for remaining implementation queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-action-aliases-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "extract.py"),
      `def extract_python(source):
    return source
`
    );
    await writeFile(
      path.join(root, "pkg", "build.py"),
      `def build(graph_data):
    return graph_data
`
    );
    await writeFile(
      path.join(root, "pkg", "serve.py"),
      `def _pick_seeds(graph):
    return list(graph)[:3]
`
    );
    await writeFile(
      path.join(root, "pkg", "notes.py"),
      `def code_extraction_notes():
    return "code extraction discussion"

def graph_built_notes():
    return "graph built discussion"

def query_seed_selection_notes():
    return "query seed selection discussion"
`
    );
    await indexTarget(root);

    await expectTopHybridSymbol(root, "where does code extraction happen?", "extract_python");
    await expectTopHybridSymbol(root, "where is the graph built?", "build");
    await expectTopHybridSymbol(root, "where are query seeds selected?", "_pick_seeds");
  });

  test("hybrid mode routes domain module questions to matching file stems", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-module-domain-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "_make.py"),
      `def _attrs_to_init_script():
    """Build class initialization script with converters validators setters fields and hooks."""
    converters_validators_setters_fields_hooks = "broad construction machinery"
    return converters_validators_setters_fields_hooks
`
    );
    await writeFile(
      path.join(root, "pkg", "converters.py"),
      `def optional(converter):
    """A converter that allows optional None values without conversion."""
    if converter is None:
        return None
    return converter
`
    );
    await writeFile(
      path.join(root, "pkg", "validators.py"),
      `def instance_of(type):
    """A validator that checks whether a value is an instance of a type."""
    return type
`
    );
    await writeFile(
      path.join(root, "pkg", "setters.py"),
      `def pipe(*setters):
    """Compose setter hooks into a pipeline."""
    return setters

def convert(instance, attrib, new_value):
    """Run an attribute converter hook on a new value."""
    return new_value
`
    );
    await writeFile(
      path.join(root, "pkg", "funcs.py"),
      `def asdict(instance):
    """Convert instances to dictionaries recursively."""
    return instance
`
    );
    await indexTarget(root);

    const converter = await queryIndex("where does attrs allow converters to accept None without conversion?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });
    const validator = await queryIndex("where does attrs validate that a value is an instance of a type?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });
    const setter = await queryIndex("where does attrs compose on_setattr setter hooks into a pipeline?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });
    const serializer = await queryIndex("where does attrs convert instances to dictionaries recursively?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(converter.matches[0]).toMatchObject({ symbol: "optional", file: "pkg/converters.py" });
    expect(validator.matches[0]).toMatchObject({ symbol: "instance_of", file: "pkg/validators.py" });
    expect(setter.matches[0]).toMatchObject({ symbol: "pipe", file: "pkg/setters.py" });
    expect(setter.matches[0].why).toContain("symbol name match");
    expect(serializer.matches[0]).toMatchObject({ symbol: "asdict", file: "pkg/funcs.py" });
  });

  test("hybrid mode treats glue words inside symbol names as optional for coverage", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-glue-symbol-coverage-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "_make.py"),
      `def _attrs_to_init_script():
    """Replace None values with defaults and factories while generating an initialization script."""
    return None
`
    );
    await writeFile(
      path.join(root, "pkg", "converters.py"),
      `def default_if_none(default=None, factory=None):
    """Replace None values with a default or factory."""
    return default, factory
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does attrs replace None values with a default or factory?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({ symbol: "default_if_none", file: "pkg/converters.py" });
    expect(result.matches[0].why).toContain("symbol token coverage match");
  });

  test("hybrid mode recognizes optional wrapper questions from None without conversion wording", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-optional-wrapper-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "converters.py"),
      `def default_if_none(default=None, factory=None):
    """Replace None values with a default or factory."""
    return default, factory

def optional(converter):
    """Allow None to pass through without conversion."""
    return converter
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does attrs allow converters to accept None without conversion?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({ symbol: "optional", file: "pkg/converters.py" });
    expect(result.matches[0].why).toContain("optional wrapper intent");
  });

  test("hybrid mode does not treat config parsing questions as low-level parser module questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-config-parser-guard-"));
    await mkdir(path.join(root, "pkg", "pgen2"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "files.py"),
      `def find_project_root(srcs):
    """Find project root markers such as git and pyproject toml."""
    return srcs

def parse_pyproject_toml(path_config):
    """Parse pyproject toml configuration and infer target versions."""
    return path_config
`
    );
    await writeFile(
      path.join(root, "pkg", "pgen2", "parse.py"),
      `class Parser:
    """Low level parser machinery for grammar tables."""

    def __init__(self, grammar):
        parse_pyproject_toml_configuration_inferred_target_versions = grammar
        return None
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Black find the project root and parse pyproject toml configuration including inferred target versions?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(["find_project_root", "parse_pyproject_toml"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].file).toBe("pkg/files.py");
    expect(result.matches.find((match) => match.symbol === "Parser.__init__")?.why).not.toContain(
      "module domain intent"
    );
  });

  test("hybrid mode treats HTTP header parsing questions as request handler work before parser modules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-http-header-parser-guard-"));
    await mkdir(path.join(root, "blackd"), { recursive: true });
    await mkdir(path.join(root, "blib2to3", "pgen2"), { recursive: true });
    await writeFile(
      path.join(root, "blackd", "__init__.py"),
      `async def handle(request, executor, executor_semaphore):
    """Handle an HTTP request, parse headers, format request body, and return the response."""
    headers = request.headers
    return headers

def parse_mode(headers):
    """Parse HTTP headers into formatting mode."""
    return headers
`
    );
    await writeFile(
      path.join(root, "blib2to3", "pgen2", "parse.py"),
      `class Parser:
    """Low level parser machinery."""

    def __init__(self, grammar):
        http_request_parse_headers_format_request_body_return_response = grammar
        return None
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does blackd handle an HTTP request, parse headers, format the request body, and return the response?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({ symbol: "handle", file: "blackd/__init__.py" });
    expect(result.matches.find((match) => match.symbol === "Parser.__init__")?.why).not.toContain(
      "module domain intent"
    );
  });

  test("hybrid mode prefers explicit stdin stdout formatting over unrelated read helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-stdio-formatting-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "action.py"),
      `def read_version_specifier_from_pyproject(path):
    """Read code version specifier data and write action output."""
    return path
`
    );
    await writeFile(
      path.join(root, "pkg", "formatting.py"),
      `def format_stdin_to_stdout(fast, *, content=None, write_back=None, mode=None):
    """Read code from stdin and write formatted output or a diff to stdout."""
    return content
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Black read code from stdin and write formatted output or a diff to stdout?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({ symbol: "format_stdin_to_stdout", file: "pkg/formatting.py" });
    expect(result.matches[0].why).toContain("stdio formatting intent");
  });

  test("hybrid mode prefers concrete filesystem loader source methods over abstract loader methods", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-filesystem-loader-source-"));
    await mkdir(path.join(root, "jinja2"), { recursive: true });
    await writeFile(
      path.join(root, "jinja2", "loaders.py"),
      `class BaseLoader:
    def get_source(self, environment, template):
        """Get template source text, filename, and reload helper."""
        return template

class FileSystemLoader(BaseLoader):
    def get_source(self, environment, template):
        """Search filesystem template directories, read source text, and create the uptodate reload check."""
        searchpath = ["templates"]
        filename = searchpath[0] + "/" + template
        uptodate = lambda: True
        return filename, uptodate
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Jinja search filesystem template directories, read the source text, and create the uptodate reload check?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "FileSystemLoader.get_source",
      file: "jinja2/loaders.py"
    });
    expect(result.matches[0].why).toContain("filesystem loader intent");
  });

  test("hybrid mode prefers full-template parser methods over specific parse helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-template-parser-scope-"));
    await mkdir(path.join(root, "jinja2"), { recursive: true });
    await writeFile(
      path.join(root, "jinja2", "parser.py"),
      `class Parser:
    def parse_block(self):
        """Parse one named block statement."""
        return "block"

    def parse_statement(self):
        """Parse a single statement block."""
        return "statement"

    def subparse(self):
        """Parse template data, variable blocks, and statement blocks into body nodes."""
        return []

    def parse(self):
        """Parse the whole template into a Template node AST."""
        return self.subparse()
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Jinja parse template data variable blocks and statement blocks into a Template node AST?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(["Parser.subparse", "Parser.parse"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].why).toContain("template parser pipeline intent");
  });

  test("hybrid mode prefers environment compile pipeline over expression parser helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-template-compile-pipeline-"));
    await mkdir(path.join(root, "jinja2"), { recursive: true });
    await writeFile(
      path.join(root, "jinja2", "parser.py"),
      `class Parser:
    def parse_or(self):
        """Parse an or expression."""
        return "or"

    def parse_and(self):
        """Parse an and expression."""
        return "and"
`
    );
    await writeFile(
      path.join(root, "jinja2", "environment.py"),
      `class Environment:
    def _parse(self, source, name, filename):
        """Parse template source into an AST."""
        return source

    def _generate(self, source, name, filename):
        """Generate Python source from a template AST."""
        return source

    def compile(self, source, name=None, filename=None, raw=False):
        """Parse template source, generate Python source, and compile it into a code object or raw generated code."""
        parsed = self._parse(source, name, filename)
        generated = self._generate(parsed, name, filename)
        return generated
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Jinja parse template source, generate Python source, and compile it into a code object or raw generated code?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(["Environment.compile", "Environment._parse", "Environment._generate"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].why).toContain("template compile pipeline intent");
  });

  test("hybrid mode prefers named owner API methods over broad validator modules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-public-api-owner-"));
    await mkdir(path.join(root, "pydantic", "_internal"), { recursive: true });
    await writeFile(
      path.join(root, "pydantic", "main.py"),
      `class BaseModel:
    def model_validate(self, obj, *, strict=None, extra=None, from_attributes=None, by_alias=None, by_name=None):
        """Validate a Python object into a BaseModel with strict extra from_attributes by_alias and by_name options."""
        return obj
`
    );
    await writeFile(
      path.join(root, "pydantic", "type_adapter.py"),
      `class TypeAdapter:
    def validate_python(self, obj, *, strict=None, extra=None, from_attributes=None, experimental_allow_partial=None, by_alias=None, by_name=None):
        """Validate a Python object with strict extra from_attributes partial validation by_alias and by_name options."""
        return obj
`
    );
    await writeFile(
      path.join(root, "pydantic", "functional_validators.py"),
      `def field_validator(*fields, mode="after", check_fields=None):
    """Create field validator decorators for validating values on BaseModel fields."""
    return fields

def model_validator(*, mode):
    """Create model validator decorators for validating BaseModel instances."""
    return mode
`
    );
    await writeFile(
      path.join(root, "pydantic", "_internal", "_validate_call.py"),
      `def update_wrapper_attributes(wrapped, wrapper):
    """Validate call helper that updates wrapper attributes for validated functions."""
    return wrapper

def extract_function_name(function):
    """Validate call helper for extracting the function name."""
    return function.__name__
`
    );
    await indexTarget(root);

    const baseModel = await queryIndex(
      "where does Pydantic validate a Python object into a BaseModel with strict extra from_attributes by_alias and by_name options?",
      { target: root, limit: 5, mode: "hybrid" }
    );
    const typeAdapter = await queryIndex(
      "where does Pydantic TypeAdapter validate a Python object with strict extra from_attributes partial validation by_alias and by_name options?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(baseModel.matches[0]).toMatchObject({ symbol: "BaseModel.model_validate", file: "pydantic/main.py" });
    expect(typeAdapter.matches[0]).toMatchObject({ symbol: "TypeAdapter.validate_python", file: "pydantic/type_adapter.py" });
  });

  test("hybrid mode prefers the public dynamic model factory over validator helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-create-model-"));
    await mkdir(path.join(root, "pydantic"), { recursive: true });
    await writeFile(
      path.join(root, "pydantic", "main.py"),
      `def create_model(model_name, **field_definitions):
    """Dynamically create a BaseModel subclass from field definitions validators config base and module."""
    return model_name
`
    );
    await writeFile(
      path.join(root, "pydantic", "functional_validators.py"),
      `def field_validator(*fields, mode="after", check_fields=None):
    """Create field validator decorators for validating field definitions on a BaseModel."""
    return fields

def model_validator(*, mode):
    """Create model validator decorators for validating a BaseModel subclass."""
    return mode
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Pydantic dynamically create a BaseModel subclass from field definitions validators config base and module?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({ symbol: "create_model", file: "pydantic/main.py" });
  });

  test("hybrid mode prefers exact public factory functions for noun factory questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-noun-factory-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "_make.py"),
      `def _determine_whether_to_implement(cls):
    """Determine whether to implement generated methods for fields with factories."""
    return cls

def attrs(cls=None, these=None):
    """Classic attrs class decorator that reads field factories and generated methods."""
    return cls
`
    );
    await writeFile(
      path.join(root, "pkg", "_next_gen.py"),
      `def field(*, default=None, factory=None, validator=None):
    """Create a new field on a class. The factory argument is syntactic sugar for defaults."""
    return default, factory, validator
`
    );
    await indexTarget(root);

    const result = await queryIndex("where is attrs field factory implemented?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({ symbol: "field", file: "pkg/_next_gen.py" });
    expect(result.matches[0].why).toContain("factory constructor intent");
  });

  test("hybrid mode prefers exact public create-object factories over internal create helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-create-object-factory-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await mkdir(path.join(root, "pkg", "pool"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "create.py"),
      `def create_engine(url, **kwargs):
    """Create an Engine from a URL while configuring dialect, pool, plugins, and connection arguments."""
    return url, kwargs
`
    );
    await writeFile(
      path.join(root, "pkg", "pool", "base.py"),
      `class Pool:
    def _create_connection(self):
        """Create a pooled connection for a pool while handling connection arguments."""
        return None
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy create an Engine from a URL while configuring dialect, pool, plugins, and connection arguments?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({ symbol: "create_engine", file: "pkg/engine/create.py" });
    expect(result.matches[0].why).toContain("create object factory intent");
  });

  test("hybrid mode does not infer owner API intent from action words alone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-json-schema-owner-"));
    await mkdir(path.join(root, "pydantic", "_internal"), { recursive: true });
    await writeFile(
      path.join(root, "pydantic", "main.py"),
      `class BaseModel:
    def model_json_schema(self, by_alias=True, ref_template=None, union_format=None, schema_generator=None, mode="validation"):
        """Generate JSON schema for a model with by_alias ref_template union_format schema generator and mode."""
        return {}
`
    );
    await writeFile(
      path.join(root, "pydantic", "_internal", "_generate_schema.py"),
      `class GenerateSchema:
    def _model_schema(self, model):
        """Generate core schema for a model while resolving fields and validators."""
        return model
`
    );
    await writeFile(
      path.join(root, "pydantic", "json_schema.py"),
      `class GenerateJsonSchema:
    def model_schema(self, schema):
        """Generate JSON schema internals for a model schema."""
        return schema
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Pydantic generate JSON schema for a model with by_alias ref_template union_format schema generator and mode?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({ symbol: "BaseModel.model_json_schema", file: "pydantic/main.py" });
    expect(result.matches.find((match) => match.symbol === "GenerateSchema._model_schema")?.why).not.toContain(
      "named owner API intent"
    );
  });

  test("hybrid mode prefers model completion orchestration over functional schema helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-model-completion-distractors-"));
    await mkdir(path.join(root, "pydantic", "_internal"), { recursive: true });
    await writeFile(
      path.join(root, "pydantic", "_internal", "_model_construction.py"),
      `def complete_model_class(cls):
    """Finish building a model class by generating core schema validators serializers and computed fields."""
    return cls
`
    );
    await writeFile(
      path.join(root, "pydantic", "functional_validators.py"),
      `class PlainValidator:
    def __get_pydantic_core_schema__(self, source_type, handler):
        """Generate core schema for plain validators during model schema building."""
        return handler(source_type)
`
    );
    await writeFile(
      path.join(root, "pydantic", "functional_serializers.py"),
      `class PlainSerializer:
    def __get_pydantic_core_schema__(self, source_type, handler):
        """Generate core schema for serializers and computed fields."""
        return handler(source_type)
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Pydantic finish building a model class by generating core schema validators serializers and computed fields?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "complete_model_class",
      file: "pydantic/_internal/_model_construction.py"
    });
  });

  test("hybrid mode prefers public model rebuild over forward reference helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-model-rebuild-"));
    await mkdir(path.join(root, "pydantic", "_internal"), { recursive: true });
    await writeFile(
      path.join(root, "pydantic", "main.py"),
      `class BaseModel:
    def model_rebuild(self, *, _parent_namespace_depth=2, _types_namespace=None):
        """Rebuild a model schema using parent namespaces to resolve forward references."""
        return None
`
    );
    await writeFile(
      path.join(root, "pydantic", "_internal", "_generate_schema.py"),
      `class GenerateSchema:
    def _resolve_forward_ref(self, obj):
        """Resolve forward references while generating model schema."""
        return obj
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Pydantic rebuild a model schema using parent namespaces to resolve forward references?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({ symbol: "BaseModel.model_rebuild", file: "pydantic/main.py" });
  });

  test("hybrid mode only applies build intent to graph construction questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-build-context-"));
    await mkdir(path.join(root, "pkg", "assertion"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "terminal.py"),
      `class TerminalReporter:
    def build_summary_stats_line(self):
        rich_assertion_failure_explanations_and_comparison_output = "summary stats"
        return rich_assertion_failure_explanations_and_comparison_output
`
    );
    await writeFile(
      path.join(root, "pkg", "assertion", "util.py"),
      `def assertrepr_compare():
    rich_assertion_failure_explanations_and_comparison_output = "assertion comparison"
    return rich_assertion_failure_explanations_and_comparison_output
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does pytest build rich assertion failure explanations and comparison output?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "assertrepr_compare",
      kind: "function",
      file: "pkg/assertion/util.py"
    });
    expect(result.matches.find((match) => match.symbol === "TerminalReporter.build_summary_stats_line")?.why).not.toContain(
      "query intent match"
    );
  });

  test("hybrid mode does not treat dependency graph questions as generic build intent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-dependency-graph-"));
    await mkdir(path.join(root, "pkg", "dependencies"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "applications.py"),
      `class FastAPI:
    def build_middleware_stack(self):
        endpoint_signatures_dependency_graph = "middleware stack"
        return endpoint_signatures_dependency_graph
`
    );
    await writeFile(
      path.join(root, "pkg", "dependencies", "utils.py"),
      `def get_dependant(endpoint):
    endpoint_signatures_dependency_graph = endpoint
    return endpoint_signatures_dependency_graph
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI inspect endpoint signatures and build the dependency graph?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "get_dependant",
      kind: "function",
      file: "pkg/dependencies/utils.py"
    });
    expect(result.matches.find((match) => match.symbol === "FastAPI.build_middleware_stack")?.why).not.toContain(
      "query intent match"
    );
  });

  test("hybrid mode does not treat Laplacian matrix questions as generic graph build intent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-laplacian-matrix-"));
    await mkdir(path.join(root, "pkg", "flow"), { recursive: true });
    await mkdir(path.join(root, "pkg", "linalg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "flow", "utils.py"),
      `def build_residual_network(graph):
    build_graph_residual_network_capacity_flow_values = graph
    return build_graph_residual_network_capacity_flow_values
`
    );
    await mkdir(path.join(root, "pkg", "readwrite"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "readwrite", "graphml.py"),
      `def generate_graphml(graph):
    build_graph_laplacian_sparse_matrices_adjacency_degree_data = graph
    return graph
`
    );
    await writeFile(
      path.join(root, "pkg", "linalg", "laplacianmatrix.py"),
      `def laplacian_matrix(graph):
    adjacency_degree_sparse_matrix = graph
    return adjacency_degree_sparse_matrix

def normalized_laplacian_matrix(graph):
    normalized_adjacency_degree_sparse_matrix = graph
    return normalized_adjacency_degree_sparse_matrix
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does NetworkX build graph Laplacian sparse matrices from adjacency and degree data?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "laplacian_matrix",
      kind: "function",
      file: "pkg/linalg/laplacianmatrix.py"
    });
    expect(result.matches.find((match) => match.symbol === "build_residual_network")?.why).not.toContain(
      "query intent match"
    );
    expect(result.matches.find((match) => match.symbol === "generate_graphml")?.why).not.toContain(
      "create object factory intent"
    );
  });

  test("hybrid mode scopes factory intent to named algorithms in community questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-louvain-factory-scope-"));
    await mkdir(path.join(root, "pkg", "algorithms", "community"), { recursive: true });
    await mkdir(path.join(root, "pkg", "generators"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "generators", "community.py"),
      `def _generate_communities(graph):
    move_nodes_between_communities_modularity_gain_build_community_partitions = graph
    return graph
`
    );
    await writeFile(
      path.join(root, "pkg", "algorithms", "community", "louvain.py"),
      `def louvain_partitions(graph):
    move_nodes_between_communities_louvain_modularity_gain_build_community_partitions = graph
    return graph

def _one_level(graph):
    move_nodes_between_communities_louvain_modularity_gain = graph
    return graph
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does NetworkX move nodes between communities for Louvain modularity gain and build community partitions?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(["louvain_partitions", "_one_level"]).toContain(result.matches[0].symbol);
    expect(result.matches.find((match) => match.symbol === "_generate_communities")?.why).not.toContain(
      "create object factory intent"
    );
  });

  test("hybrid mode prefers bidirectional Dijkstra implementations for source-target expansion queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-bidirectional-dijkstra-"));
    await mkdir(path.join(root, "pkg", "shortest_paths"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "shortest_paths", "generic.py"),
      `def shortest_path(graph, source, target, weight=None):
    weighted_shortest_path_source_target_dijkstra = graph
    return weighted_shortest_path_source_target_dijkstra
`
    );
    await writeFile(
      path.join(root, "pkg", "shortest_paths", "weighted.py"),
      `def single_source_dijkstra(graph, source, target=None, weight=None):
    weighted_shortest_path_source_target_dijkstra = graph
    return weighted_shortest_path_source_target_dijkstra

def bidirectional_dijkstra(graph, source, target, weight=None):
    weighted_shortest_path_expanding_from_both_source_and_target = graph
    return weighted_shortest_path_expanding_from_both_source_and_target
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does NetworkX find a weighted shortest path by expanding Dijkstra search from both source and target?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "bidirectional_dijkstra",
      kind: "function",
      file: "pkg/shortest_paths/weighted.py"
    });
    expect(result.matches[0].why).toContain("bidirectional path intent");
  });

  test("hybrid mode does not treat shortest path dispatch questions as bidirectional-only queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-shortest-dispatch-"));
    await mkdir(path.join(root, "pkg", "shortest_paths"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "shortest_paths", "generic.py"),
      `def shortest_path(graph, source=None, target=None, weight=None, method="dijkstra"):
    unweighted_dijkstra_bellman_ford_branches_source_target_arguments = graph
    return unweighted_dijkstra_bellman_ford_branches_source_target_arguments
`
    );
    await writeFile(
      path.join(root, "pkg", "shortest_paths", "weighted.py"),
      `def bidirectional_dijkstra(graph, source, target, weight=None):
    source_target_dijkstra = graph
    return source_target_dijkstra
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does NetworkX shortest_path choose between unweighted, Dijkstra, and Bellman-Ford branches for source and target arguments?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "shortest_path",
      kind: "function",
      file: "pkg/shortest_paths/generic.py"
    });
    expect(result.matches.find((match) => match.symbol === "bidirectional_dijkstra")?.why).not.toContain(
      "bidirectional path intent"
    );
  });

  test("hybrid mode prefers multisource Dijkstra implementations over generic shortest path dispatch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-multisource-dijkstra-"));
    await mkdir(path.join(root, "pkg", "shortest_paths"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "shortest_paths", "generic.py"),
      `def shortest_path(graph, source=None, target=None, weight=None):
    dijkstra_shortest_weighted_paths_one_or_more_sources_heap_fringe = graph
    return dijkstra_shortest_weighted_paths_one_or_more_sources_heap_fringe
`
    );
    await writeFile(
      path.join(root, "pkg", "shortest_paths", "weighted.py"),
      `def _dijkstra_multisource(graph, sources, weight):
    """Implement Dijkstra shortest weighted paths from one or more sources using a heap fringe."""
    return sources

def multi_source_dijkstra(graph, sources):
    return _dijkstra_multisource(graph, sources, None)
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does NetworkX implement Dijkstra shortest weighted paths from one or more sources using a heap fringe?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(["_dijkstra_multisource", "multi_source_dijkstra"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].why).toContain("multisource dijkstra intent");
  });

  test("hybrid mode prefers path weight helpers for existing path cost queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-path-weight-"));
    await mkdir(path.join(root, "pkg", "approximation"), { recursive: true });
    await mkdir(path.join(root, "pkg", "classes"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "approximation", "traveling_salesman.py"),
      `def traveling_salesman_problem(graph):
    sum_edge_weights_along_path = graph
    return sum_edge_weights_along_path
`
    );
    await writeFile(
      path.join(root, "pkg", "classes", "function.py"),
      `def is_path(graph, path):
    path_exists = True
    return path_exists

def path_weight(graph, path, weight):
    sum_edge_weights_along_existing_path = graph
    if not is_path(graph, path):
        raise Exception("path does not exist")
    return sum_edge_weights_along_existing_path
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does NetworkX sum edge weights along an existing path and raise if the path does not exist?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "path_weight",
      kind: "function",
      file: "pkg/classes/function.py"
    });
    expect(result.matches[0].why).toContain("path weight intent");
  });

  test("hybrid mode prefers fast Gnp generation for sparse O n plus m questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-fast-gnp-"));
    await mkdir(path.join(root, "pkg", "generators"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "generators", "random_graphs.py"),
      `def gnp_random_graph(n, p):
    choose_each_possible_edge_probability_p_o_n_squared = n
    return choose_each_possible_edge_probability_p_o_n_squared

def fast_gnp_random_graph(n, p):
    sparse_gnp_random_graph_o_n_plus_m_skipping_absent_edges = n
    return sparse_gnp_random_graph_o_n_plus_m_skipping_absent_edges
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does NetworkX generate sparse Gnp random graphs in O n plus m time by skipping absent edges?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "fast_gnp_random_graph",
      kind: "function",
      file: "pkg/generators/random_graphs.py"
    });
    expect(result.matches[0].why).toContain("fast random graph intent");
  });

  test("hybrid mode prefers quadratic Gnp generation over generic graph edge accessors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-quadratic-gnp-"));
    await mkdir(path.join(root, "networkx", "classes"), { recursive: true });
    await mkdir(path.join(root, "networkx", "generators"), { recursive: true });
    await writeFile(
      path.join(root, "networkx", "classes", "graph.py"),
      `class Graph:
    def edges(self):
        gnp_random_graph_edge_probability_p_o_n_squared_time = []
        return gnp_random_graph_edge_probability_p_o_n_squared_time
`
    );
    await writeFile(
      path.join(root, "networkx", "generators", "random_graphs.py"),
      `def gnp_random_graph(n, p):
    """Choose each possible Gnp random graph edge with probability p in O n squared time."""
    return n, p

def fast_gnp_random_graph(n, p):
    """Generate sparse Gnp random graphs in O n plus m time by skipping absent edges."""
    return n, p
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does NetworkX choose each possible Gnp random graph edge with probability p in O n squared time?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "gnp_random_graph",
      kind: "function",
      file: "networkx/generators/random_graphs.py"
    });
    expect(result.matches[0].why).toContain("quadratic random graph intent");
  });

  test("hybrid mode prefers implementations over hook specifications for command-line parsing questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-hook-specs-"));
    await mkdir(path.join(root, "pkg", "config"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "hookspec.py"),
      `def pytest_cmdline_parse(pluginmanager, args):
    """Hook specification for parsing config and running the test session."""
    return None
`
    );
    await writeFile(
      path.join(root, "pkg", "config", "__init__.py"),
      `def _prepareconfig(args):
    parsed_config = args
    return parsed_config

def _console_main():
    config = _prepareconfig([])
    return main(config)

def console_main():
    return _console_main()

def main(config):
    test_session = config
    return test_session

class Config:
    def pytest_cmdline_parse(self):
        parsed_config = self.parse()
        return parsed_config

    def parse(self):
        parsed_config = "config"
        return parsed_config
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does pytest command line parse config and run the test session?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "_prepareconfig",
      kind: "function",
      file: "pkg/config/__init__.py"
    });
  });

  test("hybrid mode prefers console main entrypoints over config parse helpers when console main is named", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-console-main-"));
    await mkdir(path.join(root, "pkg", "config"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "config", "__init__.py"),
      `def _prepareconfig(args):
    parsed_config = args
    return parsed_config

def _console_main():
    config = _prepareconfig([])
    return _main(config)

def console_main():
    return _console_main()

def _main(config):
    test_session = config
    return test_session

class Config:
    def pytest_cmdline_parse(self):
        parsed_config = self.parse()
        return parsed_config

    def parse(self):
        parsed_config = "config"
        return parsed_config
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does pytest console main parse config and run the test session?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "_console_main",
      kind: "function",
      file: "pkg/config/__init__.py"
    });
    expect(result.matches[0].why).toContain("entrypoint intent match");
  });

  test("hybrid mode lifts lifecycle methods over wrapper hooks for multi-action queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-lifecycle-actions-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "capture.py"),
      `class CaptureManager:
    def start_global_capturing(self):
        capture_stdout_and_stderr = "start"
        return capture_stdout_and_stderr

    def suspend_global_capture(self):
        capture_stdout_and_stderr = "suspend"
        return capture_stdout_and_stderr

    def resume_global_capture(self):
        capture_stdout_and_stderr = "resume"
        return capture_stdout_and_stderr

    def read_global_capture(self):
        captured_stdout_and_stderr = "read"
        return captured_stdout_and_stderr

    def pytest_make_collect_report(self):
        captured_stdout_and_stderr = [
            self.start_global_capturing(),
            self.suspend_global_capture(),
            self.resume_global_capture(),
            self.read_global_capture(),
        ]
        return captured_stdout_and_stderr
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does pytest start suspend resume and read captured stdout and stderr?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect([
      "CaptureManager.start_global_capturing",
      "CaptureManager.suspend_global_capture",
      "CaptureManager.resume_global_capture",
      "CaptureManager.read_global_capture"
    ]).toContain(result.matches[0].symbol);
    expect(result.matches[0]).toMatchObject({
      kind: "method",
      file: "pkg/capture.py"
    });
    expect(result.matches[0].why).toContain("lifecycle action match");
  });

  test("hybrid mode prefers action-domain implementation methods over adjacent validation helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-action-domain-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "main.py"),
      `class Session:
    def perform_collect(self):
        collection_phase_collectors_into_test_items = []
        return collection_phase_collectors_into_test_items
`
    );
    await writeFile(
      path.join(root, "pkg", "nodes.py"),
      `class Item:
    def _check_item_and_collector_diamond_inheritance(self):
        collection_phase_collectors_into_test_items = "validation helper"
        return collection_phase_collectors_into_test_items
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does pytest perform collection and turn collectors into test items?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Session.perform_collect",
      kind: "method",
      file: "pkg/main.py"
    });
    expect(result.matches[0].why).toContain("action/domain symbol match");
  });

  test("hybrid mode prefers flag behavior over option registration for behavior queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-flag-behavior-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "cacheprovider.py"),
      `def pytest_addoption(parser):
    parser.addoption("--lf", "--last-failed", help="cache last failed tests")
    parser.addoption("--ff", "--failed-first", help="reorder collection")

class LFPlugin:
    def get_last_failed_paths(self):
        lastfailed = {}
        return lastfailed

    def pytest_collection_modifyitems(self, config, items):
        previously_failed = self.get_last_failed_paths()
        previously_passed = []
        items[:] = list(previously_failed) + previously_passed
        return items
`
    );
    await writeFile(
      path.join(root, "pkg", "stepwise.py"),
      `class StepwisePlugin:
    def pytest_collection_modifyitems(self, config, items):
        failed_tests_reorder_collection = items
        return failed_tests_reorder_collection
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does pytest cache last failed tests and reorder collection for --lf and --ff?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "LFPlugin.pytest_collection_modifyitems",
      kind: "method",
      file: "pkg/cacheprovider.py"
    });
    const optionRegistration = result.matches.find((match) => match.symbol === "pytest_addoption");
    if (optionRegistration) {
      expect(optionRegistration.why).toContain("option registration context");
    }
  });

  test("hybrid mode prefers exact file-stem context over adjacent feature modules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-file-stem-context-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "python.py"),
      `class PyCollector:
    def collect(self):
        python_modules_classes_test_functions = []
        return python_modules_classes_test_functions
`
    );
    await writeFile(
      path.join(root, "pkg", "doctest.py"),
      `class DoctestModule:
    def collect(self):
        python_modules_classes_test_functions = "doctest feature collection"
        return python_modules_classes_test_functions
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does pytest collect Python modules classes and test functions?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "PyCollector.collect",
      kind: "method",
      file: "pkg/python.py"
    });
    expect(result.matches[0].why).toContain("exact file context match");
  });

  test("hybrid mode does not let a named framework class beat the behavior symbol", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-framework-class-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "applications.py"),
      `class FastAPI:
    """FastAPI application container mentioning pydantic models dataclasses enums paths and collections."""

    def get(self):
        pydantic_models_dataclasses_enums_paths_collections = "route decorator"
        return pydantic_models_dataclasses_enums_paths_collections
`
    );
    await writeFile(
      path.join(root, "pkg", "encoders.py"),
      `def jsonable_encoder(value):
    pydantic_models_dataclasses_enums_paths_collections_json_compatible_data = value
    return pydantic_models_dataclasses_enums_paths_collections_json_compatible_data
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does FastAPI convert pydantic models dataclasses enums paths and collections into JSON compatible data?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "jsonable_encoder",
      kind: "function",
      file: "pkg/encoders.py"
    });
  });

  test("hybrid mode prefers JSON-compatible encoders over lower-level serialize helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-json-compatible-encoder-"));
    await mkdir(path.join(root, "pkg", "_compat"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "_compat", "v2.py"),
      `class ModelField:
    def serialize_json(self, value):
        pydantic_models_dataclasses_enums_paths_collections_json_compatible_data = value
        return value

    def serialize(self, value):
        pydantic_models_dataclasses_enums_paths_collections_json_compatible_data = value
        return value

def serialize_sequence_value(value):
    pydantic_models_dataclasses_enums_paths_collections_json_compatible_data = value
    return value
`
    );
    await writeFile(
      path.join(root, "pkg", "encoders.py"),
      `def jsonable_encoder(value):
    """Convert pydantic models dataclasses enums paths and collections into JSON compatible data."""
    return value
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does FastAPI convert pydantic models dataclasses enums paths and collections into JSON compatible data?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "jsonable_encoder",
      kind: "function",
      file: "pkg/encoders.py"
    });
    expect(result.matches[0].why).toContain("object serialization intent");
  });

  test("hybrid mode does not let constructor setup text beat a named behavior method", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-constructor-container-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "applications.py"),
      `class FastAPI:
    def __init__(self):
        openapi_schema_application_cache = "constructor overview"
        return None

    def openapi(self):
        openapi_schema_application_cache = "specific behavior"
        return openapi_schema_application_cache
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI build and cache the OpenAPI schema for the application?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "FastAPI.openapi",
      kind: "method",
      file: "pkg/applications.py"
    });
    expect(result.matches.find((match) => match.symbol === "FastAPI.__init__")?.why).not.toContain(
      "method owner/source match"
    );
  });

  test("hybrid mode prefers documentation setup over generic route decorators", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-doc-route-setup-"));
    await mkdir(path.join(root, "pkg", "openapi"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "applications.py"),
      `class FastAPI:
    def setup(self):
        openapi_json_docs_swagger_ui_redoc_routes = "documentation route setup"
        get_swagger_ui_html()
        get_redoc_html()
        return openapi_json_docs_swagger_ui_redoc_routes

    def api_route(self, path):
        openapi_json_docs_swagger_ui_redoc_routes = "generic route decorator"
        return path
`
    );
    await writeFile(
      path.join(root, "pkg", "openapi", "docs.py"),
      `def get_swagger_ui_html():
    openapi_json_docs_swagger_ui = "swagger ui docs"
    return openapi_json_docs_swagger_ui

def get_redoc_html():
    openapi_json_docs_redoc = "redoc docs"
    return openapi_json_docs_redoc
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI setup the openapi json docs swagger ui and redoc routes?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "FastAPI.setup",
      kind: "method",
      file: "pkg/applications.py"
    });
    expect(result.matches[0].why).toContain("documentation route setup intent");
  });

  test("hybrid mode surfaces exception response handlers over broad framework context", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-exception-handlers-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "applications.py"),
      `class FastAPI:
    def __init__(self):
        http_exceptions_request_validation_errors_json_responses = "framework setup"
        return None
`
    );
    await writeFile(
      path.join(root, "pkg", "exception_handlers.py"),
      `def http_exception_handler(request, exc):
    http_exceptions_json_responses = {"detail": exc.detail}
    return JSONResponse(http_exceptions_json_responses)

def request_validation_exception_handler(request, exc):
    request_validation_errors_json_responses = {"detail": exc.errors()}
    return JSONResponse(request_validation_errors_json_responses)
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI convert HTTP exceptions and request validation errors into JSON responses?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(["http_exception_handler", "request_validation_exception_handler"]).toContain(result.matches[0].symbol);
    expect(result.matches[0]).toMatchObject({
      kind: "function",
      file: "pkg/exception_handlers.py"
    });
    expect(result.matches[0].why).toContain("exception response handler intent");
  });

  test("hybrid mode treats callable auth classes as behavior entrypoints for token header queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-auth-callable-"));
    await mkdir(path.join(root, "pkg", "security"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "security", "oauth2.py"),
      `class OAuth2PasswordBearer:
    def __init__(self):
        oauth2_password_bearer_tokens_authorization_header = "configuration docs"
        return None

    def make_not_authenticated_error(self):
        authorization_header_error = "not authenticated"
        return authorization_header_error

    async def __call__(self, request):
        authorization = request.headers.get("Authorization")
        scheme, token = get_authorization_scheme_param(authorization)
        oauth2_password_bearer_tokens_authorization_header = token
        return oauth2_password_bearer_tokens_authorization_header
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI read OAuth2 password bearer tokens from the Authorization header?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "OAuth2PasswordBearer.__call__",
      kind: "method",
      file: "pkg/security/oauth2.py"
    });
    expect(result.matches[0].why).toContain("callable auth behavior intent");
  });

  test("hybrid mode keeps callable auth ranking scoped to the requested scheme", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-auth-scheme-"));
    await mkdir(path.join(root, "pkg", "security"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "security", "http.py"),
      `class HTTPBearer:
    async def __call__(self, request):
        authorization = request.headers.get("Authorization")
        scheme, credentials = get_authorization_scheme_param(authorization)
        http_bearer_authorization_headers_credentials = credentials
        return http_bearer_authorization_headers_credentials
`
    );
    await writeFile(
      path.join(root, "pkg", "security", "oauth2.py"),
      `class OAuth2PasswordBearer:
    async def __call__(self, request):
        authorization = request.headers.get("Authorization")
        scheme, token = get_authorization_scheme_param(authorization)
        oauth2_password_bearer_authorization_header_token = token
        return oauth2_password_bearer_authorization_header_token
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI parse HTTP bearer authorization headers and return credentials?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "HTTPBearer.__call__",
      kind: "method",
      file: "pkg/security/http.py"
    });
    expect(result.matches[0].why).toContain("callable auth behavior intent");
  });

  test("hybrid mode prefers direct route registration over router composition helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-route-registration-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "routing.py"),
      `class APIRouter:
    def include_router(self, router):
        api_route_response_model_dependencies_callbacks = router
        return self.add_api_route(api_route_response_model_dependencies_callbacks)

    def get(self, path):
        api_route_response_model_dependencies_callbacks = "decorator"
        return self.add_api_route(path)

    def add_api_route(self, path, endpoint=None, response_model=None, dependencies=None, callbacks=None):
        route = APIRoute(path, endpoint, response_model=response_model, dependencies=dependencies, callbacks=callbacks)
        return route

class APIRoute:
    def __init__(self, path, endpoint=None, response_model=None, dependencies=None, callbacks=None):
        self.path = path
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI add an API route with response model dependencies and callbacks?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "APIRouter.add_api_route",
      kind: "method",
      file: "pkg/routing.py"
    });
    expect(result.matches[0].why).toContain("route registration intent");
  });

  test("hybrid mode prefers add route methods over route decorators for add-route questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-add-route-action-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "applications.py"),
      `class FastAPI:
    def api_route(self, path):
        api_route_response_model_dependencies_callbacks = "decorator"
        return self.add_api_route(path)

    def add_api_route(self, path, endpoint=None, response_model=None, dependencies=None, callbacks=None):
        api_route_response_model_dependencies_callbacks = "direct registration"
        return api_route_response_model_dependencies_callbacks
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI add an API route with response model dependencies and callbacks?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "FastAPI.add_api_route",
      kind: "method",
      file: "pkg/applications.py"
    });
    expect(result.matches[0].why).toContain("route registration intent");
  });

  test("hybrid mode prefers response serialization over broad request handlers for response model queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-response-serialization-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "routing.py"),
      `async def serialize_response(field, response_content):
    validate_serialize_endpoint_return_values_response_model = response_content
    return validate_serialize_endpoint_return_values_response_model

def get_request_handler(route):
    validate_serialize_endpoint_return_values_response_model = route
    return serialize_response
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI validate and serialize endpoint return values into the response model?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "serialize_response",
      kind: "function",
      file: "pkg/routing.py"
    });
    expect(result.matches[0].why).toContain("response serialization intent");
  });

  test("hybrid mode prefers dependency graph builders over dependency parameter helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-dependency-builders-"));
    await mkdir(path.join(root, "pkg", "dependencies"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "dependencies", "utils.py"),
      `def get_dependant(path, call):
    endpoint_signatures_dependency_graph = call
    return endpoint_signatures_dependency_graph

def get_parameterless_sub_dependant(depends, path):
    endpoint_signatures_dependency_graph = get_dependant(path, depends)
    return endpoint_signatures_dependency_graph

def add_non_field_param_to_dependency(param, dependant):
    endpoint_signatures_dependency_graph = param
    return endpoint_signatures_dependency_graph
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does FastAPI inspect endpoint signatures and build the dependency graph?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(["get_dependant", "get_parameterless_sub_dependant"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].why).toContain("dependency graph intent match");
  });

  test("hybrid mode prefers model dump methods over computed-field decorators for serialization queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-model-dump-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "main.py"),
      `class BaseModel:
    def model_dump(self, include=None, exclude=None, by_alias=None, exclude_unset=False, exclude_defaults=False, exclude_none=False, exclude_computed_fields=False, round_trip=False):
        serialize_model_python_dict_include_exclude_aliases_unset_defaults_none_computed_fields_round_trip = self
        return serialize_model_python_dict_include_exclude_aliases_unset_defaults_none_computed_fields_round_trip
`
    );
    await writeFile(
      path.join(root, "pkg", "fields.py"),
      `def computed_field(func=None):
    serialize_computed_fields_property_cached_property_models_dataclasses = func
    return serialize_computed_fields_property_cached_property_models_dataclasses
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Pydantic serialize a model to a Python dict with include exclude aliases unset defaults none computed fields and round trip options?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "BaseModel.model_dump",
      kind: "method",
      file: "pkg/main.py"
    });
    expect(result.matches[0].why).toContain("model dump serialization intent");
  });

  test("hybrid mode prefers model completion orchestration over schema generation helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-model-completion-"));
    await mkdir(path.join(root, "pkg", "_internal"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "_internal", "_model_construction.py"),
      `def complete_model_class(cls, config_wrapper, ns_resolver):
    finish_building_model_class_generating_core_schema_validators_serializers_computed_fields = cls
    return finish_building_model_class_generating_core_schema_validators_serializers_computed_fields
`
    );
    await writeFile(
      path.join(root, "pkg", "_internal", "_generate_schema.py"),
      `class GenerateSchema:
    def _model_schema(self, cls):
        model_schema_validators_serializers_computed_fields = cls
        return model_schema_validators_serializers_computed_fields
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Pydantic finish building a model class by generating core schema validators serializers and computed fields?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "complete_model_class",
      kind: "function",
      file: "pkg/_internal/_model_construction.py"
    });
    expect(result.matches[0].why).toContain("model completion intent");
  });

  test("hybrid mode prefers core implementation symbols over nearby helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-core-symbols-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "extract.py"),
      `def extract_python(source):
    return source

def _extract_python_rationale(source):
    code_extraction_rationale = "why extraction works"
    return code_extraction_rationale
`
    );
    await writeFile(
      path.join(root, "pkg", "cluster.py"),
      `def cluster(graph):
    return _split_community(graph)

def _split_community(graph):
    community_detection_split = graph
    return community_detection_split
`
    );
    await indexTarget(root);

    await expectTopHybridSymbol(root, "where does code extraction happen?", "extract_python");
    await expectTopHybridSymbol(root, "where does community detection run?", "cluster");
  });

  test("hybrid mode treats stem-equivalent file names as core implementation symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-core-stems-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "shell_completion.py"),
      `"""Shell completion source and complete instruction helpers."""

def shell_complete(command, instruction):
    if instruction == "source":
        return "source script"
    if instruction == "complete":
        return "complete choices"
    return ""
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does shell completion decide between source and complete instructions?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "shell_complete",
      kind: "function",
      file: "pkg/shell_completion.py"
    });
    expect(result.matches[0].why).toContain("core symbol match");
  });

  test("hybrid mode prefers incremental change detection over watcher orchestration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-incremental-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "watch.py"),
      `def watch():
    incremental_indexing_decide_changed = "orchestrates incremental indexing when files changed"
    return incremental_indexing_decide_changed
`
    );
    await writeFile(
      path.join(root, "pkg", "detect.py"),
      `def detect_incremental(root):
    manifest = load_manifest(root)
    return manifest

def load_manifest(root):
    return {}

def save_manifest(files):
    return None
`
    );
    await indexTarget(root);

    await expectTopHybridSymbol(root, "where does incremental indexing decide what changed?", "detect_incremental");
  });

  test("symbol mode adds exact dotted API references as candidates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-dotted-api-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "api.py"),
      `def request(method, url):
    return send(method, url)

def get(url):
    return request("GET", url)
`
    );
    await writeFile(
      path.join(root, "pkg", "transport.py"),
      `class BaseTransport:
    def handle_request(self, request):
        request_metadata = "request handling"
        return request_metadata
`
    );
    await indexTarget(root);

    const result = await queryIndex("where is the module-level pkg.request convenience function defined?", {
      target: root,
      limit: 5,
      mode: "symbol"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "request",
      kind: "function",
      file: "pkg/api.py"
    });
    expect(result.matches[0].why).toContain("dotted API reference match");
  });

  test("hybrid mode treats lowercase dotted module paths as modules, not member references", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-dotted-module-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "markup.py"),
      `class Tag:
    @property
    def markup(self):
        return "[tag]"

def _parse(markup):
    parsed_tags = markup
    return parsed_tags

def render(markup):
    text = []
    for tag in _parse(markup):
        text.append(tag)
    return text
`
    );
    await writeFile(
      path.join(root, "pkg", "text.py"),
      `class Text:
    @property
    def markup(self):
        markup_from_spans = "serialized"
        return markup_from_spans
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does pkg.markup parse markup tags into text?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "_parse",
      kind: "function",
      file: "pkg/markup.py"
    });
    expect(result.matches.find((match) => match.symbol === "Tag.markup")?.why).not.toContain(
      "dotted API reference match"
    );
    expect(result.matches.find((match) => match.symbol === "Text.markup")?.why).not.toContain(
      "dotted API reference match"
    );
  });

  test("hybrid mode prefers parser functions over inverse markup properties for parse questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-parser-actions-"));
    await mkdir(path.join(root, "rich"), { recursive: true });
    await writeFile(
      path.join(root, "rich", "markup.py"),
      `class Tag:
    @property
    def markup(self):
        return "[tag]"

def _parse(markup):
    parsed_tags = markup
    return parsed_tags

def render(markup):
    text = []
    for tag in _parse(markup):
        text.append(tag)
    return text
`
    );
    await writeFile(
      path.join(root, "rich", "text.py"),
      `class Text:
    @property
    def markup(self):
        markup_from_spans = "serialized"
        return markup_from_spans
`
    );
    await indexTarget(root);

    const result = await queryIndex("where is Rich markup parsed into tags and converted to text?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "_parse",
      kind: "function",
      file: "rich/markup.py"
    });
    expect(result.matches[0].why).toContain("parser action match");
  });

  test("hybrid mode prefers exact public method names over longer helper methods", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-exact-method-name-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "base.py"),
      `class BaseEstimator:
    def _get_param_names(self):
        parameter_names_constructor_signature = "collect parameter names"
        return sorted(parameter_names_constructor_signature)

    def get_params(self, deep=True):
        """Get parameters for this estimator and nested estimator objects."""
        params = {}
        for key in self._get_param_names():
            params[key] = getattr(self, key)
        return params
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does BaseEstimator collect parameter names and nested estimator parameters for get_params?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "BaseEstimator.get_params",
      kind: "method",
      file: "pkg/base.py"
    });
    expect(result.matches[0].why).toContain("exact symbol name match");
  });

  test("hybrid mode prefers explicitly named public methods over longer helper methods with the same verb", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-public-method-helper-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "base.py"),
      `class Model:
    def save(self, force_insert=False, force_update=False, using=None, update_fields=None):
        """Public model save API; prepare related fields and then save the model."""
        self._prepare_related_fields_for_save(operation_name="save")
        return self.save_base(using=using, force_insert=force_insert, force_update=force_update, update_fields=update_fields)

    def save_base(self, using=None, force_insert=False, force_update=False, update_fields=None):
        """Low-level save implementation that writes parents, tables, transactions, and database routing."""
        database_routing_force_insert_force_update_update_fields = using
        return database_routing_force_insert_force_update_update_fields
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: ["Model.save", "save", "force_insert", "force_update", "update_fields", "database", "routing"],
        symbolKinds: ["method"],
        pathHints: ["pkg/base.py"],
        excludeSupportCode: true,
        expand: ["callees", "parents"]
      },
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Model.save",
      kind: "method",
      file: "pkg/base.py"
    });
  });

  test("hybrid mode prefers explicitly named orchestration methods over named component helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-orchestration-method-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "base.py"),
      `class Model:
    def validate_unique(self, exclude=None):
        """Validate unique constraints."""
        unique_constraints = exclude
        return unique_constraints

    def validate_constraints(self, exclude=None):
        """Validate model constraints."""
        model_constraints = exclude
        return model_constraints

    def clean_fields(self, exclude=None):
        """Clean model fields."""
        cleaned_fields = exclude
        return cleaned_fields

    def full_clean(self, exclude=None, validate_unique=True, validate_constraints=True):
        """Run full model cleaning by cleaning fields, validating unique checks, and validating constraints."""
        self.clean_fields(exclude=exclude)
        if validate_unique:
            self.validate_unique(exclude=exclude)
        if validate_constraints:
            self.validate_constraints(exclude=exclude)
`
    );
    await indexTarget(root);

    const result = await queryAgentIndex(
      {
        terms: [
          "Model.full_clean",
          "full_clean",
          "clean_fields",
          "validate_unique",
          "validate_constraints",
          "model",
          "constraints"
        ],
        symbolKinds: ["method"],
        pathHints: ["pkg/base.py"],
        excludeSupportCode: true,
        expand: ["callees", "parents"]
      },
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Model.full_clean",
      kind: "method",
      file: "pkg/base.py"
    });
  });

  test("hybrid mode adds owner-method candidates when FTS is full of topical distractors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-owner-method-intent-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    const distractors = Array.from(
      { length: 30 },
      (_, index) => `def check_estimator_${index}(estimator):
    nested_estimator_parameters_double_underscore_names = estimator
    return nested_estimator_parameters_double_underscore_names
`
    ).join("\n");
    await writeFile(path.join(root, "pkg", "checks.py"), distractors);
    await writeFile(
      path.join(root, "pkg", "base.py"),
      `class BaseEstimator:
    def set_params(self, **params):
        return self
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does BaseEstimator set nested estimator parameters using double underscore names?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "BaseEstimator.set_params",
      kind: "method",
      file: "pkg/base.py"
    });
    expect(result.matches[0].why).toContain("owner method intent");
  });

  test("hybrid mode prefers compound methods when the query joins method tokens with and", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-compound-method-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "compose.py"),
      `class ColumnTransformer:
    def transform(self, X):
        selected_columns_transformers_concatenate_transformer_outputs = X
        return selected_columns_transformers_concatenate_transformer_outputs

    def _update_fitted_transformers(self):
        fitted_transformers_selected_columns_transformer_outputs = []
        return fitted_transformers_selected_columns_transformer_outputs

    def fit_transform(self, X, y=None):
        """Fit all transformers, transform selected columns, and concatenate outputs."""
        return self.transform(X)
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does ColumnTransformer fit and transform selected columns then concatenate transformer outputs?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "ColumnTransformer.fit_transform",
      kind: "method",
      file: "pkg/compose.py"
    });
    expect(result.matches[0].why).toContain("exact symbol name match");
  });

  test("hybrid mode does not treat transformer nouns as transform method requests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-transformer-noun-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "pipeline.py"),
      `class Pipeline:
    def fit_transform(self, X, y=None):
        """Fit transformer step final estimator metadata and transform samples."""
        transformer_step_final_estimator = X
        return transformer_step_final_estimator

    def fit(self, X, y=None):
        """Fit each transformer step and then fit the final estimator."""
        return self
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Pipeline fit each transformer step and then fit the final estimator?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Pipeline.fit",
      kind: "method",
      file: "pkg/pipeline.py"
    });
    expect(result.matches.find((match) => match.symbol === "Pipeline.fit_transform")?.why).not.toContain(
      "exact symbol name match"
    );
  });

  test("hybrid mode does not treat constructor parameter questions as factory construction", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-constructor-params-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "base.py"),
      `class BaseEstimator:
    def get_params(self, deep=True):
        """Get constructor parameters for cloning and grid search."""
        constructor_parameters_cloning_grid_search = {}
        return constructor_parameters_cloning_grid_search
`
    );
    await writeFile(
      path.join(root, "pkg", "factory.py"),
      `def get(url):
    constructor_factory_create_build_parameters = url
    return constructor_factory_create_build_parameters
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does BaseEstimator get constructor parameters for cloning and grid search?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "BaseEstimator.get_params",
      kind: "method",
      file: "pkg/base.py"
    });
    expect(result.matches.find((match) => match.symbol === "get")?.why).not.toContain("factory constructor intent");
  });

  test("hybrid mode prefers cross_val_score for cross validation score queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-cross-val-score-"));
    await mkdir(path.join(root, "pkg", "model_selection"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "model_selection", "_validation.py"),
      `def cross_validate(estimator, X, y):
    cross_validation_estimator_splits_scoring_scores = estimator
    return cross_validation_estimator_splits_scoring_scores

def cross_val_score(estimator, X, y):
    score_by_cross_validation_estimator_splits_scoring = estimator
    return score_by_cross_validation_estimator_splits_scoring
`
    );
    await writeFile(
      path.join(root, "pkg", "model_selection", "_plot.py"),
      `class ValidationCurveDisplay:
    def from_estimator(self, estimator):
        evaluate_score_cross_validation_estimator_splits_scoring = estimator
        return evaluate_score_cross_validation_estimator_splits_scoring
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does scikit-learn evaluate a score by cross validation over estimator splits and scoring?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "cross_val_score",
      kind: "function",
      file: "pkg/model_selection/_validation.py"
    });
    expect(result.matches[0].why).toContain("cross validation score intent");
  });

  test("hybrid mode prefers kneighbors over radius neighbors when nearest neighbors are requested", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-nearest-neighbors-"));
    await mkdir(path.join(root, "pkg", "neighbors"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "neighbors", "_base.py"),
      `class RadiusNeighborsMixin:
    def radius_neighbors(self, X=None):
        nearest_neighbors_distances_indices_radius = X
        return nearest_neighbors_distances_indices_radius

class KNeighborsMixin:
    def kneighbors(self, X=None):
        nearest_neighbors_distances_indices = X
        return nearest_neighbors_distances_indices
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does scikit-learn find k nearest neighbors and optionally return distances using the fitted neighbor search structure?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "KNeighborsMixin.kneighbors",
      kind: "method",
      file: "pkg/neighbors/_base.py"
    });
    expect(result.matches[0].why).toContain("nearest neighbors intent");
  });

  test("hybrid mode prefers check_array for low-level input array validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-check-array-"));
    await mkdir(path.join(root, "pkg", "utils"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "utils", "validation.py"),
      `def check_array(array):
    dtype_shape_sparsity_finite_values_minimum_samples_features = array
    return dtype_shape_sparsity_finite_values_minimum_samples_features

def check_is_fitted(estimator):
    validate_input_arrays_dtype_shape_sparsity_finite_values = estimator
    return validate_input_arrays_dtype_shape_sparsity_finite_values
`
    );
    await writeFile(
      path.join(root, "pkg", "preprocessing.py"),
      `class StandardScaler:
    def fit(self, X):
        validate_input_arrays_dtype_shape_sparsity_finite_values = X
        return self
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does scikit-learn validate input arrays for dtype shape sparsity finite values and minimum samples or features?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "check_array",
      kind: "function",
      file: "pkg/utils/validation.py"
    });
    expect(result.matches[0].why).toContain("input array validation intent");
  });

  test("hybrid mode prefers forest fit methods over forest class containers for fitting behavior", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-forest-fit-"));
    await mkdir(path.join(root, "pkg", "ensemble"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "ensemble", "_forest.py"),
      `class RandomForestClassifier:
    """Random forest fitting builds decision trees with bootstrap samples and out of bag scoring."""

class RandomForestRegressor:
    """Random forest fitting builds decision trees with bootstrap samples and out of bag scoring."""

class BaseForest:
    def fit(self, X, y):
        """Build a forest of trees from bootstrap samples with out of bag scoring."""
        return self
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does scikit-learn random forest fitting build decision trees in parallel with bootstrap samples and out of bag scoring?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "BaseForest.fit",
      kind: "method",
      file: "pkg/ensemble/_forest.py"
    });
    expect(result.matches[0].why).toContain("forest fit intent");
  });

  test("hybrid mode prefers pipeline predict when final estimator prediction is requested", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-pipeline-predict-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "pipeline.py"),
      `class Pipeline:
    def transform(self, X):
        transform_data_each_step_final_estimator = X
        return transform_data_each_step_final_estimator

    def fit_transform(self, X, y=None):
        transform_data_each_step_final_estimator = X
        return transform_data_each_step_final_estimator

    def predict(self, X):
        """Transform data through each step and call predict on the final estimator."""
        return self.steps[-1].predict(X)
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Pipeline transform data through each step and then call predict on the final estimator?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Pipeline.predict",
      kind: "method",
      file: "pkg/pipeline.py"
    });
    expect(result.matches[0].why).toContain("pipeline final estimator predict intent");
  });

  test("hybrid mode prefers GridSearchCV run search over halving search containers for param_grid enumeration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-grid-search-run-"));
    await mkdir(path.join(root, "pkg", "model_selection"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "model_selection", "_search_successive_halving.py"),
      `class HalvingGridSearchCV:
    """Successive halving grid search evaluates parameter candidates from param_grid."""
`
    );
    await writeFile(
      path.join(root, "pkg", "model_selection", "_search.py"),
      `class GridSearchCV:
    def _run_search(self, evaluate_candidates):
        """Search all candidates in param_grid."""
        candidate_params = ParameterGrid(self.param_grid)
        return evaluate_candidates(candidate_params)
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does GridSearchCV enumerate every parameter combination from param_grid before evaluating candidates?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "GridSearchCV._run_search",
      kind: "method",
      file: "pkg/model_selection/_search.py"
    });
    expect(result.matches[0].why).toContain("grid search run intent");
  });

  test("hybrid mode prefers kneighbors graph builders when graph output is requested", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-kneighbors-graph-"));
    await mkdir(path.join(root, "pkg", "neighbors"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "neighbors", "_base.py"),
      `class KNeighborsMixin:
    def kneighbors(self, X=None):
        k_nearest_neighbors_distance_connectivity_graph = X
        return k_nearest_neighbors_distance_connectivity_graph

    def kneighbors_graph(self, X=None):
        """Compute the connectivity or distance graph of k nearest neighbors."""
        return X
`
    );
    await writeFile(
      path.join(root, "pkg", "neighbors", "_graph.py"),
      `def kneighbors_graph(X, n_neighbors):
    """Build a connectivity or distance graph for k nearest neighbors."""
    return X
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does scikit-learn build a connectivity or distance graph for k nearest neighbors?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(["kneighbors_graph", "KNeighborsMixin.kneighbors_graph"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].why).toContain("nearest neighbors graph intent");
  });

  test("hybrid mode prefers check_X_y for paired X y validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-check-x-y-"));
    await mkdir(path.join(root, "pkg", "utils"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "utils", "validation.py"),
      `def check_array(X):
    finite_values_multi_output_targets = X
    return finite_values_multi_output_targets

def check_X_y(X, y):
    """Validate X and y together for consistent length and multi-output targets."""
    check_consistent_length(X, y)
    return X, y
`
    );
    await writeFile(
      path.join(root, "pkg", "preprocessing.py"),
      `class TargetEncoder:
    """Validate X and y together with finite values and target output metadata."""
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does scikit-learn validate X and y together for consistent length multi-output targets and finite values?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "check_X_y",
      kind: "function",
      file: "pkg/utils/validation.py"
    });
    expect(result.matches[0].why).toContain("paired input validation intent");
  });

  test("hybrid mode prefers validate_data for estimator feature-name validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-validate-data-"));
    await mkdir(path.join(root, "pkg", "utils"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "utils", "validation.py"),
      `def validate_data(estimator, X, y=None):
    """Validate estimator input data and set or check feature names and n_features_in."""
    return check_array(X)

def check_array(X):
    feature_names_input_data = X
    return feature_names_input_data
`
    );
    await writeFile(
      path.join(root, "pkg", "checks.py"),
      `def check_dataframe_column_names_consistency(estimator):
    validate_estimator_input_data_feature_names_n_features_in = estimator
    return validate_estimator_input_data_feature_names_n_features_in
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does scikit-learn validate estimator input data while setting or checking feature names and n_features_in?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "validate_data",
      kind: "function",
      file: "pkg/utils/validation.py"
    });
    expect(result.matches[0].why).toContain("estimator data validation intent");
  });

  test("hybrid mode prefers solver orchestration over provider helper methods for dependency solve queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-solver-orchestration-"));
    await mkdir(path.join(root, "pkg", "puzzle"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "puzzle", "solver.py"),
      `class Solver:
    def solve(self, use_latest=None):
        with self._progress(), self._provider.use_latest_for(use_latest or []):
            packages = self._solve()
            for marker in packages:
                simplify_marker(marker)
        return Transaction(packages)
`
    );
    await writeFile(
      path.join(root, "pkg", "puzzle", "provider.py"),
      `class Provider:
    def _get_dependencies_with_overrides(self, dependency):
        provider_override_marker_simplification_notes = dependency
        return provider_override_marker_simplification_notes

    def _merge_dependencies_by_constraint(self, dependencies):
        provider_marker_override_dependencies = dependencies
        return provider_marker_override_dependencies
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Poetry solve dependencies using provider progress use_latest overrides marker simplification and return a transaction?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Solver.solve",
      kind: "method",
      file: "pkg/puzzle/solver.py"
    });
    expect(result.matches[0].why).toContain("dependency solver intent");
  });

  test("hybrid mode prefers application main over run-command helpers for CLI entrypoint queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-application-main-"));
    await mkdir(path.join(root, "pkg", "console", "commands"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "console", "application.py"),
      `class Application:
    def run(self):
        return 0

def main():
    exit_code = Application().run()
    return exit_code
`
    );
    await writeFile(
      path.join(root, "pkg", "console", "commands", "run.py"),
      `class RunCommand:
    def run_script(self):
        command_line_application_run_script_helper = "run command"
        return command_line_application_run_script_helper
`
    );
    await indexTarget(root);

    const result = await queryIndex("where is Poetry's command line application entry point that creates the console application and runs it?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "main",
      kind: "function",
      file: "pkg/console/application.py"
    });
    expect(result.matches[0].why).toContain("entrypoint intent match");
  });

  test("hybrid mode prefers install command handler over command containers for installer option application", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-installer-options-"));
    await mkdir(path.join(root, "pkg", "console", "commands"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "console", "commands", "install.py"),
      `class InstallCommand:
    options = ["sync", "dry-run", "extras", "all-groups"]

    def activated_groups(self):
        return {"main"}

    def _with_synchronization(self):
        return self.option("sync")

    def handle(self):
        extras = []
        for extra in self.option("extras", []):
            extras += extra.split()
        self.installer.extras(extras)
        self.installer.only_groups(self.activated_groups())
        self.installer.dry_run(self.option("dry-run"))
        self.installer.requires_synchronization(self._with_synchronization())
        return self.installer.run()
`
    );
    await writeFile(
      path.join(root, "pkg", "console", "commands", "group_command.py"),
      `class GroupCommand:
    def activated_groups(self):
        groups_from_options = {"main"}
        return groups_from_options
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does the install command apply dry run extras groups sync options to the installer?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "InstallCommand.handle",
      kind: "method",
      file: "pkg/console/commands/install.py"
    });
    expect(result.matches[0].why).toContain("installer option application intent");
  });

  test("hybrid mode prefers plugin manager activate over plugin loading helpers for activation queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-plugin-activation-"));
    await mkdir(path.join(root, "pkg", "plugins"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "plugins", "plugin_manager.py"),
      `class PluginManager:
    def load_plugins(self):
        plugin_entrypoints = self.get_plugin_entry_points()
        for ep in plugin_entrypoints:
            self._load_plugin_entry_point(ep)

    def activate(self, poetry, io):
        for plugin in self._plugins:
            plugin.activate(poetry, io)

    def _load_plugin_entry_point(self, ep):
        plugin = ep.load()
        self._plugins.append(plugin)
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Poetry plugin manager activate loaded plugins by calling plugin activate with poetry and io arguments?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "PluginManager.activate",
      kind: "method",
      file: "pkg/plugins/plugin_manager.py"
    });
    expect(result.matches[0].why).toContain("plugin activation intent");
  });

  test("hybrid mode prefers exact execute methods over execution option helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-execute-action-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await mkdir(path.join(root, "pkg", "sql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "base.py"),
      `class Connection:
    def execution_options(self, **options):
        """Configure execution options for SQL statements and executable objects."""
        statement_parameters_execution_options = options
        return statement_parameters_execution_options

    def execute(self, statement, parameters=None, execution_options=None):
        """Execute a SQL statement or executable object with parameters."""
        return statement, parameters, execution_options
`
    );
    await writeFile(
      path.join(root, "pkg", "sql", "base.py"),
      `class Executable:
    def execution_options(self, **options):
        """Set execution options for executable SQL statement objects."""
        return options
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Connection execute a SQL statement with parameters and execution options?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Connection.execute",
      kind: "method",
      file: "pkg/engine/base.py"
    });
    expect(result.matches[0].why).toContain("execution action intent");
  });

  test("hybrid mode does not infer owner method intent from scattered option words", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-owner-option-words-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await mkdir(path.join(root, "pkg", "sql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "create.py"),
      `def create_engine(url, **kwargs):
    """Create an Engine from a URL while configuring dialect pool plugins kwargs and connection arguments."""
    return url, kwargs
`
    );
    await writeFile(
      path.join(root, "pkg", "sql", "base.py"),
      `class DialectKWArgs:
    def dialect_kwargs(self):
        """Return dialect kwargs for options."""
        return {}
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy create an Engine from a URL while configuring dialect pool plugins kwargs and connection arguments?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "create_engine",
      kind: "function",
      file: "pkg/engine/create.py"
    });
    expect(result.matches.find((match) => match.symbol === "DialectKWArgs.dialect_kwargs")?.why).not.toContain(
      "owner method intent"
    );
  });

  test("hybrid mode keeps execution action ranking scoped to sync versus async sessions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-sync-async-execute-"));
    await mkdir(path.join(root, "pkg", "orm"), { recursive: true });
    await mkdir(path.join(root, "pkg", "ext", "asyncio"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "orm", "session.py"),
      `class Session:
    def execute(self, statement, params=None, execution_options=None):
        """Execute ORM statements with bind arguments and execution options."""
        return statement, params, execution_options
`
    );
    await writeFile(
      path.join(root, "pkg", "ext", "asyncio", "session.py"),
      `class AsyncSession:
    async def execute(self, statement, params=None, execution_options=None):
        """AsyncSession execute ORM statements by delegating through greenlet_spawn."""
        return statement, params, execution_options
`
    );
    await indexTarget(root);

    const syncResult = await queryIndex("where does SQLAlchemy Session execute ORM statements with bind arguments and execution options?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });
    const asyncResult = await queryIndex("where does SQLAlchemy AsyncSession execute an ORM statement by delegating through greenlet_spawn?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(syncResult.matches[0]).toMatchObject({
      symbol: "Session.execute",
      kind: "method",
      file: "pkg/orm/session.py"
    });
    expect(asyncResult.matches[0]).toMatchObject({
      symbol: "AsyncSession.execute",
      kind: "method",
      file: "pkg/ext/asyncio/session.py"
    });
  });

  test("hybrid mode matches sync abbreviations to synchronous callable wording", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-sync-alias-"));
    await mkdir(path.join(root, "pkg", "ext", "asyncio"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "ext", "asyncio", "engine.py"),
      `class AsyncConnection:
    def _proxied(self):
        """Return the proxied synchronous Connection."""
        return None

    def run_sync(self, fn):
        """Run a synchronous callable against the proxied Connection inside greenlet_spawn."""
        return greenlet_spawn(fn)
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy AsyncConnection run a synchronous callable against the proxied Connection inside greenlet_spawn?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "AsyncConnection.run_sync",
      kind: "method",
      file: "pkg/ext/asyncio/engine.py"
    });
    expect(result.matches[0].why).toContain("owner method intent");
  });

  test("hybrid mode prefers public inspection APIs over registration helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-public-inspection-"));
    await mkdir(path.join(root, "pkg", "sql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "inspection.py"),
      `def inspect(subject):
    """Inspect an object by dispatching to registered inspection functions and returning an inspector."""
    return subject
`
    );
    await writeFile(
      path.join(root, "pkg", "sql", "functions.py"),
      `def register_function(identifier, fn):
    """Register SQL functions by identifier."""
    return fn
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy inspect an object by dispatching to registered inspection functions and returning an inspector?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "inspect",
      kind: "function",
      file: "pkg/inspection.py"
    });
    expect(result.matches[0].why).toContain("public API action intent");
  });

  test("hybrid mode prefers public listener registration APIs over option-word owner matches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-public-listener-"));
    await mkdir(path.join(root, "pkg", "event"), { recursive: true });
    await mkdir(path.join(root, "pkg", "dialects", "mysql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "event", "api.py"),
      `def listen(target, identifier, fn, propagate=False, insert=False, named=False, once=False, retval=False):
    """Register an event listener for a target identifier function with propagate insert named once and retval options."""
    return target, identifier, fn
`
    );
    await writeFile(
      path.join(root, "pkg", "dialects", "mysql", "dml.py"),
      `class Insert:
    def inserted(self):
        """Access inserted values for MySQL INSERT statements."""
        return {}
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy register an event listener for a target identifier function with propagate insert named once and retval options?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "listen",
      kind: "function",
      file: "pkg/event/api.py"
    });
    expect(result.matches[0].why).toContain("public API action intent");
  });

  test("hybrid mode matches template-method actions on explicitly named compound owners", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-template-owner-"));
    await mkdir(path.join(root, "pkg", "pool"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "pool", "base.py"),
      `class Pool:
    def _create_connection(self):
        """Create a pooled connection for a pool."""
        return None
`
    );
    await writeFile(
      path.join(root, "pkg", "pool", "impl.py"),
      `class QueuePool:
    def _do_get(self):
        """Get or create a pooled connection while handling overflow limits wait timeouts and checked out counts."""
        return self._create_connection()

    def overflow(self):
        """Return overflow counts for this QueuePool."""
        return 0
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy QueuePool get or create a pooled connection while handling overflow limits wait timeouts and checked out counts?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "QueuePool._do_get",
      kind: "method",
      file: "pkg/pool/impl.py"
    });
    expect(result.matches[0].why).toContain("owner method intent");
  });

  test("hybrid mode prefers bind resolution methods over bind registration helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-bind-resolution-"));
    await mkdir(path.join(root, "pkg", "orm"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "orm", "session.py"),
      `class Session:
    def bind_mapper(self, mapper, bind):
        """Associate a mapper with a bind."""
        return mapper, bind

    def get_bind(self, mapper=None, clause=None, bind=None):
        """Resolve the Engine or Connection bind using mapper clause binds metadata and fallback rules."""
        return bind
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy Session resolve the Engine or Connection bind using mapper clause binds metadata and fallback rules?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Session.get_bind",
      kind: "method",
      file: "pkg/orm/session.py"
    });
    expect(result.matches[0].why).toContain("bind resolution intent");
  });

  test("hybrid mode prefers explicitly named loader option builders over generic options helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-loader-option-"));
    await mkdir(path.join(root, "pkg", "orm"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "orm", "strategy_options.py"),
      `class Load:
    def options(self, *opts):
        """Apply loader options for eager loading relationships."""
        return opts

class _AbstractLoad:
    def joinedload(self, attr, innerjoin=None):
        """Build the joinedload loader option for eager loading relationships using a SQL join."""
        return attr, innerjoin
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy build the joinedload loader option for eager loading relationships using a SQL join?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "_AbstractLoad.joinedload",
      kind: "method",
      file: "pkg/orm/strategy_options.py"
    });
    expect(result.matches[0].why).toContain("loader option intent");
  });

  test("hybrid mode prefers transaction begin methods over returned transaction lifecycle helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-transaction-begin-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "base.py"),
      `class Connection:
    def begin(self):
        """Begin a transaction and return a RootTransaction for commit or rollback."""
        return RootTransaction()

class RootTransaction:
    def _do_commit(self):
        """Commit the root transaction."""
        return None

    def _do_rollback(self):
        """Rollback the root transaction."""
        return None
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy Connection begin a transaction and return a RootTransaction for commit or rollback?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Connection.begin",
      kind: "method",
      file: "pkg/engine/base.py"
    });
    expect(result.matches[0].why).toContain("transaction begin intent");
  });

  test("hybrid mode prefers declarative base factory methods over declarative base classes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-declarative-factory-"));
    await mkdir(path.join(root, "pkg", "orm"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "orm", "decl_api.py"),
      `class DeclarativeBase:
    """Declarative base class with metadata and registry options."""

class registry:
    def generate_base(self, metadata=None, constructor=None):
        """Generate a declarative base class from this registry with metadata and constructor."""
        return DeclarativeBase

def declarative_base(metadata=None, constructor=None):
    """Create a declarative base class from a registry with metadata and constructor."""
    return registry().generate_base(metadata=metadata, constructor=constructor)
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy create a declarative base class from a registry with metadata and constructor options?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(["declarative_base", "registry.generate_base"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].why).toContain("declarative factory intent");
  });

  test("hybrid mode prefers mapped_column factory over declarative mapper internals", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-mapped-column-"));
    await mkdir(path.join(root, "pkg", "orm"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "orm", "_orm_constructors.py"),
      `def mapped_column(type_=None, **kw):
    """Build a mapped_column for declarative ORM attributes with type annotations and column options."""
    return type_, kw
`
    );
    await writeFile(
      path.join(root, "pkg", "orm", "decl_base.py"),
      `class _DeclarativeMapperConfig:
    def _extract_mappable_attributes(self):
        """Extract mappable declarative attributes with type annotations and column options."""
        return []
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy build a mapped_column for declarative ORM attributes with type annotations and column options?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "mapped_column",
      kind: "function",
      file: "pkg/orm/_orm_constructors.py"
    });
    expect(result.matches[0].why).toContain("factory constructor intent");
  });

  test("hybrid mode prefers public relationship factory over RelationshipProperty constructor internals", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-relationship-constructor-"));
    await mkdir(path.join(root, "pkg", "orm"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "orm", "_orm_constructors.py"),
      `def relationship(argument=None, secondary=None, back_populates=None, cascade=None, lazy="select", **kw):
    """Define the relationship constructor for ORM attributes with secondary joins back_populates cascade and loader options."""
    return RelationshipProperty(argument, secondary=secondary, back_populates=back_populates, cascade=cascade, lazy=lazy, **kw)
`
    );
    await writeFile(
      path.join(root, "pkg", "orm", "relationships.py"),
      `class RelationshipProperty:
    def __init__(self, argument=None, secondary=None, back_populates=None, cascade=None, lazy="select", **kw):
        """Initialize an ORM relationship property with secondary joins back_populates cascade and loader options."""
        self.argument = argument
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy define the relationship constructor for ORM attributes with secondary joins back_populates cascade and loader options?",
      { target: root, limit: 5, mode: "hybrid" }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "relationship",
      kind: "function",
      file: "pkg/orm/_orm_constructors.py"
    });
    expect(result.matches[0].why).toContain("factory constructor intent");
  });

  test("hybrid mode prefers select constructor functions over Select instance methods", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-select-constructor-"));
    await mkdir(path.join(root, "pkg", "sql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "sql", "_selectable_constructors.py"),
      `def select(*entities):
    """Construct a Select statement from columns entities or ORM classes."""
    return Select(*entities)
`
    );
    await writeFile(
      path.join(root, "pkg", "sql", "selectable.py"),
      `class Select:
    def from_statement(self, statement):
        """Create a Select from another statement object."""
        return statement

    def selected_columns(self):
        """Return selected columns from this Select statement."""
        return []
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy construct a Select statement from columns entities or ORM classes?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "select",
      kind: "function",
      file: "pkg/sql/_selectable_constructors.py"
    });
    expect(result.matches[0].why).toContain("factory constructor intent");
  });

  test("hybrid mode collapses duplicate overload results for the same symbol", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-overload-dedupe-"));
    await mkdir(path.join(root, "pkg", "sql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "sql", "_selectable_constructors.py"),
      `def select(entity):
    ...

def select(entity, second):
    ...

def select(*entities):
    """Construct a Select statement from columns entities or ORM classes."""
    return Select(*entities)
`
    );
    await writeFile(
      path.join(root, "pkg", "sql", "selectable.py"),
      `class Select:
    def selected_columns(self):
        """Return selected columns from this Select statement."""
        return []
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy construct a Select statement from columns entities or ORM classes?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });
    const keys = result.matches.map((match) => `${match.file}:${match.symbol}`);

    expect(result.matches[0]).toMatchObject({
      symbol: "select",
      kind: "function",
      file: "pkg/sql/_selectable_constructors.py"
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("hybrid mode does not confuse bind parameter literal_execute wording with statement execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-bindparam-literal-execute-"));
    await mkdir(path.join(root, "pkg", "sql"), { recursive: true });
    await mkdir(path.join(root, "pkg", "orm"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "sql", "_elements_constructors.py"),
      `def bindparam(key, value=None, type_=None, callable_=None, expanding=False, literal_execute=False):
    """Create a bind parameter expression object with key value type callable expanding and literal_execute options."""
    return BindParameter(key, value, type_, callable_, expanding, literal_execute)

class BindParameter:
    def _with_value(self, value):
        """Return a copy with a new value for literal_execute or expanding parameters."""
        return self
`
    );
    await writeFile(
      path.join(root, "pkg", "orm", "session.py"),
      `class Session:
    def execute(self, statement, parameters=None, execution_options=None):
        """Execute SQL statements with parameters and execution options."""
        return statement, parameters, execution_options
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy create a bind parameter expression object with key value type callable expanding and literal_execute options?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "bindparam",
      kind: "function",
      file: "pkg/sql/_elements_constructors.py"
    });
    expect(result.matches[0].why).toContain("bind parameter intent");
  });

  test("hybrid mode prefers bind parameter compiler visitors over execute methods for placeholder rendering", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-bindparam-compiler-"));
    await mkdir(path.join(root, "pkg", "sql"), { recursive: true });
    await mkdir(path.join(root, "pkg", "orm"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "sql", "compiler.py"),
      `class SQLCompiler:
    def visit_bindparam(self, bindparam, literal_execute=False, expanding=False):
        """Render bind parameters into compiled SQL placeholders and track literal execute or expanding parameters."""
        return bindparam, literal_execute, expanding

    def visit_override_binds(self, parameter):
        """Override bind values while visiting compiled SQL parameters."""
        return parameter
`
    );
    await writeFile(
      path.join(root, "pkg", "orm", "session.py"),
      `class Session:
    def execute(self, statement, parameters=None, execution_options=None):
        """Execute SQL statements with parameters and execution options."""
        return statement, parameters, execution_options
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy SQLCompiler render bind parameters into compiled SQL placeholders and track literal execute or expanding parameters?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "SQLCompiler.visit_bindparam",
      kind: "method",
      file: "pkg/sql/compiler.py"
    });
    expect(result.matches[0].why).toContain("bind parameter intent");
    expect(result.matches.find((match) => match.symbol === "SQLCompiler.visit_override_binds")?.why).not.toContain(
      "compiler visitor intent"
    );
  });

  test("hybrid mode prefers compiler visitor methods for render node questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-compiler-visitor-"));
    await mkdir(path.join(root, "pkg", "sql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "sql", "compiler.py"),
      `class SQLCompiler:
    def visit_select(self, select_stmt, **kwargs):
        """Render a Select statement with columns FROM clauses criteria grouping ordering and limits."""
        return select_stmt
`
    );
    await writeFile(
      path.join(root, "pkg", "sql", "selectable.py"),
      `class Select:
    def select_from(self, *froms):
        """Return a new Select with columns FROM clauses criteria grouping ordering and limits."""
        return self
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy SQLCompiler render a Select statement with columns FROM clauses criteria grouping ordering and limits?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "SQLCompiler.visit_select",
      kind: "method",
      file: "pkg/sql/compiler.py"
    });
    expect(result.matches[0].why).toContain("compiler visitor intent");
  });

  test("hybrid mode does not treat compile object questions as compiler visitor questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-compile-method-"));
    await mkdir(path.join(root, "pkg", "sql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "sql", "elements.py"),
      `class CompilerElement:
    def compile(self, bind=None, dialect=None, **kw):
        """Compile a SQL expression element into a Compiled object using a bind dialect and compile kwargs."""
        return bind, dialect, kw
`
    );
    await writeFile(
      path.join(root, "pkg", "sql", "compiler.py"),
      `class SQLCompiler:
    def visit_expression_clauselist(self, element):
        """Visit a SQL expression element while compiling clauses."""
        return element
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does SQLAlchemy compile a SQL expression element into a Compiled object using a bind dialect and compile kwargs?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "CompilerElement.compile",
      kind: "method",
      file: "pkg/sql/elements.py"
    });
    expect(result.matches.find((match) => match.symbol === "SQLCompiler.visit_expression_clauselist")?.why).not.toContain(
      "compiler visitor intent"
    );
  });

  test("hybrid mode prefers URL parse helpers over URL rendering for database URL strings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-url-parse-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "url.py"),
      `class URL:
    def render_as_string(self):
        """Render URL as a string."""
        return "driver://host/db"

    @classmethod
    def create(cls, drivername, username=None, password=None, host=None, port=None, database=None, query=None):
        """Create URL fields from drivername username password host port database and query."""
        return cls()

def make_url(name_or_url):
    """Parse a database URL string into a URL object."""
    return _parse_url(name_or_url)

def _parse_url(name):
    """Parse drivername username password host port database and query fields from a URL string."""
    return URL.create("driver")
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy parse a database URL string into drivername username password host port database and query fields?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(["make_url", "_parse_url", "URL.create"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].why).toContain("url parse intent");
  });

  test("hybrid mode prefers scalar_one over scalar_one_or_none when the query says exactly one", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-scalar-one-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "result.py"),
      `class Result:
    def scalar_one_or_none(self):
        """Return one scalar value or None when there is no row."""
        return None

    def scalar_one(self):
        """Return exactly one scalar value and raise when there is no row or more than one row."""
        return self._only_one_row()
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy Result return exactly one scalar value and raise when there is no row or more than one row?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Result.scalar_one",
      kind: "method",
      file: "pkg/engine/result.py"
    });
    expect(result.matches[0].why).toContain("exact scalar result intent");
  });

  test("hybrid mode prefers engine disposal methods over disposal event hooks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-engine-dispose-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "base.py"),
      `class Engine:
    def dispose(self, close=True):
        """Dispose the connection pool and optionally close checked-in connections."""
        self.pool.dispose()
`
    );
    await writeFile(
      path.join(root, "pkg", "engine", "events.py"),
      `class ConnectionEvents:
    def engine_disposed(self, engine):
        """Event hook called when an engine is disposed."""
        return engine
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy Engine dispose its connection pool and optionally close checked-in connections?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Engine.dispose",
      kind: "method",
      file: "pkg/engine/base.py"
    });
    expect(result.matches[0].why).toContain("engine disposal intent");
  });

  test("hybrid mode prefers event registry key listeners over public event APIs when key attachment is named", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-event-key-listen-"));
    await mkdir(path.join(root, "pkg", "event"), { recursive: true });
    await mkdir(path.join(root, "pkg", "orm"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "event", "api.py"),
      `def listen(target, identifier, fn, propagate=False, insert=False, named=False, once=False, retval=False):
    """Public event listener registration API."""
    return target, identifier, fn
`
    );
    await writeFile(
      path.join(root, "pkg", "event", "registry.py"),
      `class _EventKey:
    def listen(self, once=False, named=False, retval=False, propagate=False, insert=False):
        """Attach an event key listener with once named retval propagate insert and wrapper options."""
        return once, named, retval, propagate, insert
`
    );
    await writeFile(
      path.join(root, "pkg", "orm", "events.py"),
      `class MapperEvents:
    """ORM mapper event hooks."""
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does SQLAlchemy event registry attach an event key listener with once named retval propagate insert and wrapper options?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "_EventKey.listen",
      kind: "method",
      file: "pkg/event/registry.py"
    });
    expect(result.matches[0].why).toContain("event key listener intent");
  });

  test("hybrid mode prefers URLResolver resolve over topical url pattern properties", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-url-resolver-resolve-"));
    await mkdir(path.join(root, "pkg", "urls"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "urls", "resolvers.py"),
      `class URLResolver:
    @property
    def url_patterns(self):
        """Return URL patterns for resolving paths."""
        return self._url_patterns

    def resolve(self, path):
        """Resolve a path against URL patterns and return a ResolverMatch."""
        return ResolverMatch(path)
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Django URLResolver resolve a path against URL patterns and return a ResolverMatch?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "URLResolver.resolve",
      kind: "method",
      file: "pkg/urls/resolvers.py"
    });
    expect(result.matches[0].why).toContain("url resolve intent");
  });

  test("hybrid mode prefers public URL reverse functions over unrelated reverse-order containers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-url-reverse-"));
    await mkdir(path.join(root, "pkg", "urls"), { recursive: true });
    await mkdir(path.join(root, "pkg", "db", "models"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "urls", "base.py"),
      `def reverse(viewname, urlconf=None, args=None, kwargs=None, current_app=None, query=None, fragment=None):
    """Reverse a view name into a URL using urlconf args kwargs current_app query and fragment values."""
    return "/url/"
`
    );
    await writeFile(
      path.join(root, "pkg", "db", "models", "query.py"),
      `class QuerySet:
    """QuerySet supports reverse ordering and query values."""

    def reverse(self):
        """Reverse query ordering."""
        return self
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Django reverse a view name into a URL using urlconf args kwargs current_app and query or fragment values?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "reverse",
      kind: "function",
      file: "pkg/urls/base.py"
    });
    expect(result.matches[0].why).toContain("url reverse intent");
  });

  test("hybrid mode prefers URLResolver reverse prefix methods over converter helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-urlresolver-reverse-prefix-"));
    await mkdir(path.join(root, "pkg", "urls"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "urls", "resolvers.py"),
      `class URLResolver:
    def reverse(self, lookup_view, *args, **kwargs):
        return self._reverse_with_prefix(lookup_view, "/", *args, **kwargs)

    def _reverse_with_prefix(self, lookup_view, prefix, *args, **kwargs):
        """Build candidate reversed URLs with prefix namespace converters args and kwargs."""
        candidate_urls = []
        return candidate_urls
`
    );
    await writeFile(
      path.join(root, "pkg", "urls", "converters.py"),
      `class IntConverter:
    def to_url(self, value):
        """Convert URL arguments for candidate reversed URLs."""
        return str(value)

def get_converters():
    """Return URL converters used by URLResolver reverse."""
    return {"int": IntConverter()}
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Django URLResolver build candidate reversed URLs with prefix namespace converters args and kwargs?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "URLResolver._reverse_with_prefix",
      kind: "method",
      file: "pkg/urls/resolvers.py"
    });
    expect(result.matches[0].why).toContain("url reverse intent");
  });

  test("hybrid mode prefers AMQP protocol v2 task message builders over protocol conversion helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-amqp-v2-message-"));
    await mkdir(path.join(root, "pkg", "app"), { recursive: true });
    await mkdir(path.join(root, "pkg", "worker"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "app", "amqp.py"),
      `class AMQP:
    def as_task_v2(self, task_id, name, args=None, kwargs=None, callbacks=None, errbacks=None, stamped_headers=None):
        """Build the protocol v2 task message headers body callbacks errbacks and stamped headers."""
        headers = {"id": task_id, "task": name, "stamped_headers": stamped_headers}
        body = (args, kwargs, {"callbacks": callbacks, "errbacks": errbacks})
        return headers, body
`
    );
    await writeFile(
      path.join(root, "pkg", "worker", "strategy.py"),
      `def proto1_to_proto2(message):
    """Convert old task messages into protocol v2 task message fields."""
    return message
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Celery build the protocol v2 task message headers body callbacks errbacks and stamped headers?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "AMQP.as_task_v2",
      kind: "method",
      file: "pkg/app/amqp.py"
    });
    expect(result.matches[0].why).toContain("amqp task message intent");
  });

  test("hybrid mode prefers parser owner methods over unrelated parse helper functions for template parser questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-template-parser-"));
    await mkdir(path.join(root, "pkg", "template"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "template", "base.py"),
      `class Parser:
    def parse(self, parse_until=None):
        """Parse template tokens until block tags and build nodelists."""
        return NodeList()
`
    );
    await writeFile(
      path.join(root, "pkg", "template", "library.py"),
      `def parse_bits(parser, bits):
    """Parse bits for template tag helper functions."""
    return bits
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Django template Parser parse tokens until block tags and build nodelists?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Parser.parse",
      kind: "method",
      file: "pkg/template/base.py"
    });
    expect(result.matches[0].why).toContain("template parser intent");
  });

  test("hybrid mode prefers JsonResponse construction over adjacent response header helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-json-response-"));
    await mkdir(path.join(root, "pkg", "http"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "http", "response.py"),
      `class FileResponse:
    def set_headers(self):
        application_json_content_type = "application/json"
        return application_json_content_type

class JsonResponse:
    def __init__(self, data, encoder=None, json_dumps_params=None, **kwargs):
        """Serialize data to JSON and set the application/json content type."""
        kwargs.setdefault("content_type", "application/json")
        self.content = json.dumps(data, cls=encoder, **json_dumps_params)
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Django JsonResponse serialize data to JSON and set the application/json content type?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "JsonResponse.__init__",
      kind: "method",
      file: "pkg/http/response.py"
    });
    expect(result.matches[0].why).toContain("json response intent");
  });

  test("hybrid mode prefers CSRF process_view orchestration over token helper methods", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-csrf-process-view-"));
    await mkdir(path.join(root, "pkg", "middleware"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "middleware", "csrf.py"),
      `class CsrfViewMiddleware:
    def _check_token(self, request):
        """Check CSRF cookies and request tokens."""
        return request

    def process_view(self, request, callback, callback_args, callback_kwargs):
        """Process a view by checking CSRF cookies tokens origins and trusted origins."""
        self._origin_verified(request)
        self._check_token(request)
        return self._accept(request)
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does Django CsrfViewMiddleware process a view by checking CSRF cookies tokens origins and trusted origins?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "CsrfViewMiddleware.process_view",
      kind: "method",
      file: "pkg/middleware/csrf.py"
    });
    expect(result.matches[0].why).toContain("csrf process view intent");
  });

  test("symbol mode prefers methods whose owner and name both match the question", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-owner-method-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "models.py"),
      `class Response:
    def json(self):
        return parse_json(self.content)

def _parse_content_type_charset(value):
    response_parse_content_notes = "parse response content"
    return response_parse_content_notes
`
    );
    await writeFile(
      path.join(root, "pkg", "content.py"),
      `def encode_response(response):
    json_content_notes = "response json content"
    return json_content_notes
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does a response parse JSON content?", {
      target: root,
      limit: 5,
      mode: "symbol"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Response.json",
      kind: "method",
      file: "pkg/models.py"
    });
    expect(result.matches[0].why).toContain("method owner/name match");
  });

  test("hybrid mode prefers lifecycle methods over broad class containers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-lifecycle-method-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "worker.py"),
      `class WorkController:
    """Worker controller with blueprint startup, terminate handling, system exit handling, and keyboard interrupt handling."""

    def setup_instance(self):
        worker_blueprint_notes = "blueprint startup"
        return worker_blueprint_notes

    def start(self):
        try:
            self.blueprint.start(self)
        except WorkerTerminate:
            self.terminate()
        except SystemExit as exc:
            self.stop(exitcode=exc.code)
        except KeyboardInterrupt:
            self.stop(exitcode=1)
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the worker start its blueprint and handle terminate system exit or keyboard interrupt?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "WorkController.start",
      kind: "method",
      file: "pkg/worker.py"
    });
  });

  test("hybrid mode prefers a named schedule subtype over a generic schedule method", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-schedule-subtype-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "schedules.py"),
      `class schedule:
    def is_due(self, last_run_at):
        remaining_time = self.remaining_estimate(last_run_at)
        next_time_to_run = max(remaining_time.total_seconds(), 0)
        return next_time_to_run == 0

class crontab:
    def is_due(self, last_run_at):
        remaining_delta = self.remaining_estimate(last_run_at)
        remaining_seconds = max(remaining_delta.total_seconds(), 0)
        return remaining_seconds == 0
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does Celery crontab decide whether a schedule is due based on the last run time?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "crontab.is_due",
      kind: "method",
      file: "pkg/schedules.py"
    });
  });

  test("hybrid mode prefers inline task apply over tracer helpers for eager execution questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-inline-task-apply-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "task.py"),
      `class Task:
    def apply_async(self):
        return send_task_message()

    def apply(self, args=None, kwargs=None):
        eager_request = {"callbacks": [], "errbacks": [], "result": "state"}
        current_process_request = eager_request
        return current_process_request
`
    );
    await writeFile(
      path.join(root, "pkg", "trace.py"),
      `def build_tracer(task):
    callbacks = task.request.callbacks
    errbacks = task.request.errbacks
    result_state = task.backend
    return callbacks, errbacks, result_state
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does a task run eagerly in the current process and build a request with callbacks errbacks and result state?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Task.apply",
      kind: "method",
      file: "pkg/task.py"
    });
  });

  test("hybrid mode treats eager current-process task execution as task apply intent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-eager-task-apply-"));
    await mkdir(path.join(root, "pkg", "app"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "app", "task.py"),
      `class Task:
    def apply(self, args=None, kwargs=None):
        request = {"callbacks": [], "errbacks": []}
        return request
`
    );
    await writeFile(
      path.join(root, "pkg", "app", "trace.py"),
      `def build_tracer(task):
    eager_current_process = "run eagerly in the current process"
    request_callbacks_errbacks_result_state = "build a request with callbacks errbacks and result state"
    return eager_current_process, request_callbacks_errbacks_result_state
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does a task run eagerly in the current process and build a request with callbacks errbacks and result state?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Task.apply",
      kind: "method",
      file: "pkg/app/task.py"
    });
  });

  test("hybrid mode prefers scheduler tick over due-check helpers for heap scheduling questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-scheduler-tick-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "beat.py"),
      `class Scheduler:
    def populate_heap(self):
        heap = ["due schedule entry"]
        return heap

    def is_due(self, entry):
        return entry.is_due()

    def tick(self):
        event = self._heap[0]
        entry = event[2]
        is_due, next_time_to_run = self.is_due(entry)
        if is_due:
            self.reserve(entry)
            self.apply_entry(entry)
            return 0
        return next_time_to_run
`
    );
    await writeFile(
      path.join(root, "pkg", "schedules.py"),
      `class schedule:
    def is_due(self, last_run_at):
        next_delay = self.remaining_estimate(last_run_at)
        return next_delay
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does beat inspect the heap pop a due schedule entry reserve it apply it and return the next delay?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Scheduler.tick",
      kind: "method",
      file: "pkg/beat.py"
    });
  });

  test("hybrid mode does not treat reporting a result id as report-generation intent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-scheduler-apply-entry-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "beat.py"),
      `class Scheduler:
    def apply_entry(self, entry, producer=None):
        info("Scheduler: Sending due task %s", entry.name)
        result = self.apply_async(entry, producer=producer, advance=False)
        if result and hasattr(result, "id"):
            debug("%s sent. id->%s", entry.task, result.id)
        return result
`
    );
    await writeFile(
      path.join(root, "pkg", "result.py"),
      `class ResultSet:
    def _failed_join_report(self):
        report = "failed result id report"
        return report
`
    );
    await writeFile(
      path.join(root, "pkg", "schedules.py"),
      `class schedule:
    def is_due(self, entry):
        due_scheduled_task = "due scheduled task"
        result_id_after_applying = "result id after applying it"
        return due_scheduled_task, result_id_after_applying
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does beat log that a due scheduled task is being sent and report the result id after applying it?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Scheduler.apply_entry",
      kind: "method",
      file: "pkg/beat.py"
    });
  });

  test("hybrid mode distinguishes backend success marking from chord error handling", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-backend-success-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "backend.py"),
      `class Backend:
    def mark_as_done(self, task_id, result, request=None, store_result=True):
        if store_result:
            self.store_result(task_id, result, "SUCCESS", request=request)
        if request and request.chord:
            self.on_chord_part_return(request, "SUCCESS", result)

    def mark_as_failure(self, task_id, exc, request=None):
        self.store_result(task_id, exc, "FAILURE", request=request)
        self.on_chord_part_return(request, "FAILURE", exc)

    def _handle_group_chord_error(self, group_callback, backend, exc=None):
        backend_result_storage = "result backend stored chord completion"
        successful_task_notification = "successful task result should be stored"
        group_callback.revoke()
        backend.fail_from_current_stack(group_callback.id, exc=exc)
        return backend_result_storage, successful_task_notification
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does a result backend mark a task successful and notify chord completion when results should be stored?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Backend.mark_as_done",
      kind: "method",
      file: "pkg/backend.py"
    });
  });

  test("hybrid mode prefers group apply orchestration over unroll helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-group-apply-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "canvas.py"),
      `class group:
    def _unroll_tasks(self, tasks):
        return [task.clone() for task in tasks]

    def _prepared(self, tasks, partial_args, group_id, root_id, app):
        return self._unroll_tasks(tasks)

    def _apply_tasks(self, tasks, producer, app, barrier, args=None, kwargs=None):
        return [task.apply_async(args=args, kwargs=kwargs) for task in tasks]

    def apply_async(self, args=None, kwargs=None, add_to_parent=True):
        tasks = self._prepared(self.tasks, [], self.group_id, self.root_id, self.app)
        results = list(self._apply_tasks(tasks, self.producer, self.app, self.barrier, args=args, kwargs=kwargs))
        result = self.app.GroupResult(self.group_id, results)
        if add_to_parent and self.parent_task:
            self.parent_task.add_trail(result)
        return result
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does a canvas group unroll prepared tasks, apply every child signature, build a GroupResult, and add the trail to the parent task?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "group.apply_async",
      kind: "method",
      file: "pkg/canvas.py"
    });
  });

  test("hybrid mode prefers group freeze metadata methods over unroll helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-group-freeze-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "canvas.py"),
      `class group:
    def _freeze_group_tasks(self, group_id=None, root_id=None, parent_id=None, chord=None):
        task_id = group_id
        group_index = 0
        return self._freeze_tasks(group_id, root_id, parent_id, chord, group_index)

    def _freeze_tasks(self, group_id, root_id, parent_id, chord, group_index):
        frozen_child_signatures = []
        return frozen_child_signatures

    def _freeze_unroll(self, tasks):
        freeze_child_signatures = "freeze child signatures"
        group_id_root_id_parent_id_chord_group_indexes = "group id root id parent id chord and group indexes"
        return freeze_child_signatures, group_id_root_id_parent_id_chord_group_indexes
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does a canvas group freeze child signatures with group id root id parent id chord and group indexes?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "group._freeze_group_tasks",
      kind: "method",
      file: "pkg/canvas.py"
    });
  });

  test("hybrid mode prefers unknown task handlers over request failure callbacks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-unknown-task-"));
    await mkdir(path.join(root, "pkg", "worker", "consumer"), { recursive: true });
    await mkdir(path.join(root, "pkg", "worker"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "worker", "consumer", "consumer.py"),
      `class Consumer:
    def on_unknown_task(self, body, message, exc):
        message.reject_log_error(logger, self.connection_errors)
        self.app.backend.mark_as_failure(message.headers["id"], NotRegistered(message.headers["task"]))
        self.event_dispatcher.send("task-failed")
        signals.task_unknown.send(sender=self, message=message, exc=exc)
`
    );
    await writeFile(
      path.join(root, "pkg", "worker", "request.py"),
      `class Request:
    def on_failure(self, exc_info):
        self.task_failed = True
        unknown_task_message_failure = "unknown task message rejected failure"
        self.eventer.send("task-failed")
        self.backend.mark_as_failure(self.id, exc_info.exception)
        return unknown_task_message_failure
`
    );
    await mkdir(path.join(root, "pkg", "app"), { recursive: true });
    await mkdir(path.join(root, "pkg", "utils", "dispatch"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "app", "task.py"),
      `class Task:
    def send_event(self):
        """Send a task-failed event for a task."""
        return "task-failed"
`
    );
    await writeFile(
      path.join(root, "pkg", "utils", "dispatch", "signal.py"),
      `class Signal:
    def send(self):
        """Send a task unknown signal."""
        return "task_unknown"
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the worker reject an unknown task message, mark it as failure, emit task-failed, and send the task_unknown signal?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Consumer.on_unknown_task",
      kind: "method",
      file: "pkg/worker/consumer/consumer.py"
    });
  });

  test("hybrid mode treats event-handler prefixes as optional for compound method names", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-event-prefix-"));
    await mkdir(path.join(root, "pkg", "worker", "consumer"), { recursive: true });
    await mkdir(path.join(root, "pkg", "worker"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "worker", "consumer", "consumer.py"),
      `class Consumer:
    def on_unknown_task(self, body, message, exc):
        signals.task_unknown.send(sender=self, message=message, exc=exc)
`
    );
    await writeFile(
      path.join(root, "pkg", "worker", "request.py"),
      `class Request:
    def on_failure(self, exc_info):
        rejected_unknown_task_message = "reject unknown task message"
        marked_failure = "mark it as failure"
        emitted_task_failed = "emit task-failed"
        sent_task_unknown_signal = "send the task_unknown signal"
        return rejected_unknown_task_message, marked_failure, emitted_task_failed, sent_task_unknown_signal
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the worker reject an unknown task message, mark it as failure, emit task-failed, and send the task_unknown signal?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Consumer.on_unknown_task",
      kind: "method",
      file: "pkg/worker/consumer/consumer.py"
    });
  });

  test("hybrid mode prefers strategy rebuild methods over process initializer helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-strategy-rebuild-"));
    await mkdir(path.join(root, "pkg", "worker", "consumer"), { recursive: true });
    await mkdir(path.join(root, "pkg", "concurrency"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "worker", "consumer", "consumer.py"),
      `class Consumer:
    def update_strategies(self):
        for name, task in self.app.tasks.items():
            self.strategies[name] = task.start_strategy(self.app, self)
            task.__trace__ = build_tracer(name, task, self.app.loader, self.hostname)
`
    );
    await writeFile(
      path.join(root, "pkg", "concurrency", "prefork.py"),
      `def process_initializer(app, hostname):
    for name, task in app.tasks.items():
        task_execution_strategy = task.start_strategy(app, hostname)
        task.__trace__ = build_tracer(name, task, app.loader, hostname)
        app.registry_strategy = task_execution_strategy
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the worker rebuild task execution strategies from the app registry and install tracers for each task?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Consumer.update_strategies",
      kind: "method",
      file: "pkg/worker/consumer/consumer.py"
    });
  });

  test("hybrid mode treats update methods as rebuild candidates for strategy refresh questions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-strategy-update-alias-"));
    await mkdir(path.join(root, "pkg", "worker", "consumer"), { recursive: true });
    await mkdir(path.join(root, "pkg", "concurrency"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "worker", "consumer", "consumer.py"),
      `class Consumer:
    def update_strategies(self):
        return self.strategies
`
    );
    await writeFile(
      path.join(root, "pkg", "concurrency", "prefork.py"),
      `def process_initializer(app, hostname):
    task_execution_strategy = "rebuild task execution strategies"
    app_registry = app.tasks
    installed_tracers = [build_tracer(name, task, app.loader, hostname) for name, task in app_registry.items()]
    return task_execution_strategy, installed_tracers
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the worker rebuild task execution strategies from the app registry and install tracers for each task?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Consumer.update_strategies",
      kind: "method",
      file: "pkg/worker/consumer/consumer.py"
    });
  });

  test("hybrid mode prefers chord run orchestration over freeze helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-chord-run-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "canvas.py"),
      `class _chord:
    def freeze(self, _id=None, group_id=None, chord=None):
        header_results = self.tasks.freeze(group_id=group_id, chord=chord)
        return header_results

    def run(self, header, body, partial_args, app=None, interval=None):
        header_result = header.freeze(chord=body)
        bodyres = body.freeze()
        header.apply_async(partial_args)
        app.backend.apply_chord(header_result, body, interval=interval)
        return bodyres
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does a chord freeze header results, schedule the header group, and attach the body callback for unlock behavior?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "_chord.run",
      kind: "method",
      file: "pkg/canvas.py"
    });
  });

  test("hybrid mode prefers pool target submission methods over pool containers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-pool-apply-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "pool.py"),
      `class BasePool:
    """Pool for target execution with callbacks timeout and correlation id."""

    def on_apply(self, target, args=None, kwargs=None, callback=None, accept_callback=None, timeout=None, correlation_id=None):
        return target(*args, **kwargs)

    def apply_async(self, target, args=None, kwargs=None, callback=None, accept_callback=None, timeout=None, correlation_id=None):
        return self.on_apply(target, args, kwargs, callback, accept_callback, timeout, correlation_id)
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the concurrency pool submit a target with args kwargs callbacks accept callbacks timeout and correlation id?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(["BasePool.apply_async", "BasePool.on_apply"]).toContain(result.matches[0].symbol);
  });

  test("hybrid mode treats stay-alive questions as keep-alive symbol matches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-keep-alive-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "connection.py"),
      `def _keep_alive(event):
    connection = event.headers.get("connection")
    if connection == "close":
        return False
    if event.http_version < "1.1":
        return False
    return True

class Connection:
    def _clean_up_response_headers_for_sending(self, response):
        connection_close = response.headers.get("connection") == "close"
        http_version = response.http_version
        decision = "decide whether HTTP connection can stay alive based on Connection close and HTTP version"
        stay_alive = not connection_close and http_version == "1.1"
        return decision, stay_alive
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the HTTP connection decide whether it can stay alive based on Connection close and HTTP version?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "_keep_alive",
      kind: "function",
      file: "pkg/connection.py"
    });
  });

  test("hybrid mode routes parse questions to reader modules and callable reader behavior", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-reader-domain-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "connection.py"),
      `class Connection:
    """Connection parses chunked request and response body data into Data events with chunk boundaries."""

    def next_event(self):
        request_response_body_data = "parse chunked request response body data and emit Data events with chunk boundaries"
        return request_response_body_data

def _body_framing(event):
    chunked_request_response_body_data = "chunked request response body data"
    return chunked_request_response_body_data
`
    );
    await writeFile(
      path.join(root, "pkg", "readers.py"),
      `class ChunkedReader:
    def __call__(self, buf):
        chunked_request_response_body = buf.read_chunk()
        data_event = Data(data=chunked_request_response_body, chunk_start=True, chunk_end=True)
        return data_event
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the protocol parse chunked request or response body data and emit Data events with chunk boundaries?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "ChunkedReader.__call__",
      kind: "method",
      file: "pkg/readers.py"
    });
  });

  test("hybrid mode prefers chunked writer methods over writer class containers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-writer-method-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "writers.py"),
      `class ChunkedWriter:
    """Writer for chunked body data with hexadecimal chunk sizes and terminating zero chunks."""

    def send_data(self, data, write):
        write(hex(len(data)))
        write(data)

    def send_eom(self, headers, write):
        write("0")
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the protocol write chunked body data with hexadecimal chunk sizes and the terminating zero chunk?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(["ChunkedWriter.send_data", "ChunkedWriter.send_eom"]).toContain(result.matches[0].symbol);
    expect(result.matches[0].kind).toBe("method");
  });

  test("hybrid mode does not route ordinary read questions to parser modules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-read-parser-"));
    await mkdir(path.join(root, "pkg", "repositories", "parsers"), { recursive: true });
    await mkdir(path.join(root, "pkg", "packages"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "repositories", "parsers", "html_parser.py"),
      `class SearchResultParser:
    def handle_data(self, data):
        package_data = "read package data from html search result parser"
        return package_data
`
    );
    await writeFile(
      path.join(root, "pkg", "packages", "locker.py"),
      `class Locker:
    def locked_repository(self):
        poetry_lock_package_entries = "read poetry.lock package entries"
        lockfile_repository = "build a lockfile repository of locked packages"
        return poetry_lock_package_entries, lockfile_repository
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does the package manager read poetry.lock package entries and build a lockfile repository of locked packages?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Locker.locked_repository",
      kind: "method",
      file: "pkg/packages/locker.py"
    });
  });
});

async function expectTopHybridSymbol(root: string, question: string, symbol: string): Promise<void> {
  const result = await queryIndex(question, { target: root, limit: 5, mode: "hybrid" });

  expect(result.matches[0].symbol).toBe(symbol);
  expect(result.matches[0].why).toContain("query intent match");
}

function match(symbol: string, kind: QueryMatch["kind"], score: number): QueryMatch {
  return {
    symbol,
    kind,
    file: "pkg/example.py",
    lines: [1, 1],
    score,
    why: ["matched source text"],
    neighbors: []
  };
}

function hybridItem(match: QueryMatch, ftsPosition: number | undefined) {
  return { match, ftsPosition, inputIndex: ftsPosition ?? 99 };
}
