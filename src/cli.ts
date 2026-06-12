#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { pathToFileURL } from "node:url";
import { runBenchmark } from "./core/benchmark.js";
import { indexTarget } from "./core/indexer.js";
import { queryIndex } from "./core/query.js";
import type { QueryMode } from "./core/schema.js";

export interface CliIO {
  write: (line: string) => void;
}

export async function runCli(argv: string[], io: CliIO = { write: console.log }): Promise<void> {
  const program = new Command();
  program
    .name("agent-index")
    .description("Symbol-first local code index prototype for coding agents.")
    .configureOutput({
      writeOut: (text) => io.write(text.trimEnd()),
      writeErr: (text) => io.write(text.trimEnd())
    })
    .exitOverride()
    .showHelpAfterError();

  program
    .command("index")
    .argument("<target>", "target repository or directory")
    .option("--source-only", "skip tests and tools while indexing")
    .action(async (target: string, options: { sourceOnly?: boolean }) => {
      const stats = await indexTarget(target, { includeSupportCode: !options.sourceOnly });
      const mode = options.sourceOnly ? "source-only" : "all-files";
      io.write(
        `Indexed ${stats.files} files, ${stats.symbols} symbols, ${stats.chunks} chunks, ${stats.edges} edges at ${stats.indexPath} (mode: ${mode})`
      );
    });

  program
    .command("query")
    .argument("<question>", "natural-language code question")
    .requiredOption("--target <target>", "target repository or directory")
    .option("--limit <limit>", "maximum result count", "5")
    .option("--mode <mode>", "query mode: symbol, fts, or hybrid", "symbol")
    .action(async (question: string, options: { target: string; limit: string; mode: string }) => {
      const mode = parseMode(options.mode);
      const response = await queryIndex(question, {
        target: options.target,
        limit: Number.parseInt(options.limit, 10),
        mode
      });
      io.write(JSON.stringify(response, null, 2));
    });

  program
    .command("benchmark")
    .argument("<benchmark-json>", "golden benchmark file")
    .requiredOption("--target <target>", "target repository or directory")
    .option("--mode <mode>", "benchmark mode: symbol, fts, or hybrid", "symbol")
    .option("--json", "write full benchmark result as JSON")
    .action(async (benchmarkJson: string, options: { target: string; mode: string; json?: boolean }) => {
      const mode = parseMode(options.mode);
      const result = await runBenchmark(benchmarkJson, { target: options.target, mode });
      io.write(options.json ? JSON.stringify(result, null, 2) : formatBenchmark(result));
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return;
    }
    throw error;
  }
}

function formatBenchmark(result: Awaited<ReturnType<typeof runBenchmark>>): string {
  return [
    `Mode: ${result.mode}`,
    `Questions: ${result.questions}`,
    `Symbol Hit@1: ${result.symbolHitAt1.toFixed(2)}`,
    `Symbol Hit@5: ${result.symbolHitAt5.toFixed(2)}`,
    `Symbol MRR: ${result.symbolMrr.toFixed(2)}`,
    `File Hit@1: ${result.fileHitAt1.toFixed(2)}`,
    `File Hit@5: ${result.fileHitAt5.toFixed(2)}`,
    `File MRR: ${result.fileMrr.toFixed(2)}`,
    `Partial file hits: ${result.partialFileHits.toFixed(2)}`,
    `Avg latency: ${Math.round(result.avgLatencyMs)}ms`
  ].join("\n");
}

function parseMode(mode: string): QueryMode {
  if (mode === "symbol" || mode === "fts" || mode === "hybrid") {
    return mode;
  }
  throw new Error(`Invalid mode: ${mode}. Expected "symbol", "fts", or "hybrid".`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
