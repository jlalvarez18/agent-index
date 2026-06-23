import { findFileClusters } from "./file-clusters.js";
import { queryAgentIndex } from "./query.js";
import { findRelatedTests } from "./related-tests.js";
import { findSourceTests } from "./source-tests.js";
import type {
  AgentQuery,
  FileClusterResult,
  FileRole,
  QueryExpansion,
  QueryMode,
  QueryResponse,
  SourceTestsResult,
  SymbolKind
} from "./schema.js";

export type AgentTaskKind = "bugfix" | "feature" | "explain" | "find-tests" | "source-to-tests";

export type AgentTaskStep =
  | {
      type: "file-clusters";
      purpose: string;
      query: AgentQuery;
      limit?: number;
    }
  | {
      type: "query";
      purpose: string;
      query: AgentQuery;
      limit?: number;
    }
  | {
      type: "source-tests";
      purpose: string;
      query: AgentQuery;
      limit?: number;
      testLimit?: number;
      testFanoutLimit?: number;
    }
  | {
      type: "related-tests";
      purpose: string;
      sourceFile: string;
      symbol?: string;
      terms?: string[];
      limit?: number;
    };

export interface AgentTaskPlan {
  kind: AgentTaskKind;
  task: string;
  steps: AgentTaskStep[];
}

export interface AgentTaskPlanInput {
  task?: string;
  source?: string;
  symbol?: string;
  terms?: string[];
  kinds?: SymbolKind[];
  roles?: FileRole[];
  pathHints?: string[];
  pathMode?: "hint" | "filter";
  expand?: QueryExpansion[];
  limit?: number;
  testLimit?: number;
}

export interface RunAgentTaskOptions {
  target: string;
  indexPath?: string;
  mode?: QueryMode;
}

export type AgentTaskStepResult =
  | {
      type: "file-clusters";
      purpose: string;
      result: FileClusterResult;
    }
  | {
      type: "query";
      purpose: string;
      result: QueryResponse;
    }
  | {
      type: "source-tests";
      purpose: string;
      result: SourceTestsResult;
    }
  | {
      type: "related-tests";
      purpose: string;
      result: ReturnType<typeof findRelatedTests>;
    };

export interface AgentTaskResult {
  plan: AgentTaskPlan;
  steps: AgentTaskStepResult[];
}

export type AgentTaskGuidanceAction = "open-top-result" | "inspect-related-tests" | "refine-query" | "fallback-search";
export type AgentTaskGuidanceConfidence = "high" | "medium" | "low";

export interface AgentTaskGuidance {
  recommendedNextAction: AgentTaskGuidanceAction;
  confidence: AgentTaskGuidanceConfidence;
  openFirst?: {
    file: string;
    line: number;
  };
  why: string[];
  next: string;
  followUpCommands?: string[];
}

const implementationKinds: SymbolKind[] = ["function", "method", "class"];

