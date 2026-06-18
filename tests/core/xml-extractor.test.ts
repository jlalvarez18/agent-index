import { describe, expect, test } from "vitest";
import { extractXml } from "../../src/core/extractors/xml.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "pom.xml"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "xml",
    role: "source",
    text
  };
}

describe("extractXml", () => {
  test("extracts Maven project, module, dependency, and plugin ownership symbols", () => {
    const result = extractXml(
      sourceFile(`<project>
  <parent>
    <groupId>com.acme</groupId>
    <artifactId>checkout-parent</artifactId>
  </parent>
  <groupId>com.acme</groupId>
  <artifactId>checkout-app</artifactId>
  <modules>
    <module>checkout-core</module>
    <module>checkout-app</module>
  </modules>
  <dependencies>
    <dependency>
      <groupId>org.jetbrains.kotlinx</groupId>
      <artifactId>kotlinx-coroutines-core</artifactId>
      <version>1.8.1</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.jetbrains.kotlin</groupId>
        <artifactId>kotlin-maven-plugin</artifactId>
        <version>2.0.0</version>
      </plugin>
    </plugins>
  </build>
</project>
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ qualifiedName: "maven.project.checkout_app", kind: "method" }),
        expect.objectContaining({ qualifiedName: "maven.module.checkout_core", kind: "method" }),
        expect.objectContaining({ qualifiedName: "maven.module.checkout_app", kind: "method" }),
        expect.objectContaining({ qualifiedName: "maven.dependency.org_jetbrains_kotlinx_kotlinx_coroutines_core", kind: "method" }),
        expect.objectContaining({ qualifiedName: "maven.plugin.org_jetbrains_kotlin_kotlin_maven_plugin", kind: "method" })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "maven.dependency.org_jetbrains_kotlinx_kotlinx_coroutines_core",
          targetName: "kotlinx-coroutines-core",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "maven.plugin.org_jetbrains_kotlin_kotlin_maven_plugin",
          targetName: "kotlin-maven-plugin",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("extracts Symfony XML service definitions, aliases, arguments, and tags", () => {
    const result = extractXml(
      sourceFile(
        `<?xml version="1.0" encoding="UTF-8" ?>
<container xmlns="http://symfony.com/schema/dic/services">
  <services>
    <service id="App\\Command\\ImportOrdersCommand" public="true">
      <argument type="service" id="App\\Contracts\\PaymentGateway" />
      <tag name="console.command" command="app:import-orders" />
    </service>
    <service id="App\\Contracts\\PaymentGateway" alias="App\\Services\\StripePaymentGateway" />
    <service id="App\\EventSubscriber\\OrderSubscriber">
      <tag name="kernel.event_subscriber" />
    </service>
  </services>
</container>
`,
        "config/services.xml"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "service.ImportOrdersCommand",
          qualifiedName: "config/services.xml::service.ImportOrdersCommand",
          kind: "method",
          parentSymbolName: "config/services.xml"
        }),
        expect.objectContaining({
          name: "service.alias.PaymentGateway",
          qualifiedName: "config/services.xml::service.alias.PaymentGateway",
          kind: "method",
          parentSymbolName: "config/services.xml"
        }),
        expect.objectContaining({
          name: "service.OrderSubscriber",
          qualifiedName: "config/services.xml::service.OrderSubscriber",
          kind: "method",
          parentSymbolName: "config/services.xml"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "config/services.xml::service.ImportOrdersCommand", targetName: "ImportOrdersCommand", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.xml::service.ImportOrdersCommand", targetName: "App\\Contracts\\PaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.xml::service.ImportOrdersCommand", targetName: "console.command", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.xml::service.ImportOrdersCommand", targetName: "app:import-orders", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.xml::service.alias.PaymentGateway", targetName: "PaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.xml::service.alias.PaymentGateway", targetName: "App\\Services\\StripePaymentGateway", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "config/services.xml::service.OrderSubscriber", targetName: "kernel.event_subscriber", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "config/services.xml::service.ImportOrdersCommand",
          text: expect.stringContaining("app:import-orders")
        })
      ])
    );
  });

  test("extracts named Symfony XML service ids and tagged iterator wiring", () => {
    const result = extractXml(
      sourceFile(
        `<?xml version="1.0" encoding="UTF-8" ?>
<container xmlns="http://symfony.com/schema/dic/services">
  <services>
    <service id="tagged_iterator_foo" class="Bar">
      <tag name="foo"/>
    </service>
    <service id="tagged_iterator" class="Bar" public="true">
      <argument type="tagged_iterator" tag="foo"/>
    </service>
    <service id="alias_for_foo" alias="tagged_iterator_foo" public="true"/>
  </services>
</container>
`,
        "Tests/Fixtures/xml/services9.xml"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "service.tagged_iterator_foo",
          qualifiedName: "Tests/Fixtures/xml/services9.xml::service.tagged_iterator_foo",
          kind: "method"
        }),
        expect.objectContaining({
          name: "service.tagged_iterator",
          qualifiedName: "Tests/Fixtures/xml/services9.xml::service.tagged_iterator",
          kind: "method"
        }),
        expect.objectContaining({
          name: "service.alias.alias_for_foo",
          qualifiedName: "Tests/Fixtures/xml/services9.xml::service.alias.alias_for_foo",
          kind: "method"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "Tests/Fixtures/xml/services9.xml::service.tagged_iterator_foo", targetName: "foo", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "Tests/Fixtures/xml/services9.xml::service.tagged_iterator", targetName: "tagged_iterator", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "Tests/Fixtures/xml/services9.xml::service.tagged_iterator", targetName: "foo", kind: "symbol_calls_name", confidence: "name" },
        {
          sourceSymbolName: "Tests/Fixtures/xml/services9.xml::service.alias.alias_for_foo",
          targetName: "tagged_iterator_foo",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });
});
