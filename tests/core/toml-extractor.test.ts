import { describe, expect, test } from "vitest";
import { extractToml } from "../../src/core/extractors/toml.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string): SourceFile {
  return {
    absolutePath: "/repo/gradle/libs.versions.toml",
    relativePath: "gradle/libs.versions.toml",
    language: "toml",
    role: "source",
    text
  };
}

describe("extractToml", () => {
  test("extracts Gradle version catalog libraries, plugins, versions, and bundles", () => {
    const result = extractToml(
      sourceFile(`[versions]
kotlin = "2.0.0"
coroutines = "1.8.1"

[libraries]
kotlinx-coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }
ktor-server-core = { group = "io.ktor", name = "ktor-server-core", version = "2.3.12" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-multiplatform = { id = "org.jetbrains.kotlin.multiplatform", version.ref = "kotlin" }

[bundles]
ktor-server = ["ktor-server-core"]
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ qualifiedName: "gradle.catalog.version.kotlin", kind: "method" }),
        expect.objectContaining({ qualifiedName: "gradle.catalog.library.kotlinx_coroutines_core", kind: "method" }),
        expect.objectContaining({ qualifiedName: "gradle.catalog.library.ktor_server_core", kind: "method" }),
        expect.objectContaining({ qualifiedName: "gradle.catalog.plugin.android_application", kind: "method" }),
        expect.objectContaining({ qualifiedName: "gradle.catalog.plugin.kotlin_multiplatform", kind: "method" }),
        expect.objectContaining({ qualifiedName: "gradle.catalog.bundle.ktor_server", kind: "method" })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "gradle.catalog.library.kotlinx_coroutines_core",
          targetName: "org.jetbrains.kotlinx:kotlinx-coroutines-core",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "gradle.catalog.plugin.kotlin_multiplatform",
          targetName: "org.jetbrains.kotlin.multiplatform",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });
});
