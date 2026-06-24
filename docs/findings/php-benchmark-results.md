# PHP Benchmark Results

Date: 2026-06-23

## Scope

The PHP benchmark track now validates navigation against three framework-heavy repositories:

- `laravel-framework-php`: controller dispatcher source, controller action dispatch behavior, middleware lookup, and PHPUnit routing tests.
- `symfony-console-php`: command lifecycle source, command synopsis/definition behavior, and PHPUnit command tests.
- `symfony-dependency-injection-php-config`: Symfony service wiring across PHP, YAML, and XML fixtures plus PHP loader/dumper tests.

Repositories were shallow-cloned into `/tmp/agent-index-php-repos` from the `repoUrl` entries in `benchmarks/navigation/suite.json`. The Laravel and Symfony Console cases were first run on 2026-06-17; the Symfony DependencyInjection config-wiring case was added on 2026-06-18 after YAML/XML service extraction was expanded. The PHP slice was refreshed on 2026-06-23 after replacing stale `/tmp` checkout symlinks with fresh clones.

## Command

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-php-repos \
  --index-root /tmp/agent-index-php-indexes \
  --artifacts-dir /tmp/agent-index-php-artifacts \
  --repo laravel-framework-php \
  --repo symfony-console-php \
  --repo symfony-dependency-injection-php-config \
  --reindex \
  --repos
```

## Indexed Corpus

| Suite entry | Files | Symbols | Edges |
| --- | ---: | ---: | ---: |
| `laravel-framework-php` | 3,071 | 40,278 | 184,086 |
| `symfony-console-php` | 406 | 4,048 | 19,520 |
| `symfony-dependency-injection-php-config` | 861 | 6,147 | 28,606 |

## Result

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 0.67 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Commands | 2.33 | 2.00 | 4.00 |
| Latency | 2,099 ms | 136 ms | 21 ms |
| Context tokens | 433 | 409,021 | 2,446 |
| First useful context tokens | 186 | 129,122 | 97 |
| Completion context tokens | 433 | 0 | 0 |
| Wins | 3 | 0 | 0 |

Average savings were 408,588 tokens versus broad `rg` and 2,013 tokens versus optimized `rg`.

## Agent Tool-Use Measurement

The Laravel and Symfony Console source-to-test workflows now include `agentToolUse` expectations. These assert that the authored coding-agent workflow starts with agent-index, reaches a useful result on command 1, and completes within a bounded context budget.

| Metric | Result |
| --- | ---: |
| Tool-use cases | 2 |
| Tool-use satisfied rate | 1.00 |
| Average first-useful latency | 152 ms |
| Average completion context tokens | 331 |

## Per-Repository Result

| Suite entry | agent complete | tool-use satisfied | agent tokens | broad rg tokens | optimized rg tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| `laravel-framework-php` | 1.00 | 1.00 | 329 | 916,909 | 739 |
| `symfony-console-php` | 1.00 | 1.00 | 332 | 172,982 | 2,912 |
| `symfony-dependency-injection-php-config` | 1.00 | n/a | 637 | 137,172 | 3,686 |

## Cases

### `laravel-controller-dispatcher-php-routing`

This case asks an agent to trace how Laravel dispatches controller actions that may define `callAction`, resolves controller method parameters, gathers controller middleware, and locates the related routing tests.

agent-index completed the task in two steps:

1. `file-clusters` returned `src/Illuminate/Routing/ControllerDispatcher.php` at rank 1, with the class and `dispatch`, `resolveParameters`, and `getMiddleware` methods.
2. `related-tests` returned `tests/Routing/RoutingRouteTest.php` at rank 1, including `Illuminate\Tests\Routing\RoutingRouteTest::testControllerCallActionMethodParameters`.

Broad `rg` found useful files but produced 916,909 context tokens and did not supply the required method-level completion evidence. The optimized `rg` plan stayed compact at 739 tokens but did not complete the task.

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

Broad `rg` found useful files, but it could not provide config-level service symbols and emitted 137,172 context tokens. The optimized `rg` plan was more compact at 3,686 tokens but still did not complete the symbol-level task.

## Live-Agent PHP Trial

A worker subagent performed a small PHP bugfix/navigation trial in an isolated fixture at `/tmp/agent-index-php-live-trial`.

Task:

- Fix a redirect-safety bug where external redirect targets should fall back to `/dashboard` while local absolute paths such as `/account` still pass through.

Setup:

- Prebuilt index: `/tmp/agent-index-php-live-trial/index.sqlite`
- Target source: `/tmp/agent-index-php-live-trial/app/Services/RedirectDecision.php`
- Target test: `/tmp/agent-index-php-live-trial/tests/Feature/RedirectDecisionTest.php`

Observed agent behavior:

- First target navigation command: `agent-index query --target /tmp/agent-index-php-live-trial --index /tmp/agent-index-php-live-trial/index.sqlite --mode hybrid --term redirect --term dashboard --kind function --role source`
- First useful hit: `App\Services\RedirectDecision::target` in `app/Services/RedirectDecision.php`.
- Files inspected: implementation and feature test.
- Files edited: `app/Services/RedirectDecision.php`.
- Broad `rg` fallback: none.

The subagent used agent-index before broad search or editing, then changed `RedirectDecision::target` to allow only non-empty local absolute paths and reject URL schemes and protocol-relative URLs. Runtime verification could not run because this environment does not have `php` or `composer` installed:

```text
php -l app/Services/RedirectDecision.php
zsh:1: command not found: php
```

This is a useful live-agent tool-choice signal, but it remains weaker than a mature-repo PHP coding trial because it used a small fixture and could not execute PHP tests in this environment.

## Notes

The PHP extractor is intentionally line-based. This benchmark shows useful first-class signal for common PHP framework navigation: namespaces, regular and nested grouped imports, function/const imports, attributes with simple string and `::class` payloads, classes/interfaces/traits/enums, anonymous classes, enum cases, methods, constants, `extends`/`implements`/trait-use conformance, Laravel route declarations with controller-action and middleware edges, Laravel service-provider container bindings and middleware aliases including bounded multiline closure bindings, Symfony PHP/YAML/XML service configuration entries including class-like IDs and ordinary service IDs such as `tagged_iterator`, simple call edges, object-instantiation call edges, arrow-function call names, Pest `it()`/`test()` case symbols, and PHPUnit/Pest-style source-to-test discovery.

Remaining limitations include complex expression parsing, computed attribute arguments beyond simple strings and `::class` constants, anonymous class identity stability when lines shift, very large/generated provider methods beyond the bounded statement window, nested YAML structures beyond Symfony-style service blocks, and framework wiring that only appears through runtime container compilation.
