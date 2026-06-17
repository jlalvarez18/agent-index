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
});
