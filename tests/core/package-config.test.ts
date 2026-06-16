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

  test("build marks the emitted CLI as executable for direct agent use", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const chmodScript = await readFile("scripts/make-cli-executable.mjs", "utf8");

    expect(packageJson.scripts.postbuild).toBe("node scripts/make-cli-executable.mjs");
    expect(chmodScript).toContain("dist");
    expect(chmodScript).toContain("cli.js");
    expect(chmodScript).toContain("chmod");
    expect(chmodScript).toContain("0o755");
  });

  test("declares repeatable navigation suite and dominance guard scripts", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts["nav:suite"]).toBe(
      "node dist/cli.js nav-suite benchmarks/navigation/suite.json --repos"
    );
    expect(packageJson.scripts["nav:compare"]).toBe(
      "node dist/cli.js nav-compare --require-agent-dominance"
    );
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

  test("npm package ignore rules allow built dist artifacts", async () => {
    const npmIgnore = await readFile(".npmignore", "utf8");
    const ignored = npmIgnore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(ignored).not.toContain("dist/");
    expect(ignored).not.toContain("dist");
  });
});