export function planAgentTask(kind: AgentTaskKind, input: AgentTaskPlanInput): AgentTaskPlan {
  const terms = taskTerms(input);
  const task = input.task?.trim() ?? "";
  const limit = input.limit ?? 5;
  const testLimit = input.testLimit ?? 2;

  if (terms.length === 0 && kind !== "source-to-tests") {
    throw new Error(`task ${kind} requires a task description or --term values`);
  }

  if (kind === "bugfix") {
    const bugfixTerms = defaultDecisionResolverTerms(terms);
    const sourceQuery = taskQuery(input, bugfixTerms, { roles: ["source"] });
    const implementationQuery = taskQuery(input, bugfixTerms, {
      roles: ["source"],
      symbolKinds: input.kinds ?? implementationKinds,
      expand: input.expand ?? ["callers", "callees", "imports"]
    });
    return {
      kind,
      task,
      steps: [
        { type: "file-clusters", purpose: "source-map", query: sourceQuery, limit },
        { type: "query", purpose: "implementation-context", query: implementationQuery, limit },
        {
          type: "source-tests",
          purpose: "related-tests",
          query: sourceQuery,
          limit,
          testLimit,
          testFanoutLimit: 3
        }
      ]
    };
  }

  if (kind === "feature") {
    const sourceQuery = taskQuery(input, terms, { roles: ["source"] });
    return {
      kind,
      task,
      steps: [
        { type: "file-clusters", purpose: "source-map", query: sourceQuery, limit },
        {
          type: "query",
          purpose: "nearby-apis",
          query: taskQuery(input, terms, {
            roles: ["source"],
            symbolKinds: input.kinds ?? ["class", "method", "function", "typealias"],
            expand: input.expand ?? ["imports", "parents", "children"]
          }),
          limit
        },
        {
          type: "source-tests",
          purpose: "likely-tests",
          query: sourceQuery,
          limit,
          testLimit,
          testFanoutLimit: 3
        },
        {
          type: "file-clusters",
          purpose: "examples",
          query: taskQuery(input, terms, { roles: ["test", "example"] }),
          limit
        }
      ]
    };
  }

  if (kind === "explain") {
    const sourceQuery = taskQuery(input, terms, { roles: ["source"] });
    return {
      kind,
      task,
      steps: [
        { type: "file-clusters", purpose: "source-map", query: sourceQuery, limit },
        {
          type: "query",
          purpose: "core-symbols",
          query: taskQuery(input, terms, {
            roles: ["source"],
            symbolKinds: input.kinds,
            expand: input.expand ?? ["callers", "callees", "imports", "parents"]
          }),
          limit
        }
      ]
    };
  }

  if (kind === "find-tests") {
    return {
      kind,
      task,
      steps: [
        {
          type: "source-tests",
          purpose: "source-test-relations",
          query: taskQuery(input, terms, { roles: ["source"] }),
          limit,
          testLimit,
          testFanoutLimit: 3
        }
      ]
    };
  }

  if (!input.source) {
    throw new Error("task source-to-tests requires --source <file>");
  }

  return {
    kind,
    task,
    steps: [
      {
        type: "related-tests",
        purpose: "direct-related-tests",
        sourceFile: input.source,
        symbol: input.symbol,
        terms,
        limit
      }
    ]
  };
}

export async function runAgentTask(plan: AgentTaskPlan, options: RunAgentTaskOptions): Promise<AgentTaskResult> {
  const steps: AgentTaskStepResult[] = [];
  for (const step of plan.steps) {
    if (step.type === "file-clusters") {
      steps.push({
        type: step.type,
        purpose: step.purpose,
        result: findFileClusters(step.query, { target: options.target, indexPath: options.indexPath, limit: step.limit })
      });
    } else if (step.type === "query") {
      steps.push({
        type: step.type,
        purpose: step.purpose,
        result: await queryAgentIndex(step.query, {
          target: options.target,
          indexPath: options.indexPath,
          limit: step.limit,
          mode: options.mode ?? "hybrid"
        })
      });
    } else if (step.type === "source-tests") {
      steps.push({
        type: step.type,
        purpose: step.purpose,
        result: findSourceTests(step.query, {
          target: options.target,
          indexPath: options.indexPath,
          limit: step.limit,
          testLimit: step.testLimit,
          testFanoutLimit: step.testFanoutLimit
        })
      });
    } else {
      steps.push({
        type: step.type,
        purpose: step.purpose,
        result: findRelatedTests({
          target: options.target,
          indexPath: options.indexPath,
          sourceFile: step.sourceFile,
          symbol: step.symbol,
          terms: step.terms,
          limit: step.limit
        })
      });
    }
  }
  return { plan, steps };
}

export function guideAgentTask(result: AgentTaskResult): AgentTaskGuidance {
  if (result.plan.kind === "source-to-tests") {
    return guideSourceToTestsTask(result);
  }

  const topSource = topSourceResult(result);
  if (!topSource) {
    return {
      recommendedNextAction: "refine-query",
      confidence: "low",
      why: ["no source result found"],
      next: "rerun agent-index with more specific code terms before broad rg"
    };
  }

  const confidenceSignals = sourceGuidanceConfidence(result, topSource);
  const confidence = confidenceSignals.confidence;
  const why = ["source hit rank 1"];
  if (confidenceSignals.hasEvidence) {
    why.push("evidence available");
  }
  if (confidenceSignals.hasImplementationCorroboration) {
    why.push("implementation query corroborated");
  }
  if (confidenceSignals.hasSameSourceRelatedTests) {
    why.push("related tests found");
  } else if (confidenceSignals.hasGraphNeighbors) {
    why.push("graph neighbors found");
  }
  if (confidenceSignals.isSupportArtifact) {
    why.push("support/artifact path");
  }

  return {
    recommendedNextAction: "open-top-result",
    confidence,
    openFirst: {
      file: topSource.file,
      line: topSource.line
    },
    why,
    next: confidence === "high" ? "inspect source before broad rg" : "inspect source, then refine with more specific terms if needed",
    followUpCommands: relatedTestFollowUpCommands(topSource)
  };
}

