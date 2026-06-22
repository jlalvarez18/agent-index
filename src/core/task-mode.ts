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
