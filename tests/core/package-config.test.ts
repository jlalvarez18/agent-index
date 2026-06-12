import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("package configuration", () => {
  test("declares local package metadata for a controlled dry run package", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.engines).toEqual(expect.objectContaining({ node: ">=20" }));
    expect(packageJson.files).toEqual(["dist", "benchmarks", "docs", "README.md"]);
    expect(packageJson.license).toBe("UNLICENSED");
  });

  test("build removes stale dist files before emitting package artifacts", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts.clean).toEqual(expect.any(String));
    expect(packageJson.scripts.clean).toContain("rmSync('dist'");
    expect(packageJson.scripts.prebuild).toBe("npm run clean");
  });

  test("published CLI bin matches the TypeScript build output path", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const tsconfig = JSON.parse(await readFile("tsconfig.json", "utf8"));
    const compilerOptions = tsconfig.compilerOptions;
    const rootDir = compilerOptions.rootDir;
    const outDir = compilerOptions.outDir;
    const cliSource = "src/cli.ts";
    const emittedCli = `./${path.posix.join(
      outDir,
      path.posix.relative(rootDir, cliSource).replace(/\.ts$/, ".js")
    )}`;

    expect(packageJson.bin["agent-index"]).toBe(emittedCli);
    expect(tsconfig.include.every((pattern: string) => pattern.startsWith(`${rootDir}/`))).toBe(true);
  });
});