function sourceGuidanceConfidence(
  result: AgentTaskResult,
  topSource: { file: string; evidence?: string; symbol?: string; symbols?: string[]; language?: string }
): {
  confidence: AgentTaskGuidanceConfidence;
  hasEvidence: boolean;
  hasImplementationCorroboration: boolean;
  hasSameSourceRelatedTests: boolean;
  hasGraphNeighbors: boolean;
  isSupportArtifact: boolean;
} {
  const hasEvidence = Boolean(topSource.evidence);
  const hasImplementationCorroboration = queryMatches(result).some((match) => match.file === topSource.file);
  const bundles = sourceTestBundles(result);
  const hasAnyRelatedTests = bundles.some((bundle) => bundle.tests.length > 0);
  const hasSameSourceRelatedTests = bundles.some(
    (bundle) => bundle.source.file === topSource.file && bundle.tests.length > 0
  );
  const hasGraphNeighbors = queryMatches(result).some((match) => match.file === topSource.file && match.neighbors.length > 0);
  const isSupportArtifact = supportArtifactLike(topSource);
  const sourceSpecificity = sourceSpecificityScore(result, topSource);
  const strongQueryCorroboration = hasStrongQueryCorroboration(result, topSource.file);
  const confidence: AgentTaskGuidanceConfidence =
    hasEvidence &&
    !isSupportArtifact &&
    sourceSpecificity > 0 &&
    hasImplementationCorroboration &&
    ((hasSameSourceRelatedTests && (strongQueryCorroboration || sourceSpecificity >= 1)) ||
      (!hasAnyRelatedTests && hasGraphNeighbors && strongQueryCorroboration))
      ? "high"
      : "medium";

  return {
    confidence,
    hasEvidence,
    hasImplementationCorroboration,
    hasSameSourceRelatedTests,
    hasGraphNeighbors,
    isSupportArtifact
  };
}

function guideSourceToTestsTask(result: AgentTaskResult): AgentTaskGuidance {
  const match = relatedTestMatches(result)[0];
  if (!match) {
    return {
      recommendedNextAction: "refine-query",
      confidence: "low",
      why: ["no related test found"],
      next: "rerun agent-index with a known source file and more specific symbols"
    };
  }

  return {
    recommendedNextAction: "inspect-related-tests",
    confidence: match.symbols.length > 0 ? "high" : "medium",
    openFirst: {
      file: match.file,
      line: match.firstLine ?? 1
    },
    why: ["related test rank 1", ...(match.symbols.length > 0 ? ["test symbols found"] : [])],
    next: "inspect related test before broad rg"
  };
}

function topSourceResult(
  result: AgentTaskResult
): { file: string; line: number; evidence?: string; symbol?: string; symbols?: string[]; role?: FileRole; language?: string } | undefined {
  const cluster = fileClusters(result)[0];
  if (cluster) {
    return {
      file: cluster.file,
      line: cluster.symbols[0]?.lines[0] ?? 1,
      evidence: cluster.evidence,
      symbol: cluster.symbols[0]?.name,
      symbols: cluster.symbols.map((symbol) => symbol.name),
      role: cluster.role,
      language: cluster.language
    };
  }

  const match = queryMatches(result)[0];
  if (match) {
    return {
      file: match.file,
      line: match.lines[0],
      evidence: match.evidence,
      symbol: match.symbol,
      symbols: [match.symbol]
    };
  }
  return undefined;
}

function fileClusters(result: AgentTaskResult): FileClusterResult["clusters"] {
  return result.steps.flatMap((step) => (step.type === "file-clusters" ? step.result.clusters : []));
}

function queryMatches(result: AgentTaskResult): QueryResponse["matches"] {
  return result.steps.flatMap((step) => (step.type === "query" ? step.result.matches : []));
}

function sourceTestBundles(result: AgentTaskResult): SourceTestsResult["bundles"] {
  return result.steps.flatMap((step) => (step.type === "source-tests" ? step.result.bundles : []));
}

function relatedTestMatches(result: AgentTaskResult): ReturnType<typeof findRelatedTests>["matches"] {
  return result.steps.flatMap((step) => (step.type === "related-tests" ? step.result.matches : []));
}

function relatedTestFollowUpCommands(topSource: { file: string; symbol?: string }): string[] | undefined {
  if (!topSource.symbol) {
    return undefined;
  }
  return [`agent-index task source-to-tests --source ${topSource.file} --term ${topSource.symbol}`];
}

