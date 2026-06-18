import { describe, expect, test } from "vitest";
import { extractPhp } from "../../src/core/extractors/php.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "app/Http/Controllers/CheckoutController.php", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "php",
    role,
    text
  };
}

describe("extractPhp", () => {
  test("extracts namespaces, imports, PHP types, methods, functions, constants, hierarchy, trait use, includes, and calls", () => {
    const result = extractPhp(
      sourceFile(`<?php

namespace App\\Http\\Controllers;

use App\\Contracts\\PaymentRepository;
use App\\Models\\Order as CheckoutOrder;
use Illuminate\\Routing\\Controller;

require_once __DIR__ . '/helpers.php';

interface AuditsPayments {
    public function audit(string $id): void;
}

trait AuthorizesPayments {
    public function authorize(string $id): bool {
        return policy_allows($id);
    }
}

final class CheckoutController extends Controller implements PaymentRepository, AuditsPayments
{
    use AuthorizesPayments;

    public const CACHE_KEY = 'checkout';

    public function __construct(private CheckoutService $service) {}

    public function show(string $id): CheckoutOrder
    {
        $order = $this->service->findOrder($id);
        return CheckoutOrder::fromRecord($order);
    }
}

function checkout_helper(string $id): string {
    return trim($id);
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "app/Http/Controllers/CheckoutController.php", qualifiedName: "app/Http/Controllers/CheckoutController.php", kind: "module" }),
        expect.objectContaining({ name: "App\\Http\\Controllers", qualifiedName: "App\\Http\\Controllers", kind: "module" }),
        expect.objectContaining({ name: "AuditsPayments", qualifiedName: "App\\Http\\Controllers\\AuditsPayments", kind: "class" }),
        expect.objectContaining({ name: "audit", qualifiedName: "App\\Http\\Controllers\\AuditsPayments::audit", kind: "method" }),
        expect.objectContaining({ name: "AuthorizesPayments", qualifiedName: "App\\Http\\Controllers\\AuthorizesPayments", kind: "class" }),
        expect.objectContaining({ name: "authorize", qualifiedName: "App\\Http\\Controllers\\AuthorizesPayments::authorize", kind: "method" }),
        expect.objectContaining({ name: "CheckoutController", qualifiedName: "App\\Http\\Controllers\\CheckoutController", kind: "class" }),
        expect.objectContaining({ name: "CACHE_KEY", qualifiedName: "App\\Http\\Controllers\\CheckoutController::CACHE_KEY", kind: "method" }),
        expect.objectContaining({ name: "__construct", qualifiedName: "App\\Http\\Controllers\\CheckoutController::__construct", kind: "method" }),
        expect.objectContaining({ name: "show", qualifiedName: "App\\Http\\Controllers\\CheckoutController::show", kind: "method" }),
        expect.objectContaining({ name: "checkout_helper", qualifiedName: "App\\Http\\Controllers\\checkout_helper", kind: "function" })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "App\\Contracts\\PaymentRepository", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "App\\Models\\Order", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "__DIR__ . '/helpers.php'", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "App\\Http\\Controllers\\CheckoutController", targetName: "Controller", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "App\\Http\\Controllers\\CheckoutController", targetName: "PaymentRepository", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "App\\Http\\Controllers\\CheckoutController", targetName: "AuditsPayments", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "App\\Http\\Controllers\\CheckoutController", targetName: "AuthorizesPayments", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "App\\Http\\Controllers\\AuthorizesPayments::authorize", targetName: "policy_allows", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Http\\Controllers\\CheckoutController::show", targetName: "findOrder", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Http\\Controllers\\CheckoutController::show", targetName: "fromRecord", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Http\\Controllers\\checkout_helper", targetName: "trim", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "App\\Http\\Controllers\\CheckoutController::show",
          text: expect.stringContaining("findOrder")
        })
      ])
    );
  });

  test("extracts modern PHP syntax including grouped imports, attributes, enums, anonymous classes, and arrow callbacks", () => {
    const result = extractPhp(
      sourceFile(`<?php

namespace App\\Console;

use Symfony\\Component\\Console\\Attribute\\AsCommand;
use Symfony\\Component\\Console\\{Command\\Command, Input\\InputInterface, Output\\OutputInterface};
use Symfony\\Component\\Routing\\{Loader\\Configurator\\{RoutingConfigurator, CollectionConfigurator}, Route as SymfonyRoute};
use Symfony\\Component\\Routing\\Attribute\\Route;
use App\\Services\\{CheckoutService, InventoryService as Stock};
use function App\\Support\\normalize_order_id;
use const App\\Support\\DEFAULT_ORDER_LIMIT;

#[AsCommand(name: 'orders:sync', description: 'Synchronize pending orders')]
#[Route('/orders/{order}', name: 'orders.show', methods: ['GET'], condition: CheckoutService::class)]
final readonly class SyncOrdersCommand extends Command
{
    public function __construct(private CheckoutService $checkout) {}

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $formatter = new class($output) extends BaseFormatter implements WritesOutput {
            public function write(string $message): void
            {
                $this->output->writeln($message);
            }
        };

        $ids = array_map(fn ($id) => normalize_order_id($id), $this->checkout->pendingOrderIds());
        $formatter->write(Stock::reserve($ids));

        return Command::SUCCESS;
    }
}

enum OrderState: string
{
    case Pending = 'pending';
    case Shipped = 'shipped';

    public function label(): string
    {
        return ucfirst($this->value);
    }
}
`)
    );

    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "Symfony\\Component\\Console\\Attribute\\AsCommand", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "Symfony\\Component\\Console\\Command\\Command", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "Symfony\\Component\\Console\\Input\\InputInterface", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "Symfony\\Component\\Console\\Output\\OutputInterface", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "Symfony\\Component\\Routing\\Loader\\Configurator\\RoutingConfigurator", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "Symfony\\Component\\Routing\\Loader\\Configurator\\CollectionConfigurator", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "Symfony\\Component\\Routing\\Route", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "Symfony\\Component\\Routing\\Attribute\\Route", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "App\\Services\\CheckoutService", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "App\\Services\\InventoryService", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "App\\Support\\normalize_order_id", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "app/Http/Controllers/CheckoutController.php", targetName: "App\\Support\\DEFAULT_ORDER_LIMIT", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand", targetName: "Command", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand", targetName: "AsCommand", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand", targetName: "orders:sync", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand", targetName: "Synchronize pending orders", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand", targetName: "Route", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand", targetName: "/orders/{order}", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand", targetName: "orders.show", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand", targetName: "GET", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand", targetName: "CheckoutService", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand::anonymous@21", targetName: "BaseFormatter", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand::anonymous@21", targetName: "WritesOutput", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand::execute", targetName: "array_map", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand::execute", targetName: "normalize_order_id", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand::execute", targetName: "pendingOrderIds", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand::execute", targetName: "reserve", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\SyncOrdersCommand::execute", targetName: "write", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Console\\OrderState::label", targetName: "ucfirst", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "SyncOrdersCommand", qualifiedName: "App\\Console\\SyncOrdersCommand", kind: "class" }),
        expect.objectContaining({ name: "execute", qualifiedName: "App\\Console\\SyncOrdersCommand::execute", kind: "method" }),
        expect.objectContaining({ name: "anonymous@21", qualifiedName: "App\\Console\\SyncOrdersCommand::anonymous@21", kind: "class" }),
        expect.objectContaining({ name: "write", qualifiedName: "App\\Console\\SyncOrdersCommand::anonymous@21::write", kind: "method" }),
        expect.objectContaining({ name: "OrderState", qualifiedName: "App\\Console\\OrderState", kind: "class" }),
        expect.objectContaining({ name: "Pending", qualifiedName: "App\\Console\\OrderState::Pending", kind: "method" }),
        expect.objectContaining({ name: "Shipped", qualifiedName: "App\\Console\\OrderState::Shipped", kind: "method" }),
        expect.objectContaining({ name: "label", qualifiedName: "App\\Console\\OrderState::label", kind: "method" })
      ])
    );
  });

  test("extracts Laravel-style route declarations with controller action wiring", () => {
    const result = extractPhp(
      sourceFile(
        `<?php

use App\\Http\\Controllers\\OrderController;
use Illuminate\\Support\\Facades\\Route;

Route::middleware('auth')
    ->prefix('orders')
    ->group(function () {
        Route::get('/{order}', [OrderController::class, 'show'])
            ->name('orders.show')
            ->middleware('can:view,order');

        Route::post('/', [OrderController::class, 'store'])->name('orders.store');
    });
`,
        "routes/web.php"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "route.get.orders.show",
          qualifiedName: "routes/web.php::route.get.orders.show",
          kind: "method",
          parentSymbolName: "routes/web.php"
        }),
        expect.objectContaining({
          name: "route.post.orders.store",
          qualifiedName: "routes/web.php::route.post.orders.store",
          kind: "method",
          parentSymbolName: "routes/web.php"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "routes/web.php::route.get.orders.show", targetName: "Route::get", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "routes/web.php::route.get.orders.show", targetName: "OrderController::show", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "routes/web.php::route.get.orders.show", targetName: "orders.show", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "routes/web.php::route.get.orders.show", targetName: "can:view,order", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "routes/web.php::route.post.orders.store", targetName: "Route::post", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "routes/web.php::route.post.orders.store", targetName: "OrderController::store", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "routes/web.php::route.post.orders.store", targetName: "orders.store", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "routes/web.php::route.get.orders.show",
          text: expect.stringContaining("OrderController::class")
        })
      ])
    );
  });

  test("extracts Laravel service container bindings and middleware aliases from providers", () => {
    const result = extractPhp(
      sourceFile(
        `<?php

namespace App\\Providers;

use App\\Contracts\\PaymentGateway;
use App\\Http\\Middleware\\EnsureTenant;
use App\\Services\\TenantPaymentGateway;
use App\\Services\\StripePaymentGateway;
use Illuminate\\Support\\ServiceProvider;

final class PaymentServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PaymentGateway::class, StripePaymentGateway::class);
        $this->app->singleton('tenant.middleware', fn ($app) => new EnsureTenant($app->make(PaymentGateway::class)));
        $this->app->alias(StripePaymentGateway::class, 'payments.gateway');
        $this->app->singleton(PaymentGateway::class, function ($app) {
            $tenant = $app->make('tenant.context');
            $config = $app->make('config');
            $logger = $app->make('logger');
            $cache = $app->make('cache.store');
            $events = $app->make('events');
            $gateway = new TenantPaymentGateway(
                $tenant,
                $config,
                $logger,
                $cache,
                $events,
            );

            return $gateway;
        });
    }

    public function boot(): void
    {
        $this->app['router']->aliasMiddleware('tenant', EnsureTenant::class);
    }
}
`,
        "app/Providers/PaymentServiceProvider.php"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "binding.PaymentGateway",
          qualifiedName: "App\\Providers\\PaymentServiceProvider::binding.PaymentGateway",
          kind: "method",
          parentSymbolName: "App\\Providers\\PaymentServiceProvider"
        }),
        expect.objectContaining({
          name: "singleton.tenant.middleware",
          qualifiedName: "App\\Providers\\PaymentServiceProvider::singleton.tenant.middleware",
          kind: "method",
          parentSymbolName: "App\\Providers\\PaymentServiceProvider"
        }),
        expect.objectContaining({
          name: "singleton.PaymentGateway",
          qualifiedName: "App\\Providers\\PaymentServiceProvider::singleton.PaymentGateway",
          kind: "method",
          parentSymbolName: "App\\Providers\\PaymentServiceProvider",
          endLine: 33
        }),
        expect.objectContaining({
          name: "alias.payments.gateway",
          qualifiedName: "App\\Providers\\PaymentServiceProvider::alias.payments.gateway",
          kind: "method",
          parentSymbolName: "App\\Providers\\PaymentServiceProvider"
        }),
        expect.objectContaining({
          name: "middleware.tenant",
          qualifiedName: "App\\Providers\\PaymentServiceProvider::middleware.tenant",
          kind: "method",
          parentSymbolName: "App\\Providers\\PaymentServiceProvider"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::binding.PaymentGateway", targetName: "PaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::binding.PaymentGateway", targetName: "StripePaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::singleton.tenant.middleware", targetName: "tenant.middleware", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::singleton.tenant.middleware", targetName: "EnsureTenant", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::singleton.PaymentGateway", targetName: "PaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::singleton.PaymentGateway", targetName: "TenantPaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::singleton.PaymentGateway", targetName: "tenant.context", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::singleton.PaymentGateway", targetName: "cache.store", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::alias.payments.gateway", targetName: "payments.gateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::middleware.tenant", targetName: "tenant", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "App\\Providers\\PaymentServiceProvider::middleware.tenant", targetName: "EnsureTenant", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "App\\Providers\\PaymentServiceProvider::binding.PaymentGateway",
          text: expect.stringContaining("StripePaymentGateway::class")
        }),
        expect.objectContaining({
          symbolName: "App\\Providers\\PaymentServiceProvider::singleton.PaymentGateway",
          text: expect.stringContaining("TenantPaymentGateway")
        })
      ])
    );
  });

  test("extracts Pest test declarations as function symbols", () => {
    const result = extractPhp(
      sourceFile(
        `<?php

use App\\Services\\CheckoutService;

it('loads line items for an order', function () {
    $order = (new CheckoutService())->findOrderWithLineItems('ord_123');
    expect($order['line_items'])->toBeArray();
});

test('rejects archived orders', function () {
    expect(true)->toBeTrue();
});
`,
        "tests/Feature/CheckoutServiceTest.php",
        "test"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "it.loads.line.items.for.an.order",
          qualifiedName: "tests/Feature/CheckoutServiceTest.php::it.loads.line.items.for.an.order",
          kind: "function",
          parentSymbolName: "tests/Feature/CheckoutServiceTest.php"
        }),
        expect.objectContaining({
          name: "test.rejects.archived.orders",
          qualifiedName: "tests/Feature/CheckoutServiceTest.php::test.rejects.archived.orders",
          kind: "function",
          parentSymbolName: "tests/Feature/CheckoutServiceTest.php"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "tests/Feature/CheckoutServiceTest.php::it.loads.line.items.for.an.order", targetName: "CheckoutService", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "tests/Feature/CheckoutServiceTest.php::it.loads.line.items.for.an.order", targetName: "findOrderWithLineItems", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
  });

  test("extracts Symfony PHP service configuration definitions", () => {
    const result = extractPhp(
      sourceFile(
        `<?php

use App\\Command\\ImportOrdersCommand;
use App\\Contracts\\PaymentGateway;
use App\\Services\\StripePaymentGateway;
use Symfony\\Component\\DependencyInjection\\Loader\\Configurator\\ContainerConfigurator;

use function Symfony\\Component\\DependencyInjection\\Loader\\Configurator\\service;

return static function (ContainerConfigurator $container): void {
    $services = $container->services();

    $services->set(ImportOrdersCommand::class)
        ->arg('$gateway', service(PaymentGateway::class))
        ->tag('console.command');

    $services->alias(PaymentGateway::class, StripePaymentGateway::class);
};
`,
        "config/services.php"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "service.ImportOrdersCommand",
          qualifiedName: "config/services.php::service.ImportOrdersCommand",
          kind: "method",
          parentSymbolName: "config/services.php"
        }),
        expect.objectContaining({
          name: "service.alias.PaymentGateway",
          qualifiedName: "config/services.php::service.alias.PaymentGateway",
          kind: "method",
          parentSymbolName: "config/services.php"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "config/services.php::service.ImportOrdersCommand", targetName: "ImportOrdersCommand", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.php::service.ImportOrdersCommand", targetName: "PaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.php::service.ImportOrdersCommand", targetName: "console.command", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.php::service.alias.PaymentGateway", targetName: "PaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.php::service.alias.PaymentGateway", targetName: "StripePaymentGateway", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "config/services.php::service.ImportOrdersCommand",
          text: expect.stringContaining("console.command")
        })
      ])
    );
  });
});
