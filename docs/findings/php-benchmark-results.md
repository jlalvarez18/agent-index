# PHP Benchmark Results

Date: 2026-06-18

## Scope

The PHP benchmark track now validates navigation against three framework-heavy repositories:

- `laravel-framework-php`: controller dispatcher source, controller action dispatch behavior, middleware lookup, and PHPUnit routing tests.
- `symfony-console-php`: command lifecycle source, command synopsis/definition behavior, and PHPUnit command tests.
- `symfony-dependency-injection-php-config`: Symfony service wiring across PHP, YAML, and XML fixtures plus PHP loader/dumper tests.

Repositories were shallow-cloned into `/tmp/agent-index-php-repos` from the `repoUrl` entries in `benchmarks/navigation/suite.json`. The Laravel and Symfony Console cases were run on 2026-06-17; the Symfony DependencyInjection config-wiring case was added and run on 2026-06-18 after YAML/XML service extraction was expanded.

## Command

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-php-repos \
  --index-root /tmp/agent-index-php-indexes \
  --artifacts-dir /tmp/agent-index-php-artifacts \
  --repo laravel-framework-php \
  --repo symfony-console-php \
  --reindex \
  --repos
```

Additional config-wiring run:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-php-repos \
  --index-root /tmp/agent-index-indexes \
  --artifacts-dir /tmp/agent-index-php-artifacts \
  --repo symfony-dependency-injection-php-config \
  --case symfony-dependency-injection-service-config-php-yaml-xml \
  --reindex \
  --repos
```

## Indexed Corpus

| Suite entry | Files | Symbols | Edges |
| --- | ---: | ---: | ---: |
| `laravel-framework-php` | 3,008 | 39,689 | 176,439 |
| `symfony-console-php` | 406 | 4,048 | 16,990 |
| `symfony-dependency-injection-php-config` | 861 | 6,147 | 28,606 |

## Result

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 0.50 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Commands | 2 | 2 | 4 |
| Context tokens | 331 | 543,632 | 1,826 |
| Completion context tokens | 331 | 0 | 0 |
| Wins | 2 | 0 | 0 |

Average savings were 543,301 tokens versus broad `rg` and 1,495 tokens versus optimized `rg`.

### Symfony DependencyInjection Config Run

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Commands | 3 | 2 | 4 |
| Context tokens | 635 | 137,172 | 3,570 |
| First useful context tokens | 43 | 88,701 | 237 |
| Completion context tokens | 635 | 0 | 0 |
| Wins | 1 | 0 | 0 |

The config case saved 136,537 tokens versus broad `rg` and 2,935 tokens versus optimized `rg`.

## Cases

### `laravel-controller-dispatcher-php-routing`

This case asks an agent to trace how Laravel dispatches controller actions that may define `callAction`, resolves controller method parameters, gathers controller middleware, and locates the related routing tests.

agent-index completed the task in two steps:

1. `file-clusters` returned `src/Illuminate/Routing/ControllerDispatcher.php` at rank 1, with the class and `dispatch`, `resolveParameters`, and `getMiddleware` methods.
2. `related-tests` returned `tests/Routing/RoutingRouteTest.php` at rank 1, including `Illuminate\Tests\Routing\RoutingRouteTest::testControllerCallActionMethodParameters`.

Broad `rg` found useful files but produced 914k context tokens and did not supply the required method-level completion evidence. The optimized `rg` plan stayed compact but did not complete the task.

### `symfony-console-command-php-lifecycle`

This case asks an agent to trace how Symfony Console runs a command, merges application definitions, builds command synopsis text, and locates command lifecycle tests.

agent-index completed the task in two steps:

1. `file-clusters` returned `Command/Command.php` at rank 1, with the `Command` class and `run`, `mergeApplicationDefinition`, and `getSynopsis` methods.
2. `related-tests` returned `Tests/Command/CommandTest.php` at rank 1, including `testMergeApplicationDefinition` and `testGetSynopsis`.

Broad and optimized `rg` both found useful files but did not complete the method-level task. agent-index used 332 context tokens versus 172,982 for broad `rg` and 2,912 for optimized `rg`.

### `symfony-dependency-injection-service-config-php-yaml-xml`

This case asks an agent to trace the `services9` tagged iterator wiring in Symfony DependencyInjection across YAML and XML service fixtures, then locate the PHP tests that exercise loader/dumper behavior for that wiring.

agent-index completed the task in three steps:

1. `file-clusters` returned `Tests/Fixtures/yaml/services9.yml` at rank 1, including `service.tagged_iterator_foo` and `service.tagged_iterator`.
2. `file-clusters` returned `Tests/Fixtures/xml/services9.xml` at rank 1, including the same config-level service symbols.
3. `file-clusters` returned `Tests/Loader/YamlFileLoaderTest.php`, `Tests/Dumper/YamlDumperTest.php`, and `Tests/Dumper/XmlDumperTest.php`, including `testParsesIteratorArgument` and `testTaggedArguments`.

Broad `rg` found useful files, but it could not provide config-level service symbols and emitted 137,172 context tokens. The optimized `rg` plan was more compact at 3,570 tokens but still did not complete the symbol-level task.

## Notes

The PHP extractor is intentionally line-based. This benchmark shows useful first-class signal for common PHP framework navigation: namespaces, regular and nested grouped imports, function/const imports, attributes with simple string and `::class` payloads, classes/interfaces/traits/enums, anonymous classes, enum cases, methods, constants, `extends`/`implements`/trait-use conformance, Laravel route declarations with controller-action and middleware edges, Laravel service-provider container bindings and middleware aliases including bounded multiline closure bindings, Symfony PHP/YAML/XML service configuration entries including class-like IDs and ordinary service IDs such as `tagged_iterator`, simple call edges, object-instantiation call edges, arrow-function call names, Pest `it()`/`test()` case symbols, and PHPUnit/Pest-style source-to-test discovery.

Remaining limitations include complex expression parsing, computed attribute arguments beyond simple strings and `::class` constants, anonymous class identity stability when lines shift, very large/generated provider methods beyond the bounded statement window, nested YAML structures beyond Symfony-style service blocks, and framework wiring that only appears through runtime container compilation.
