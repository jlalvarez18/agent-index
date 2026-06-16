import { describe, expect, test } from "vitest";
import type { SourceFile } from "../../src/core/schema.js";
import { extractTypeScript } from "../../src/core/extractors/typescript.js";

function sourceFile(text: string, relativePath = "src/views/DashboardScreen.tsx"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "typescript",
    role: "source",
    text
  };
}

describe("extractTypeScript", () => {
  test("extracts exported functions, arrow components, classes, methods, imports, and calls", () => {
    const result = extractTypeScript(
      sourceFile(`import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/projectStore";

export type PhaseStatus = "todo" | "done";

export function detectCurrentPhase(phases: PhaseStatus[]) {
  return phases.find((phase) => phase !== "done");
}

export const DashboardScreen = () => {
  const setPhases = useProjectStore((state) => state.setPhases);
  invoke("get_roadmap").then(setPhases);
  return null;
};

class PhaseController {
  async refresh() {
    return detectCurrentPhase(["todo"]);
  }
}
`)
    );

    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual([
      {
        name: "src/views/DashboardScreen.tsx",
        qualifiedName: "src/views/DashboardScreen.tsx",
        kind: "module",
        parentSymbolName: undefined
      },
      {
        name: "PhaseStatus",
        qualifiedName: "PhaseStatus",
        kind: "class",
        parentSymbolName: "src/views/DashboardScreen.tsx"
      },
      {
        name: "detectCurrentPhase",
        qualifiedName: "detectCurrentPhase",
        kind: "function",
        parentSymbolName: "src/views/DashboardScreen.tsx"
      },
      {
        name: "DashboardScreen",
        qualifiedName: "DashboardScreen",
        kind: "function",
        parentSymbolName: "src/views/DashboardScreen.tsx"
      },
      {
        name: "PhaseController",
        qualifiedName: "PhaseController",
        kind: "class",
        parentSymbolName: "src/views/DashboardScreen.tsx"
      },
      {
        name: "refresh",
        qualifiedName: "PhaseController.refresh",
        kind: "method",
        parentSymbolName: "PhaseController"
      }
    ]);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSymbolName: "src/views/DashboardScreen.tsx",
          targetName: "@tauri-apps/api/core",
          kind: "symbol_imports_module"
        }),
        expect.objectContaining({
          sourceSymbolName: "DashboardScreen",
          targetName: "invoke",
          kind: "symbol_calls_name"
        }),
        expect.objectContaining({
          sourceSymbolName: "PhaseController.refresh",
          targetName: "detectCurrentPhase",
          kind: "symbol_calls_name"
        })
      ])
    );
  });
});
