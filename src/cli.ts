#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAgentEval } from "./core/agent-eval.js";
import { runBenchmark } from "./core/benchmark.js";
import { findFileClusters } from "./core/file-clusters.js";
import { indexTarget } from "./core/indexer.js";
import { compareNavigationArtifacts } from "./core/navigation-artifacts.js";
import type { NavigationArtifactCompareResult } from "./core/navigation-artifacts.js";
import { runNavigationEval } from "./core/navigation-eval.js";
import { runNavigationSuite } from "./core/navigation-suite.js";
import { queryAgentIndex, queryIndex } from "./core/query.js";
import { findRelatedTests } from "./core/related-tests.js";
import { findSourceTests } from "./core/source-tests.js";
import { appendLessonTrace, appendQueryTrace, buildTraceReport, formatTraceReport } from "./core/tracing.js";
import type {
  AgentEvalResult,
  AgentQuery,
  BenchmarkQueryStyle,
  FileClusterResult,
  FileRole,
  NavigationEvalResult,
  NavigationSuiteResult,
  QueryResponse,
  QueryExpansion,
  QueryMode,
  RgBaselineKind,
  SourceTestsResult,
  SymbolKind
} from "./core/schema.js";

export interface CliIO {
  write: (line: string) => void;
}

export async function runCli(argv: string[], io: CliIO = { write: console.log }): Promise<void> {
  suggestQuerySubcommand(argv);

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
    .option("--index-path <path>", "SQLite index path")
    .action(async (target: string, options: { sourceOnly?: boolean; indexPath?: string }) => {
      const stats = await indexTarget(target, { includeSupportCode: !options.sourceOnly, indexPath: options.indexPath });
      const mode = options.sourceOnly ? "source-only" : "all-files";
      io.write(
        `Indexed ${stats.files} files, ${stats.symbols} symbols, ${stats.chunks} chunks, ${stats.edges} edges at ${stats.indexPath} (mode: ${mode})`
      );
    });

  program
    .command("query")
    .argument("[query]", "free-text lexical query; omit when --agent-query is provided")
    .option("--target <target>", "target repository or directory")
    .option("--repo <target>", "alias for --target")
    .option("--agent-query <json>", "structured agent query JSON")
    .option("--index-path <path>", "SQLite index path")
    .option("--index <path>", "alias for --index-path")
    .option("--db <path>", "alias for --index-path")
    .option("--term <term>", "structured query term; repeat or comma-separate", collectOption, [])
    .option("--kind <kind>", "symbol kind: function, method, class, or module; repeat or comma-separate", collectOption, [])
    .option("--path <hint>", "path hint; repeat or comma-separate", collectOption, [])
    .option("--path-filter", "treat --path values as hard file-path filters instead of ranking hints")
    .option("--role <role>", "file role: source, test, docs, example, fixture, tool, or benchmark; repeat or comma-separate", collectOption, [])
    .option("--expand <relation>", "graph expansion: callers, callees, imports, parents, or children; repeat or comma-separate", collectOption, [])
    .option("--exclude-support-code", "filter tests, docs, examples, fixtures, and tools from structured results")
    .option("--limit <limit>", "maximum result count", "5")
    .option("--mode <mode>", "query mode: symbol, fts, or hybrid", "symbol")
    .option("--format <format>", "query output format: json or compact", "json")
    .option("--debug", "include ranking diagnostics in query JSON")
    .option("--trace <path>", "append a dogfood trace event to a JSONL file")
    .option("--trace-task <id>", "dogfood trace task id")
    .action(
      async (
        query: string | undefined,
        options: {
          target?: string;
          repo?: string;
          agentQuery?: string;
          indexPath?: string;
          index?: string;
          db?: string;
          term?: string[];
          kind?: string[];
          path?: string[];
          pathFilter?: boolean;
          role?: string[];
          expand?: string[];
          excludeSupportCode?: boolean;
          limit: string;
          mode: string;
          format: string;
          debug?: boolean;
          trace?: string;
          traceTask?: string;
        }
      ) => {
      const mode = parseMode(options.mode);
      const format = parseQueryFormat(options.format);
      const target = parseTargetPath(options.target, options.repo);
      const baseOptions = {
        target,
        indexPath: parseIndexPath(options.indexPath, options.index, options.db),
        limit: Number.parseInt(options.limit, 10),
        mode,
        debug: Boolean(options.debug)
      };
      const shorthandQuery = parseShorthandAgentQuery(query, options);
      const agentQuery = options.agentQuery ? parseAgentQueryWithoutShorthand(options.agentQuery, shorthandQuery) : shorthandQuery;
      const startedAt = Date.now();
      const response = agentQuery
        ? await queryAgentIndex(agentQuery, baseOptions)
        : await queryIndex(requiredQuery(query), baseOptions);
      const latencyMs = Date.now() - startedAt;
      if (options.trace) {
        await appendQueryTrace({
          tracePath: options.trace,
          taskId: options.traceTask,
          target,
          indexPath: baseOptions.indexPath,
          mode,
          queryText: query,
          agentQuery,
          response,
          latencyMs,
          excludeSupportCode: Boolean(agentQuery?.excludeSupportCode)
        });
      }
      io.write(format === "json" ? JSON.stringify(response, null, 2) : formatQueryCompact(response));
      }
    );

  program
    .command("file-clusters")
    .argument("[query]", "free-text query refined by shorthand flags")
    .requiredOption("--target <target>", "target repository or directory")
    .option("--agent-query <json>", "structured agent query JSON")
    .option("--index-path <path>", "SQLite index path")
    .option("--term <term>", "structured query term; repeat or comma-separate", collectOption, [])
    .option("--kind <kind>", "symbol kind: function, method, class, or module; repeat or comma-separate", collectOption, [])
    .option("--path <hint>", "path hint; repeat or comma-separate", collectOption, [])
    .option("--path-filter", "treat --path values as hard file-path filters instead of ranking hints")
    .option("--role <role>", "file role: source, test, docs, example, fixture, tool, or benchmark; repeat or comma-separate", collectOption, [])
    .option("--exclude-support-code", "filter tests, docs, examples, fixtures, and tools from structured results")
    .option("--limit <limit>", "maximum file clusters to return", "8")
    .option("--json", "write full file-cluster result as JSON")
    .action(
      (
        query: string | undefined,
        options: {
          target: string;
          agentQuery?: string;
          indexPath?: string;
          term?: string[];
          kind?: string[];
          path?: string[];
          pathFilter?: boolean;
          role?: string[];
          excludeSupportCode?: boolean;
          limit: string;
          json?: boolean;
        }
      ) => {
        const shorthandQuery = parseShorthandAgentQuery(query, { ...options, expand: [] });
        const agentQuery = options.agentQuery ? parseAgentQueryWithoutShorthand(options.agentQuery, shorthandQuery) : shorthandQuery;
        if (!agentQuery) {
          throw new Error("Missing query. Provide a query, --agent-query JSON, or shorthand flags such as --term semantic --term cache.");
        }
        const result = findFileClusters(agentQuery, {
          target: options.target,
          indexPath: options.indexPath,
          limit: Number.parseInt(options.limit, 10)
        });
        io.write(options.json ? JSON.stringify(result, null, 2) : formatFileClusters(result));
      }
    );

  program
    .command("source-tests")
    .argument("[query]", "free-text query refined by shorthand flags")
    .requiredOption("--target <target>", "target repository or directory")
    .option("--agent-query <json>", "structured agent query JSON")
    .option("--index-path <path>", "SQLite index path")
    .option("--term <term>", "structured query term; repeat or comma-separate", collectOption, [])
    .option("--kind <kind>", "symbol kind: function, method, class, or module; repeat or comma-separate", collectOption, [])
    .option("--path <hint>", "path hint; repeat or comma-separate", collectOption, [])
    .option("--path-filter", "treat --path values as hard file-path filters instead of ranking hints")
    .option("--role <role>", "file role: source, test, docs, example, fixture, tool, or benchmark; repeat or comma-separate", collectOption, [])
    .option("--exclude-support-code", "filter tests, docs, examples, fixtures, and tools from structured results")
    .option("--limit <limit>", "maximum source file clusters to return", "5")
    .option("--test-limit <limit>", "maximum related test files per source", "2")
    .option("--test-fanout-limit <limit>", "maximum source clusters to use for related-test fanout")
    .option("--json", "write full source-tests result as JSON")
    .action(
      (
        query: string | undefined,
        options: {
          target: string;
          agentQuery?: string;
          indexPath?: string;
          term?: string[];
          kind?: string[];
          path?: string[];
          pathFilter?: boolean;
          role?: string[];
          excludeSupportCode?: boolean;
          limit: string;
          testLimit: string;
          testFanoutLimit?: string;
          json?: boolean;
        }
      ) => {
        const shorthandQuery = parseShorthandAgentQuery(query, { ...options, expand: [] });
        const agentQuery = options.agentQuery ? parseAgentQueryWithoutShorthand(options.agentQuery, shorthandQuery) : shorthandQuery;
        if (!agentQuery) {
          throw new Error("Missing query. Provide a query, --agent-query JSON, or shorthand flags such as --term semantic --term cache.");
        }
        const result = findSourceTests(agentQuery, {
          target: options.target,
          indexPath: options.indexPath,
          limit: Number.parseInt(options.limit, 10),
          testLimit: Number.parseInt(options.testLimit, 10),
          testFanoutLimit: options.testFanoutLimit ? Number.parseInt(options.testFanoutLimit, 10) : undefined
        });
        io.write(options.json ? JSON.stringify(result, null, 2) : formatSourceTests(result));
      }
    );

  program
    .command("benchmark")
    .argument("<benchmark-json>", "golden benchmark file")
    .requiredOption("--target <target>", "target repository or directory")
    .option("--index-path <path>", "SQLite index path")
    .option("--mode <mode>", "benchmark mode: symbol, fts, or hybrid", "symbol")
    .option("--query-style <style>", "benchmark query style: question or agent", "question")
    .option("--include-rg-baseline", "include an rg-style lexical file baseline in benchmark results")
    .option("--baseline <kind>", "rg baseline kind: lexical or command", "lexical")
    .option("--json", "write full benchmark result as JSON")
    .option("--debug", "include ranking diagnostics in JSON benchmark matches")
    .option("--misses", "append concise top-one miss details to text output")
    .action(async (benchmarkJson: string, options: { target: string; indexPath?: string; mode: string; queryStyle: string; includeRgBaseline?: boolean; baseline: string; json?: boolean; debug?: boolean; misses?: boolean }) => {
      const mode = parseMode(options.mode);
      const queryStyle = parseQueryStyle(options.queryStyle);
      const rgBaselineKind = parseRgBaselineKind(options.baseline);
      const result = await runBenchmark(benchmarkJson, {
        target: options.target,
        indexPath: options.indexPath,
        mode,
        queryStyle,
        includeRgBaseline: Boolean(options.includeRgBaseline),
        rgBaselineKind,
        debug: Boolean(options.debug)
      });
      io.write(options.json ? JSON.stringify(result, null, 2) : formatBenchmark(result, Boolean(options.misses)));
    });

  program
    .command("agent-eval")
    .argument("<benchmark-json>", "golden benchmark file")
    .requiredOption("--target <target>", "target repository or directory")
    .option("--index-path <path>", "SQLite index path")
    .option("--mode <mode>", "agent-index mode: symbol, fts, or hybrid", "symbol")
    .option("--query-style <style>", "agent-index benchmark query style: question or agent", "question")
    .option("--graphify-results <path>", "JSON file with Graphify query text results")
    .option("--json", "write full comparison result as JSON")
    .option("--misses", "append concise non-tie comparison details to text output")
    .action(
      async (
        benchmarkJson: string,
        options: {
          target: string;
          indexPath?: string;
          mode: string;
          queryStyle: string;
          graphifyResults?: string;
          json?: boolean;
          misses?: boolean;
        }
      ) => {
        const mode = parseMode(options.mode);
        const queryStyle = parseQueryStyle(options.queryStyle);
        const result = await runAgentEval(benchmarkJson, {
          target: options.target,
          indexPath: options.indexPath,
          mode,
          queryStyle,
          graphifyResultsPath: options.graphifyResults
        });
      io.write(options.json ? JSON.stringify(result, null, 2) : formatAgentEval(result, Boolean(options.misses)));
      }
    );

  program
    .command("nav-eval")
    .argument("<navigation-eval-json>", "real-world navigation workflow evaluation file")
    .requiredOption("--target <target>", "target repository or directory")
    .option("--index-path <path>", "SQLite index path")
    .option("--mode <mode>", "agent-index query mode: symbol, fts, or hybrid", "hybrid")
    .option("--json", "write full navigation evaluation result as JSON")
    .option("--cases", "append per-case navigation results to text output")
    .action(
      async (
        navigationEvalJson: string,
        options: {
          target: string;
          indexPath?: string;
          mode: string;
          json?: boolean;
          cases?: boolean;
        }
      ) => {
        const result = await runNavigationEval(navigationEvalJson, {
          target: options.target,
          indexPath: options.indexPath,
          mode: parseMode(options.mode)
        });
        io.write(options.json ? JSON.stringify(result, null, 2) : formatNavigationEval(result, Boolean(options.cases)));
      }
    );

  program
    .command("nav-suite")
    .argument("<manifest-json>", "multi-repository navigation evaluation manifest")
    .option("--mode <mode>", "override agent-index query mode for every suite entry: symbol, fts, or hybrid")
    .option("--reindex", "rebuild each suite entry index before running navigation evals")
    .option("--repo-root <path>", "resolve relative suite targets under this local repository root")
    .option("--index-root <path>", "write default suite index files under this directory")
    .option("--artifacts-dir <path>", "write navigation suite summary and per-repository JSON artifacts")
    .option("--json", "write full navigation suite result as JSON")
    .option("--repos", "append per-repository results to text output")
    .action(
      async (
        manifestJson: string,
        options: {
          mode?: string;
          reindex?: boolean;
          repoRoot?: string;
          indexRoot?: string;
          artifactsDir?: string;
          json?: boolean;
          repos?: boolean;
        }
      ) => {
        const result = await runNavigationSuite(manifestJson, {
          mode: options.mode ? parseMode(options.mode) : undefined,
          reindex: Boolean(options.reindex),
          repoRoot: options.repoRoot,
          indexRoot: options.indexRoot,
          artifactsDir: options.artifactsDir
        });
        io.write(options.json ? JSON.stringify(result, null, 2) : formatNavigationSuite(result, Boolean(options.repos)));
      }
    );

  program
    .command("nav-compare")
    .argument("<baseline>", "baseline navigation artifact directory or summary.json")
    .argument("<current>", "current navigation artifact directory or summary.json")
    .option("--max-agent-token-increase <tokens>", "allowed absolute increase in average agent-index context tokens", "0")
    .option("--max-agent-token-increase-percent <percent>", "allowed percentage increase in average agent-index context tokens", "0")
    .option("--max-agent-latency-increase-ms <ms>", "allowed absolute increase in average agent-index latency")
    .option("--max-agent-latency-increase-percent <percent>", "allowed percentage increase in average agent-index latency")
    .option("--require-agent-dominance", "fail unless current agent-index results beat rg and optimized rg on completion, wins, and context tokens")
    .option("--json", "write full comparison result as JSON")
    .action(
      async (
        baseline: string,
        current: string,
        options: {
          maxAgentTokenIncrease: string;
          maxAgentTokenIncreasePercent: string;
          maxAgentLatencyIncreaseMs?: string;
          maxAgentLatencyIncreasePercent?: string;
          requireAgentDominance?: boolean;
          json?: boolean;
        }
      ) => {
        const result = await compareNavigationArtifacts(baseline, current, {
          maxAgentTokenIncrease: parseNonNegativeNumber(options.maxAgentTokenIncrease, "--max-agent-token-increase"),
          maxAgentTokenIncreasePercent: parseNonNegativeNumber(
            options.maxAgentTokenIncreasePercent,
            "--max-agent-token-increase-percent"
          ),
          maxAgentLatencyIncreaseMs:
            options.maxAgentLatencyIncreaseMs === undefined
              ? undefined
              : parseNonNegativeNumber(options.maxAgentLatencyIncreaseMs, "--max-agent-latency-increase-ms"),
          maxAgentLatencyIncreasePercent:
            options.maxAgentLatencyIncreasePercent === undefined
              ? undefined
              : parseNonNegativeNumber(options.maxAgentLatencyIncreasePercent, "--max-agent-latency-increase-percent"),
          requireAgentDominance: Boolean(options.requireAgentDominance)
        });
        io.write(options.json ? JSON.stringify(result, null, 2) : formatNavigationArtifactComparison(result));
        if (!result.passed) {
          throw new Error(`Navigation artifact comparison failed with ${result.regressions.length} regression(s).`);
        }
      }
    );

  program
    .command("related-tests")
    .requiredOption("--target <target>", "target repository or directory")
    .requiredOption("--source <file>", "source file path relative to the target repository; repeat or comma-separate", collectOption, [])
    .option("--symbol <symbol>", "source symbol name or qualified name")
    .option("--term <term>", "task term for test disambiguation; repeat or comma-separate", collectOption, [])
    .option("--index-path <path>", "SQLite index path")
    .option("--limit <limit>", "maximum test files to return", "5")
    .option("--json", "write full related-tests result as JSON")
    .action(
      (options: {
        target: string;
        source: string[];
        symbol?: string;
        term?: string[];
        indexPath?: string;
        limit: string;
        json?: boolean;
      }) => {
        const sourceFiles = splitOptionValues(options.source);
        if (sourceFiles.length === 0) {
          throw new Error("Missing --source. Provide at least one source file path relative to the target repository.");
        }
        const result = findRelatedTests({
          target: options.target,
          indexPath: options.indexPath,
          sourceFile: sourceFiles[0],
          sourceFiles,
          symbol: options.symbol,
          terms: splitOptionValues(options.term),
          limit: Number.parseInt(options.limit, 10)
        });
        io.write(options.json ? JSON.stringify(result, null, 2) : formatRelatedTests(result));
      }
    );

  program
    .command("trace-note")
    .argument("<trace-jsonl>", "dogfood trace JSONL file")
    .requiredOption("--task <id>", "dogfood trace task id")
    .requiredOption("--lesson <text>", "lesson learned from the dogfood test")
    .requiredOption("--next-step <text>", "recommended next step after the dogfood test")
    .option("--evidence <text>", "short evidence supporting the lesson")
    .action(
      async (
        traceJsonl: string,
        options: {
          task: string;
          lesson: string;
          nextStep: string;
          evidence?: string;
        }
      ) => {
        await appendLessonTrace({
          tracePath: traceJsonl,
          taskId: options.task,
          lesson: options.lesson,
          nextStep: options.nextStep,
          evidence: options.evidence
        });
        io.write(`Appended lesson to ${traceJsonl}`);
      }
    );

  program
    .command("trace-report")
    .argument("<trace-jsonl>", "dogfood trace JSONL file")
    .action(async (traceJsonl: string) => {
      io.write(formatTraceReport(await buildTraceReport(traceJsonl)));
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

function formatBenchmark(result: Awaited<ReturnType<typeof runBenchmark>>, includeMisses = false): string {
  const lines = [
    `Mode: ${result.mode}`,
    `Query style: ${result.queryStyle}`,
    `Questions: ${result.questions}`,
    `Symbol Hit@1: ${result.symbolHitAt1.toFixed(2)}`,
    `Symbol Hit@5: ${result.symbolHitAt5.toFixed(2)}`,
    `Symbol MRR: ${result.symbolMrr.toFixed(2)}`,
    `File Hit@1: ${result.fileHitAt1.toFixed(2)}`,
    `File Hit@5: ${result.fileHitAt5.toFixed(2)}`,
    `File MRR: ${result.fileMrr.toFixed(2)}`,
    `Partial file hits: ${result.partialFileHits.toFixed(2)}`,
    `Avg latency: ${Math.round(result.avgLatencyMs)}ms`,
    `Avg context tokens: ${Math.round(result.avgContextTokens)}`
  ];

  if (result.rgBaseline) {
    const label = result.rgBaseline.baselineKind === "command" ? "real rg" : "rg-style";
    lines.push(
      `${label} File Hit@1: ${result.rgBaseline.fileHitAt1.toFixed(2)}`,
      `${label} File Hit@5: ${result.rgBaseline.fileHitAt5.toFixed(2)}`,
      `${label} File MRR: ${result.rgBaseline.fileMrr.toFixed(2)}`,
      `${label} Avg latency: ${Math.round(result.rgBaseline.avgLatencyMs)}ms`,
      `${label} Avg context tokens: ${Math.round(result.rgBaseline.avgContextTokens)}`
    );
  }

  if (includeMisses) {
    lines.push("", ...formatBenchmarkMisses(result));
  }

  return lines.join("\n");
}

function formatQueryCompact(response: QueryResponse): string {
  if (response.matches.length === 0) {
    return "No matches";
  }

  return response.matches
    .map(
      (match, index) =>
        `${index + 1} ${match.file}:${match.lines[0]}-${match.lines[1]} ${match.kind} ${match.symbol}${formatEvidence(match.evidence)}`
    )
    .join("\n");
}

function formatFileClusters(result: FileClusterResult): string {
  if (result.clusters.length === 0) {
    return "No file clusters";
  }

  return result.clusters
    .map((cluster, index) => {
      const symbols = cluster.symbols.slice(0, 2).map((symbol) => `${symbol.kind} ${symbol.name}:${symbol.lines[0]}`).join("; ");
      return `${index + 1} ${cluster.file} role=${cluster.role} chunks=${cluster.matchedChunks} symbols=${symbols}${formatEvidence(cluster.evidence)}`;
    })
    .join("\n");
}

function formatSourceTests(result: SourceTestsResult): string {
  if (result.bundles.length === 0) {
    return "No source/test bundles";
  }

  return result.bundles
    .map((bundle, index) => {
      const sourceSymbol = bundle.source.symbols[0];
      const source = sourceSymbol ? `${bundle.source.file}:${sourceSymbol.lines[0]} ${sourceSymbol.name}` : bundle.source.file;
      const tests = bundle.tests
        .slice(0, 2)
        .map((test) => `${test.file}${test.firstLine === null ? "" : `:${test.firstLine}`}`)
        .join(", ");
      return `${index + 1} ${source}${tests ? ` -> ${tests}` : ""}`;
    })
    .join("\n");
}

function formatAgentEval(result: AgentEvalResult, includeMisses = false): string {
  const lines = [
    `Mode: ${result.mode}`,
    `Query style: ${result.agentIndex.queryStyle}`,
    `Questions: ${result.questions}`,
    `agent-index Symbol Hit@1: ${result.agentIndex.symbolHitAt1.toFixed(2)}`,
    `agent-index Symbol Hit@5: ${result.agentIndex.symbolHitAt5.toFixed(2)}`,
    `agent-index File Hit@1: ${result.agentIndex.fileHitAt1.toFixed(2)}`,
    `agent-index File Hit@5: ${result.agentIndex.fileHitAt5.toFixed(2)}`
  ];

  if (result.graphify) {
    lines.push(
      `Graphify symbol mention rate: ${result.graphify.symbolMentionRate.toFixed(2)}`,
      `Graphify file mention rate: ${result.graphify.fileMentionRate.toFixed(2)}`
    );
  } else {
    lines.push("Graphify results: not provided");
  }

  if (includeMisses) {
    lines.push("", ...formatAgentEvalMisses(result));
  }

  return lines.join("\n");
}

function formatAgentEvalMisses(result: AgentEvalResult): string[] {
  const nonTies = result.cases.filter((benchmarkCase) => benchmarkCase.winner !== "tie");
  if (nonTies.length === 0) {
    return ["Comparison misses: none"];
  }

  return [
    "Comparison misses:",
    ...nonTies.map((benchmarkCase) =>
      [
        benchmarkCase.id,
        `agentSymbolRank=${formatRank(benchmarkCase.agentIndexSymbolRank)}`,
        `agentFileRank=${formatRank(benchmarkCase.agentIndexFileRank)}`,
        `graphifySymbol=${formatMention(benchmarkCase.graphifySymbolMention)}`,
        `graphifyFile=${formatMention(benchmarkCase.graphifyFileMention)}`,
        `winner=${benchmarkCase.winner}`
      ].join("  ")
    )
  ];
}

function formatNavigationEval(result: NavigationEvalResult, includeCases = false): string {
  const lines = [
    `Cases: ${result.cases}`,
    `agent-index useful rate: ${result.agentIndexUsefulRate.toFixed(2)}`,
    `rg broad useful rate: ${result.rgUsefulRate.toFixed(2)}`,
    `rg optimized useful rate: ${result.rgOptimizedUsefulRate.toFixed(2)}`,
    `agent-index completion rate: ${result.agentIndexCompletionRate.toFixed(2)}`,
    `rg broad completion rate: ${result.rgCompletionRate.toFixed(2)}`,
    `rg optimized completion rate: ${result.rgOptimizedCompletionRate.toFixed(2)}`,
    `agent-index avg commands: ${result.agentIndexAvgCommands.toFixed(2)}`,
    `rg broad avg commands: ${result.rgAvgCommands.toFixed(2)}`,
    `rg optimized avg commands: ${result.rgOptimizedAvgCommands.toFixed(2)}`,
    `agent-index avg latency: ${Math.round(result.agentIndexAvgLatencyMs)}ms`,
    `rg broad avg latency: ${Math.round(result.rgAvgLatencyMs)}ms`,
    `rg optimized avg latency: ${Math.round(result.rgOptimizedAvgLatencyMs)}ms`,
    `agent-index avg first useful latency: ${Math.round(result.agentIndexAvgFirstUsefulLatencyMs)}ms`,
    `rg broad avg first useful latency: ${Math.round(result.rgAvgFirstUsefulLatencyMs)}ms`,
    `rg optimized avg first useful latency: ${Math.round(result.rgOptimizedAvgFirstUsefulLatencyMs)}ms`,
    `agent-index avg completion latency: ${Math.round(result.agentIndexAvgCompletionLatencyMs)}ms`,
    `rg broad avg completion latency: ${Math.round(result.rgAvgCompletionLatencyMs)}ms`,
    `rg optimized avg completion latency: ${Math.round(result.rgOptimizedAvgCompletionLatencyMs)}ms`,
    `agent-index avg context tokens: ${Math.round(result.agentIndexAvgContextTokens)}`,
    `rg broad avg context tokens: ${Math.round(result.rgAvgContextTokens)}`,
    `rg optimized avg context tokens: ${Math.round(result.rgOptimizedAvgContextTokens)}`,
    `agent-index avg first useful context tokens: ${Math.round(result.agentIndexAvgFirstUsefulContextTokens)}`,
    `rg broad avg first useful context tokens: ${Math.round(result.rgAvgFirstUsefulContextTokens)}`,
    `rg optimized avg first useful context tokens: ${Math.round(result.rgOptimizedAvgFirstUsefulContextTokens)}`,
    `agent-index avg completion context tokens: ${Math.round(result.agentIndexAvgCompletionContextTokens)}`,
    `rg broad avg completion context tokens: ${Math.round(result.rgAvgCompletionContextTokens)}`,
    `rg optimized avg completion context tokens: ${Math.round(result.rgOptimizedAvgCompletionContextTokens)}`,
    `avg broad rg token savings: ${Math.round(result.avgTokenSavings)}`,
    `avg optimized rg token savings: ${Math.round(result.avgOptimizedRgTokenSavings)}`,
    `agent-index wins vs broad rg: ${result.agentIndexWins}`,
    `broad rg wins: ${result.rgWins}`,
    `agent-index wins vs optimized rg: ${result.agentIndexWinsVsOptimizedRg}`,
    `optimized rg wins: ${result.rgOptimizedWins}`,
    `broad rg ties: ${result.ties}`,
    `optimized rg ties: ${result.optimizedRgTies}`,
    `inconclusive: ${result.inconclusive + result.optimizedRgInconclusive}`
  ];

  if (includeCases) {
    lines.push(
      "",
      "Cases:",
      ...result.caseResults.map((navigationCase) =>
        [
          navigationCase.id,
          `winner=${navigationCase.winner}`,
          `optimizedWinner=${navigationCase.optimizedRgWinner}`,
          `agentTokens=${navigationCase.agentIndex.contextTokens}`,
          `rgTokens=${navigationCase.rg.contextTokens}`,
          `rgOptimizedTokens=${navigationCase.rgOptimized.contextTokens}`,
          `savings=${navigationCase.tokenSavings}`,
          `optimizedSavings=${navigationCase.optimizedRgTokenSavings}`,
          `agentComplete=${navigationCase.agentIndex.taskComplete ? "yes" : "no"}`,
          `rgComplete=${navigationCase.rg.taskComplete ? "yes" : "no"}`,
          `rgOptimizedComplete=${navigationCase.rgOptimized.taskComplete ? "yes" : "no"}`,
          `agentUseful=${formatRank(navigationCase.agentIndex.firstUsefulCommand)}`,
          `rgUseful=${formatRank(navigationCase.rg.firstUsefulCommand)}`,
          `rgOptimizedUseful=${formatRank(navigationCase.rgOptimized.firstUsefulCommand)}`,
          `agentFirstUsefulMs=${formatLatency(navigationCase.agentIndex.firstUsefulLatencyMs)}`,
          `agentFirstUsefulTokens=${formatTokens(navigationCase.agentIndex.firstUsefulContextTokens)}`,
          `agentCompleteCommand=${formatRank(navigationCase.agentIndex.completionCommand)}`,
          `agentCompleteMs=${formatLatency(navigationCase.agentIndex.completionLatencyMs)}`,
          `agentCompleteTokens=${formatTokens(navigationCase.agentIndex.completionContextTokens)}`
        ].join("  ")
      )
    );
  }

  return lines.join("\n");
}

function formatNavigationSuite(result: NavigationSuiteResult, includeRepos = false): string {
  const lines = [
    `Repos: ${result.repos}`,
    `Cases: ${result.cases}`,
    `agent-index useful rate: ${result.agentIndexUsefulRate.toFixed(2)}`,
    `rg broad useful rate: ${result.rgUsefulRate.toFixed(2)}`,
    `rg optimized useful rate: ${result.rgOptimizedUsefulRate.toFixed(2)}`,
    `agent-index completion rate: ${result.agentIndexCompletionRate.toFixed(2)}`,
    `rg broad completion rate: ${result.rgCompletionRate.toFixed(2)}`,
    `rg optimized completion rate: ${result.rgOptimizedCompletionRate.toFixed(2)}`,
    `agent-index avg commands: ${result.agentIndexAvgCommands.toFixed(2)}`,
    `rg broad avg commands: ${result.rgAvgCommands.toFixed(2)}`,
    `rg optimized avg commands: ${result.rgOptimizedAvgCommands.toFixed(2)}`,
    `agent-index avg latency: ${Math.round(result.agentIndexAvgLatencyMs)}ms`,
    `rg broad avg latency: ${Math.round(result.rgAvgLatencyMs)}ms`,
    `rg optimized avg latency: ${Math.round(result.rgOptimizedAvgLatencyMs)}ms`,
    `agent-index avg first useful latency: ${Math.round(result.agentIndexAvgFirstUsefulLatencyMs)}ms`,
    `rg broad avg first useful latency: ${Math.round(result.rgAvgFirstUsefulLatencyMs)}ms`,
    `rg optimized avg first useful latency: ${Math.round(result.rgOptimizedAvgFirstUsefulLatencyMs)}ms`,
    `agent-index avg completion latency: ${Math.round(result.agentIndexAvgCompletionLatencyMs)}ms`,
    `rg broad avg completion latency: ${Math.round(result.rgAvgCompletionLatencyMs)}ms`,
    `rg optimized avg completion latency: ${Math.round(result.rgOptimizedAvgCompletionLatencyMs)}ms`,
    `agent-index avg context tokens: ${Math.round(result.agentIndexAvgContextTokens)}`,
    `rg broad avg context tokens: ${Math.round(result.rgAvgContextTokens)}`,
    `rg optimized avg context tokens: ${Math.round(result.rgOptimizedAvgContextTokens)}`,
    `agent-index avg first useful context tokens: ${Math.round(result.agentIndexAvgFirstUsefulContextTokens)}`,
    `rg broad avg first useful context tokens: ${Math.round(result.rgAvgFirstUsefulContextTokens)}`,
    `rg optimized avg first useful context tokens: ${Math.round(result.rgOptimizedAvgFirstUsefulContextTokens)}`,
    `agent-index avg completion context tokens: ${Math.round(result.agentIndexAvgCompletionContextTokens)}`,
    `rg broad avg completion context tokens: ${Math.round(result.rgAvgCompletionContextTokens)}`,
    `rg optimized avg completion context tokens: ${Math.round(result.rgOptimizedAvgCompletionContextTokens)}`,
    `avg broad rg token savings: ${Math.round(result.avgTokenSavings)}`,
    `avg optimized rg token savings: ${Math.round(result.avgOptimizedRgTokenSavings)}`,
    `agent-index wins vs broad rg: ${result.agentIndexWins}`,
    `broad rg wins: ${result.rgWins}`,
    `agent-index wins vs optimized rg: ${result.agentIndexWinsVsOptimizedRg}`,
    `optimized rg wins: ${result.rgOptimizedWins}`,
    `broad rg ties: ${result.ties}`,
    `optimized rg ties: ${result.optimizedRgTies}`,
    `inconclusive: ${result.inconclusive + result.optimizedRgInconclusive}`
  ];

  if (includeRepos) {
    lines.push(
      "",
      "Repos:",
      ...result.repoResults.map((repo) =>
        [
          repo.name,
          `cases=${repo.result.cases}`,
          `agentComplete=${repo.result.agentIndexCompletionRate.toFixed(2)}`,
          `rgBroadComplete=${repo.result.rgCompletionRate.toFixed(2)}`,
          `rgOptimizedComplete=${repo.result.rgOptimizedCompletionRate.toFixed(2)}`,
          `agentTokens=${Math.round(repo.result.agentIndexAvgContextTokens)}`,
          `agentFirstUsefulMs=${Math.round(repo.result.agentIndexAvgFirstUsefulLatencyMs)}`,
          `agentFirstUsefulTokens=${Math.round(repo.result.agentIndexAvgFirstUsefulContextTokens)}`,
          `agentCompletionMs=${Math.round(repo.result.agentIndexAvgCompletionLatencyMs)}`,
          `agentCompletionTokens=${Math.round(repo.result.agentIndexAvgCompletionContextTokens)}`,
          `rgBroadTokens=${Math.round(repo.result.rgAvgContextTokens)}`,
          `rgOptimizedTokens=${Math.round(repo.result.rgOptimizedAvgContextTokens)}`,
          repo.indexStats ? `indexed=${repo.indexStats.files}files/${repo.indexStats.symbols}symbols` : "indexed=prebuilt",
          `agentWinsBroad=${repo.result.agentIndexWins}`,
          `agentWinsOptimized=${repo.result.agentIndexWinsVsOptimizedRg}`,
          `rgOptimizedWins=${repo.result.rgOptimizedWins}`
        ].join("  ")
      )
    );
  }

  return lines.join("\n");
}

function formatNavigationArtifactComparison(result: NavigationArtifactCompareResult): string {
  if (result.passed) {
    return [
      "Navigation artifact comparison: pass",
      `baseline: ${result.baselinePath}`,
      `current: ${result.currentPath}`
    ].join("\n");
  }

  return [
    "Navigation artifact comparison: fail",
    `baseline: ${result.baselinePath}`,
    `current: ${result.currentPath}`,
    "Regressions:",
    ...result.regressions.map((regression) => `- ${regression.message}`)
  ].join("\n");
}

function formatRelatedTests(result: ReturnType<typeof findRelatedTests>): string {
  if (result.matches.length === 0) {
    return `No related tests found for ${result.sourceFile}`;
  }

  return result.matches
    .map((match, index) => {
      const line = match.firstLine === null ? "" : `:${match.firstLine}`;
      return `${index + 1} ${match.file}${line} score=${match.score}`;
    })
    .join("\n");
}

function formatBenchmarkMisses(result: Awaited<ReturnType<typeof runBenchmark>>): string[] {
  const misses = result.cases.filter((benchmarkCase) => !benchmarkCase.symbolHitAt1);
  if (misses.length === 0) {
    return ["Misses: none"];
  }

  return [
    "Misses:",
    ...misses.map((benchmarkCase) => {
      const top = benchmarkCase.firstMatch;
      return [
        benchmarkCase.id,
        `symbolRank=${formatRank(benchmarkCase.symbolRank)}`,
        `fileRank=${formatRank(benchmarkCase.fileRank)}`,
        `top=${top?.symbol ?? "-"}`,
        `file=${top?.file ?? "-"}`
      ].join("  ");
    })
  ];
}

function formatRank(rank: number | null): string {
  return rank === null ? "-" : String(rank);
}

function formatLatency(latencyMs: number | null): string {
  return latencyMs === null ? "-" : String(Math.round(latencyMs));
}

function formatTokens(tokens: number | null): string {
  return tokens === null ? "-" : String(Math.round(tokens));
}

function formatEvidence(evidence: string | undefined): string {
  return evidence ? ` evidence=${JSON.stringify(evidence)}` : "";
}

function formatMention(mention: boolean | null): string {
  if (mention === null) {
    return "-";
  }
  return mention ? "yes" : "no";
}

function parseMode(mode: string): QueryMode {
  if (mode === "symbol" || mode === "fts" || mode === "hybrid") {
    return mode;
  }
  throw new Error(`Invalid mode: ${mode}. Expected "symbol", "fts", or "hybrid".`);
}

function parseQueryStyle(style: string): BenchmarkQueryStyle {
  if (style === "question" || style === "agent") {
    return style;
  }
  throw new Error(`Invalid query style: ${style}. Expected "question" or "agent".`);
}

function parseQueryFormat(format: string): "json" | "compact" {
  if (format === "json" || format === "compact") {
    return format;
  }
  throw new Error(`Invalid query format: ${format}. Expected "json" or "compact".`);
}

function parsePathMode(mode: string): "hint" | "filter" {
  if (mode === "hint" || mode === "filter") {
    return mode;
  }
  throw new Error(`Invalid pathMode value: ${mode}. Expected "hint" or "filter".`);
}

function parseRgBaselineKind(kind: string): RgBaselineKind {
  if (kind === "lexical" || kind === "command") {
    return kind;
  }
  throw new Error(`Invalid baseline kind: ${kind}. Expected "lexical" or "command".`);
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseTargetPath(target: string | undefined, repoAlias: string | undefined): string {
  if (target && repoAlias && target !== repoAlias) {
    throw new Error(`Conflicting target paths: --target ${target} and --repo ${repoAlias}.`);
  }
  const resolvedTarget = target ?? repoAlias;
  if (!resolvedTarget) {
    throw new Error("Missing target. Provide --target <target> or --repo <target>.");
  }
  return resolvedTarget;
}

function parseIndexPath(
  indexPath: string | undefined,
  indexAlias: string | undefined,
  dbAlias: string | undefined
): string | undefined {
  const values = [
    { flag: "--index-path", value: indexPath },
    { flag: "--index", value: indexAlias },
    { flag: "--db", value: dbAlias }
  ].filter((entry): entry is { flag: string; value: string } => entry.value !== undefined);

  for (let index = 0; index < values.length; index++) {
    for (let nextIndex = index + 1; nextIndex < values.length; nextIndex++) {
      const left = values[index];
      const right = values[nextIndex];
      if (left.value !== right.value) {
        throw new Error(`Conflicting index paths: ${left.flag} ${left.value} and ${right.flag} ${right.value}.`);
      }
    }
  }

  return indexPath ?? indexAlias ?? dbAlias;
}

function requiredQuery(query: string | undefined): string {
  if (!query) {
    throw new Error("Missing query. Provide a free-text query argument, --agent-query JSON, or shorthand flags such as --term semantic --term cache.");
  }
  return query;
}

function parseAgentQueryWithoutShorthand(json: string, shorthandQuery: AgentQuery | undefined): AgentQuery {
  if (shorthandQuery) {
    throw new Error("Use either --agent-query JSON or shorthand query flags, not both.");
  }
  return parseAgentQuery(json);
}

function parseAgentQuery(json: string): AgentQuery {
  let parsed: Partial<AgentQuery> & { query?: unknown };
  try {
    parsed = JSON.parse(json) as Partial<AgentQuery> & { query?: unknown };
  } catch (error) {
    throw new Error(
      `Invalid --agent-query JSON: expected {"terms":["semantic","cache"]}. Shorthand equivalent: --term semantic --term cache`
    );
  }
  if ("query" in parsed && typeof parsed.query === "string" && !("terms" in parsed)) {
    const terms = splitWords(parsed.query);
    throw new Error(
      `Invalid --agent-query JSON: use {"terms":[${terms.map((term) => JSON.stringify(term)).join(",")}]}, not {"query":${JSON.stringify(
        parsed.query
      )}}. Shorthand equivalent: ${terms.map((term) => `--term ${term}`).join(" ")}`
    );
  }
  if (!Array.isArray(parsed.terms) || parsed.terms.some((term) => typeof term !== "string")) {
    throw new Error(
      `Invalid --agent-query JSON: expected {"terms":["semantic","cache"]}. Shorthand equivalent: --term semantic --term cache`
    );
  }
  const agentQuery = parsed as AgentQuery;
  if (agentQuery.roles && agentQuery.excludeSupportCode) {
    throw new Error("Use either --role or --exclude-support-code, not both.");
  }
  return {
    ...agentQuery,
    symbolKinds: agentQuery.symbolKinds ? parseSymbolKinds(agentQuery.symbolKinds) : undefined,
    pathMode: agentQuery.pathMode ? parsePathMode(agentQuery.pathMode) : undefined,
    roles: agentQuery.roles ? parseFileRoles(agentQuery.roles) : undefined,
    expand: agentQuery.expand ? parseExpansions(agentQuery.expand) : undefined
  };
}

function parseShorthandAgentQuery(query: string | undefined, options: {
  term?: string[];
  kind?: string[];
  path?: string[];
  pathFilter?: boolean;
  role?: string[];
  expand?: string[];
  excludeSupportCode?: boolean;
}): AgentQuery | undefined {
  const optionTerms = splitOptionValues(options.term);
  const kinds = splitOptionValues(options.kind);
  const pathHints = splitOptionValues(options.path);
  const roles = splitOptionValues(options.role);
  const expand = splitOptionValues(options.expand);
  const hasShorthand =
    optionTerms.length > 0 ||
    kinds.length > 0 ||
    pathHints.length > 0 ||
    Boolean(options.pathFilter) ||
    roles.length > 0 ||
    expand.length > 0 ||
    Boolean(options.excludeSupportCode);

  if (!hasShorthand) {
    return undefined;
  }

  const terms = uniqueValues([...splitWords(query ?? ""), ...optionTerms]);

  if (terms.length === 0) {
    throw new Error("Missing --term for shorthand query mode. Example: --term semantic --term cache");
  }

  if (roles.length > 0 && options.excludeSupportCode) {
    throw new Error("Use either --role or --exclude-support-code, not both.");
  }

  return {
    terms,
    symbolKinds: kinds.length > 0 ? parseSymbolKinds(kinds) : undefined,
    pathHints: pathHints.length > 0 ? pathHints : undefined,
    pathMode: options.pathFilter ? "filter" : undefined,
    roles: roles.length > 0 ? parseFileRoles(roles) : undefined,
    excludeSupportCode: Boolean(options.excludeSupportCode),
    expand: expand.length > 0 ? parseExpansions(expand) : undefined
  };
}

function splitOptionValues(values: string[] | undefined): string[] {
  return (values ?? []).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

function splitWords(value: string): string[] {
  return value.split(/\s+/).map((term) => term.trim()).filter(Boolean);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function parseSymbolKinds(values: string[]): SymbolKind[] {
  const allowed: SymbolKind[] = ["function", "method", "class", "module"];
  return values.map((value) => {
    if (!allowed.includes(value as SymbolKind)) {
      throw new Error(`Invalid --kind value: ${value}. Expected one of: ${allowed.join(", ")}.`);
    }
    return value as SymbolKind;
  });
}

function parseNonNegativeNumber(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag} value: ${value}. Expected a non-negative number.`);
  }
  return parsed;
}

function parseExpansions(values: string[]): QueryExpansion[] {
  const allowed: QueryExpansion[] = ["callers", "callees", "imports", "parents", "children"];
  return values.map((value) => {
    if (!allowed.includes(value as QueryExpansion)) {
      throw new Error(`Invalid --expand value: ${value}. Expected one of: ${allowed.join(", ")}.`);
    }
    return value as QueryExpansion;
  });
}

function parseFileRoles(values: string[]): FileRole[] {
  const allowed: FileRole[] = ["source", "test", "docs", "example", "fixture", "tool", "benchmark"];
  return values.map((value) => {
    if (!allowed.includes(value as FileRole)) {
      throw new Error(`Invalid --role value: ${value}. Expected one of: ${allowed.join(", ")}.`);
    }
    return value as FileRole;
  });
}

function suggestQuerySubcommand(argv: string[]): void {
  const queryLikeFlags = new Set([
    "--index",
    "--index-path",
    "--db",
    "--repo",
    "--term",
    "--kind",
    "--path",
    "--role",
    "--expand",
    "--agent-query",
    "--exclude-support-code",
    "--trace",
    "--trace-task",
    "--agent-query",
    "--exclude-support-code"
  ]);
  if (argv[0] && queryLikeFlags.has(argv[0])) {
    throw new Error(`Did you mean: agent-index query ${argv.join(" ")}`);
  }
}

export function isCliEntrypoint(importMetaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(argvPath);
  } catch {
    return importMetaUrl === pathToFileURL(argvPath).href;
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
