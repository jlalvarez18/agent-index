import { describe, expect, test } from "vitest";
import { extractYaml } from "../../src/core/extractors/yaml.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "config/services.yaml"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "yaml",
    role: "source",
    text
  };
}

describe("extractYaml", () => {
  test("extracts Symfony service definitions, aliases, arguments, and tags", () => {
    const result = extractYaml(
      sourceFile(`services:
  App\\Command\\ImportOrdersCommand:
    arguments:
      $gateway: '@App\\Contracts\\PaymentGateway'
    tags:
      - { name: 'console.command', command: 'app:import-orders' }

  App\\Contracts\\PaymentGateway: '@App\\Services\\StripePaymentGateway'

  App\\EventSubscriber\\OrderSubscriber:
    tags: ['kernel.event_subscriber']
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "service.ImportOrdersCommand",
          qualifiedName: "config/services.yaml::service.ImportOrdersCommand",
          kind: "method",
          parentSymbolName: "config/services.yaml"
        }),
        expect.objectContaining({
          name: "service.alias.PaymentGateway",
          qualifiedName: "config/services.yaml::service.alias.PaymentGateway",
          kind: "method",
          parentSymbolName: "config/services.yaml"
        }),
        expect.objectContaining({
          name: "service.OrderSubscriber",
          qualifiedName: "config/services.yaml::service.OrderSubscriber",
          kind: "method",
          parentSymbolName: "config/services.yaml"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "config/services.yaml::service.ImportOrdersCommand", targetName: "ImportOrdersCommand", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.yaml::service.ImportOrdersCommand", targetName: "App\\Contracts\\PaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.yaml::service.ImportOrdersCommand", targetName: "console.command", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.yaml::service.ImportOrdersCommand", targetName: "app:import-orders", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.yaml::service.alias.PaymentGateway", targetName: "PaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.yaml::service.alias.PaymentGateway", targetName: "App\\Services\\StripePaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.yaml::service.OrderSubscriber", targetName: "kernel.event_subscriber", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "config/services.yaml::service.ImportOrdersCommand",
          text: expect.stringContaining("app:import-orders")
        })
      ])
    );
  });

  test("extracts named Symfony service ids and tagged iterator wiring", () => {
    const result = extractYaml(
      sourceFile(
        `services:
    tagged_iterator_foo:
        class: Bar
        tags:
            - foo

    tagged_iterator:
        class: Bar
        arguments:
            - !tagged_iterator foo
        public: true

    alias_for_foo:
        alias: 'tagged_iterator_foo'
        public: true
`,
        "Tests/Fixtures/yaml/services9.yml"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "service.tagged_iterator_foo",
          qualifiedName: "Tests/Fixtures/yaml/services9.yml::service.tagged_iterator_foo",
          kind: "method"
        }),
        expect.objectContaining({
          name: "service.tagged_iterator",
          qualifiedName: "Tests/Fixtures/yaml/services9.yml::service.tagged_iterator",
          kind: "method"
        }),
        expect.objectContaining({
          name: "service.alias.alias_for_foo",
          qualifiedName: "Tests/Fixtures/yaml/services9.yml::service.alias.alias_for_foo",
          kind: "method"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "Tests/Fixtures/yaml/services9.yml::service.tagged_iterator_foo", targetName: "foo", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "Tests/Fixtures/yaml/services9.yml::service.tagged_iterator", targetName: "tagged_iterator", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "Tests/Fixtures/yaml/services9.yml::service.tagged_iterator", targetName: "foo", kind: "symbol_calls_name", confidence: "name" },
        {
          sourceSymbolName: "Tests/Fixtures/yaml/services9.yml::service.alias.alias_for_foo",
          targetName: "tagged_iterator_foo",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("does not treat nested YAML keys as top-level service ids", () => {
    const result = extractYaml(
      sourceFile(`services:
  App\\Service\\Mailer:
    class: App\\Service\\Mailer
    calls:
      - [setLogger, ['@logger']]

  App\\Service\\Logger:
    class: App\\Service\\Logger
`)
    );

    expect(result.symbols.map((symbol) => symbol.qualifiedName)).toEqual([
      "config/services.yaml",
      "config/services.yaml::service.Mailer",
      "config/services.yaml::service.Logger"
    ]);
  });
});