function sourceSpecificityScore(result: AgentTaskResult, topSource: { file: string; symbol?: string; symbols?: string[] }): number {
  const terms = meaningfulTaskTerms(result);
  if (terms.length === 0) {
    return 0;
  }
  const haystacks = [topSource.file, topSource.symbol ?? "", ...(topSource.symbols ?? [])].map((value) => normalizeTaskTerm(value));
  return terms.filter((term) => haystacks.some((value) => termMatchesNormalizedText(term, value))).length;
}

function hasStrongQueryCorroboration(result: AgentTaskResult, file: string): boolean {
  return queryMatches(result).some(
    (match) =>
      match.file === file &&
      match.why.some((reason) =>
        [
          "exact identifier match",
          "exact symbol name match",
          "exact symbol term match",
          "symbol token coverage match",
          "named owner API intent",
          "method owner/name match",
          "method owner/source match",
          "query intent match"
        ].includes(reason)
      )
  );
}

function meaningfulTaskTerms(result: AgentTaskResult): string[] {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "be",
    "by",
    "behavior",
    "core",
    "default",
    "defaults",
    "feature",
    "flow",
    "for",
    "from",
    "how",
    "in",
    "into",
    "is",
    "it",
    "query",
    "of",
    "or",
    "output",
    "path",
    "should",
    "source",
    "the",
    "then",
    "through",
    "to",
    "test",
    "tests",
    "where",
    "with",
    "works"
  ]);
  const terms = result.plan.steps.flatMap((step) => ("query" in step ? step.query.terms : []));
  return uniqueValues(terms.map((term) => normalizeTaskTerm(term)).filter((term) => term.length >= 3 && !stopWords.has(term)));
}

function termMatchesNormalizedText(term: string, text: string): boolean {
  if (!text) {
    return false;
  }
  const textTokens = text.split(/\s+/u);
  const termTokens = term.split(/\s+/u).filter(Boolean);
  return (
    textTokens.includes(term) ||
    text.includes(term.replace(/\s+/gu, "")) ||
    (termTokens.length > 1 && termTokens.every((token) => textTokens.includes(token)))
  );
}

function supportArtifactLike(topSource: { file: string; language?: string }): boolean {
  const normalizedPath = topSource.file.toLowerCase();
  const pathSegments = normalizedPath.split(/[\\/]+/u);
  if (
    pathSegments.some((segment) => segment === "_artifacts" || segment === "artifacts" || segment === "graphify-out") ||
    pathSegments.some((segment) => segment === "testing" || /^testing\.[a-z0-9]+$/u.test(segment)) ||
    normalizedPath.includes("/generated/") ||
    normalizedPath.includes("/fixtures/") ||
    normalizedPath.includes("/docs/")
  ) {
    return true;
  }
  return topSource.language === "json" || topSource.language === "yaml" || topSource.language === "toml" || topSource.language === "xml";
}

function taskQuery(
  input: AgentTaskPlanInput,
  terms: string[],
  preset: {
    roles?: FileRole[];
    symbolKinds?: SymbolKind[];
    expand?: QueryExpansion[];
  }
): AgentQuery {
  return {
    terms,
    symbolKinds: preset.symbolKinds,
    pathHints: input.pathHints && input.pathHints.length > 0 ? input.pathHints : undefined,
    pathMode: input.pathMode === "filter" ? "filter" : undefined,
    roles: input.roles && input.roles.length > 0 ? input.roles : preset.roles,
    expand: preset.expand,
    limit: input.limit
  };
}

function taskTerms(input: AgentTaskPlanInput): string[] {
  return uniqueValues([...splitWords(input.task ?? ""), ...(input.terms ?? [])]);
}

function defaultDecisionResolverTerms(terms: string[]): string[] {
  const normalizedTerms = terms.map((term) => normalizeTaskTerm(term));
  const termSet = new Set(normalizedTerms);
  const defaultLike = termSet.has("default") || termSet.has("defaults");
  const behaviorLike = ["disable", "disabled", "enable", "enabled", "decide", "decides", "decision", "behavior", "signal"].some((term) =>
    termSet.has(term)
  );
  if (!defaultLike || !behaviorLike) {
    return terms;
  }
  return uniqueValues([...terms, "resolve", "decision"]);
}

function splitWords(value: string): string[] {
  return value.split(/\s+/u).map((term) => term.trim()).filter(Boolean);
}

function normalizeTaskTerm(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_/.-]+/gu, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function uniqueValues(values: string[]): string[] {
  return values.filter((value, index) => value.length > 0 && values.indexOf(value) === index);
}
