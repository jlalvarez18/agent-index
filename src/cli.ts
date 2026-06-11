#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { runBenchmark } from "./core/benchmark.js";
import { indexTarget } from "./core/indexer.js";
import { queryIndex } from "./core/query.js";

export interface CliIO {
  write: (line: string) => void;
}

export async function runCli(argv: string[], io: CliIO = { write: console.log }): Promise<void> {
  const program = new Command();
  program
    .name("agent-index")
    .description("Symbol-first local code index prototype for coding agents.")
    .exitOverride()
    .showHelpAfterError();

  program
    .command("index")
    .argument("<target>", "target repository or directory")
    .option("--source-only", "skip tests and tools while indexing")
    .action(async (target: string, options: { sourceOnly?: boolean }) => {
      const stats = await indexTarget(target, { includeSupportCode: !options.sourceOnly });
      io.write(
        `Indexed ${stats.files} files, ${stats.symbols} symbols, ${stats.chunks} chunks, ${stats.edges} edges at ${stats.indexPath}`
      );
    });

  program
    .command("query")
    .argument("<question>", "natural-language code question")
    .requiredOption("--target <target>", "target repository or directory")
    .option("--limit <limit>", "maximum result count", "5")
    .action(async (question: string, options: { target: string; limit: string }) => {
      const response = await queryIndex(question, {
        target: options.target,
        limit: Number.parseInt(options.limit, 10)
      });
      io.write(JSON.stringify(response, null, 2));
    });

  program
    .command("benchmark")
    .argument("<benchmark-json>", "golden benchmark file")
    .requiredOption("--target <target>", "target repository or directory")
    .action(async (benchmarkJson: string, options: { target: string }) => {
      const result = await runBenchmark(benchmarkJson, { target: options.target });
      io.write(formatBenchmark(result));
    });

  await program.parseAsync(argv, { from: "user" });
}

function formatBenchmark(result: Awaited<ReturnType<typeof runBenchmark>>): string {
  return [
    `Questions: ${result.questions}`,
    `Hit@1: ${result.hitAt1.toFixed(2)}`,
    `Hit@5: ${result.hitAt5.toFixed(2)}`,
    `MRR: ${result.mrr.toFixed(2)}`,
    `Partial file hits: ${result.partialFileHits.toFixed(2)}`,
    `Avg latency: ${Math.round(result.avgLatencyMs)}ms`
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
