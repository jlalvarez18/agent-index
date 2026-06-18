import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const rubyExtractor: LanguageExtractor = {
  language: "ruby",
  extensions: [".rb", ".rake", ".gemspec"],
  extract: extractRuby
};

interface RubyItem {
  name: string;
  qualifiedName: string;
  kind: "module" | "class" | "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  conformsTo?: string[];
  calls?: string[];
}

interface RubyScope {
  qualifiedName: string;
  endLine: number;
  kind: "module" | "class" | "method";
}

export function extractRuby(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = isGherkinFile(file) ? collectGherkinItems(lines, moduleName) : collectRubyItems(lines, moduleName, file.relativePath);
  const symbols: CodeSymbol[] = [
    moduleSymbol,
    ...items.map((item) => ({
      name: item.name,
      qualifiedName: item.qualifiedName,
      kind: item.kind,
      startLine: item.startLine,
      endLine: item.endLine,
      parentSymbolName: item.parentSymbolName
    }))
  ];
  const chunks: CodeChunk[] = [
    chunkForLines(moduleName, lines, 1, moduleSymbol.endLine),
    ...items.map((item) => chunkForLines(item.qualifiedName, lines, item.startLine, item.endLine))
  ];
  const edges: CodeEdge[] = [
    ...importEdges(moduleName, lines),
    ...items.map((item) => ({
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: item.parentSymbolName === moduleName ? ("file_contains_symbol" as const) : ("symbol_contains_symbol" as const),
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => conformanceEdges(item)),
    ...items.flatMap((item) => relatedCallEdges(item)),
    ...items.flatMap((item) => siblingCallEdges(item, lines, items)),
    ...items.flatMap((item) => callEdges(item, lines))
  ];

  return { file, symbols, chunks, edges };
}

function collectRubyItems(lines: string[], moduleName: string, relativePath: string): RubyItem[] {
  const items: RubyItem[] = [];
  const scopeStack: RubyScope[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    while (scopeStack.length > 0 && lineNumber > scopeStack[scopeStack.length - 1].endLine) {
      scopeStack.pop();
    }

    const line = stripLineComment(rawLine);
    const owner = nearestNamespaceScope(scopeStack);
    const dslOwner = nearestScope(scopeStack);

    const rspecDeclaration = rspecForLine(line);
    if (rspecDeclaration) {
      const parentSymbolName = dslOwner?.qualifiedName ?? moduleName;
      const qualifiedName =
        rspecDeclaration.kind === "class"
          ? `RSpec::${rspecDeclaration.name}`
          : `${parentSymbolName}.${rspecDeclaration.name}`;
      const item = {
        name: rspecDeclaration.name,
        qualifiedName,
        kind: rspecDeclaration.kind,
        startLine: lineNumber,
        endLine: endLineForRubyBlock(lines, index),
        parentSymbolName
      };
      items.push(item);
      scopeStack.push({ qualifiedName, endLine: item.endLine, kind: item.kind });
      continue;
    }

    const rakeDeclaration = rakeForLine(line, relativePath, dslOwner);
    if (rakeDeclaration) {
      const item = {
        name: rakeDeclaration.name,
        qualifiedName: rakeDeclaration.qualifiedName,
        kind: rakeDeclaration.kind,
        startLine: lineNumber,
        endLine: rakeDeclaration.hasBlock ? endLineForRubyBlock(lines, index) : lineNumber,
        parentSymbolName: rakeDeclaration.parentSymbolName ?? moduleName
      };
      items.push(item);
      if (rakeDeclaration.hasBlock) {
        scopeStack.push({ qualifiedName: item.qualifiedName, endLine: item.endLine, kind: item.kind });
      }
      continue;
    }

    const routeDeclaration = routeForLine(line, relativePath, dslOwner);
    if (routeDeclaration) {
      const item = {
        name: routeDeclaration.name,
        qualifiedName: routeDeclaration.qualifiedName,
        kind: routeDeclaration.kind,
        startLine: lineNumber,
        endLine: routeDeclaration.hasBlock ? endLineForRubyBlock(lines, index) : lineNumber,
        parentSymbolName: routeDeclaration.parentSymbolName ?? moduleName,
        calls: routeDeclaration.calls
      };
      items.push(item);
      if (routeDeclaration.hasBlock) {
        scopeStack.push({ qualifiedName: item.qualifiedName, endLine: item.endLine, kind: item.kind });
      }
      continue;
    }

    const moduleDeclaration = moduleForLine(line);
    if (moduleDeclaration) {
      const qualifiedName = qualifyRubyName(moduleDeclaration.name, owner?.qualifiedName);
      const item = {
        name: rubyNameLeaf(moduleDeclaration.name),
        qualifiedName,
        kind: "module" as const,
        startLine: lineNumber,
        endLine: endLineForRubyBlock(lines, index),
        parentSymbolName: parentForRubyName(moduleDeclaration.name, owner?.qualifiedName, moduleName)
      };
      items.push(item);
      scopeStack.push({ qualifiedName, endLine: item.endLine, kind: "module" });
      continue;
    }

    const classDeclaration = classForLine(line);
    if (classDeclaration) {
      const qualifiedName = qualifyRubyName(classDeclaration.name, owner?.qualifiedName);
      const item = {
        name: rubyNameLeaf(classDeclaration.name),
        qualifiedName,
        kind: "class" as const,
        startLine: lineNumber,
        endLine: endLineForRubyBlock(lines, index),
        parentSymbolName: parentForRubyName(classDeclaration.name, owner?.qualifiedName, moduleName),
        conformsTo: classDeclaration.superclass ? [classDeclaration.superclass] : []
      };
      item.conformsTo.push(...mixinsForBlock(lines, index, item.endLine));
      items.push(item);
      scopeStack.push({ qualifiedName, endLine: item.endLine, kind: "class" });
      continue;
    }

    const methodDeclaration = methodForLine(line);
    if (methodDeclaration && owner) {
      const qualifiedName = `${owner.qualifiedName}.${methodDeclaration.name}`;
      const item = {
        name: methodDeclaration.displayName,
        qualifiedName,
        kind: "method" as const,
        startLine: lineNumber,
        endLine: endLineForRubyBlock(lines, index),
        parentSymbolName: owner.qualifiedName
      };
      items.push(item);
      scopeStack.push({ qualifiedName, endLine: item.endLine, kind: "method" });
      continue;
    }

    for (const activeRecordDeclaration of frameworkDeclarationsForLine(line, dslOwner)) {
      items.push({
        name: activeRecordDeclaration.name,
        qualifiedName: activeRecordDeclaration.qualifiedName,
        kind: "method",
        startLine: lineNumber,
        endLine: lineNumber,
        parentSymbolName: activeRecordDeclaration.parentSymbolName
      });
    }
  }

  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function collectGherkinItems(lines: string[], moduleName: string): RubyItem[] {
  const items: RubyItem[] = [];
  let featureName: string | undefined;
  let featureQualifiedName: string | undefined;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    const feature = /^Feature:\s*(.+)$/u.exec(line);
    if (feature) {
      featureName = slugName(feature[1]);
      featureQualifiedName = `feature.${featureName}`;
      items.push({
        name: featureName,
        qualifiedName: featureQualifiedName,
        kind: "class",
        startLine: index + 1,
        endLine: endLineBeforeNextGherkinFeature(lines, index),
        parentSymbolName: moduleName
      });
      continue;
    }

    const scenario = /^Scenario(?: Outline)?:\s*(.+)$/u.exec(line);
    if (scenario && featureQualifiedName) {
      const scenarioName = slugName(scenario[1], { lower: true });
      items.push({
        name: scenarioName,
        qualifiedName: `${featureQualifiedName}.${scenarioName}`,
        kind: "method",
        startLine: index + 1,
        endLine: endLineBeforeNextGherkinScenario(lines, index),
        parentSymbolName: featureQualifiedName
      });
    }
  }

  return items;
}

function moduleForLine(line: string): { name: string } | undefined {
  const match = /^\s*module\s+([A-Z][A-Za-z0-9_:]*)\b/u.exec(line);
  return match ? { name: match[1] } : undefined;
}

function classForLine(line: string): { name: string; superclass?: string } | undefined {
  const match = /^\s*class\s+([A-Z][A-Za-z0-9_:]*)(?:\s*<\s*([A-Z][A-Za-z0-9_:]*))?/u.exec(line);
  return match ? { name: match[1], superclass: match[2] } : undefined;
}

function methodForLine(line: string): { name: string; displayName: string } | undefined {
  const match = /^\s*def\s+(?:(self)\.)?([A-Za-z_][A-Za-z0-9_!?=]*)\b/u.exec(line);
  if (!match) {
    return undefined;
  }
  return { name: match[2], displayName: match[1] ? `self.${match[2]}` : match[2] };
}

function nearestNamespaceScope(scopes: RubyScope[]): RubyScope | undefined {
  return [...scopes].reverse().find((scope) => scope.kind === "module" || scope.kind === "class");
}

function nearestScope(scopes: RubyScope[]): RubyScope | undefined {
  return scopes[scopes.length - 1];
}

function rspecForLine(line: string): { name: string; kind: "class" | "method" } | undefined {
  const describe = /^\s*(?:RSpec\.)?describe\s+([A-Z][A-Za-z0-9_:]*)\s+do\b/u.exec(line);
  if (describe) {
    return { name: describe[1], kind: "class" };
  }

  const context = /^\s*(?:context|describe)\s+["']([^"']+)["']\s+do\b/u.exec(line);
  if (context) {
    return { name: slugName(context[1]), kind: "method" };
  }

  const example = /^\s*(?:it|specify)\s+["']([^"']+)["']\s+do\b/u.exec(line);
  return example ? { name: slugName(example[1], { lower: true }), kind: "method" } : undefined;
}

function rakeForLine(
  line: string,
  relativePath: string,
  owner: RubyScope | undefined
): { name: string; qualifiedName: string; kind: "module" | "method"; parentSymbolName?: string; hasBlock: boolean } | undefined {
  if (!isRakeFile(relativePath)) {
    return undefined;
  }
  const namespace = /^\s*namespace\s+[:"']([A-Za-z0-9_:-]+)["']?\s+do\b/u.exec(line);
  if (namespace) {
    const name = slugName(namespace[1]);
    const parent = owner?.qualifiedName;
    return {
      name,
      qualifiedName: parent?.startsWith("rake.") ? `${parent}.${name}` : `rake.${name}`,
      kind: "module",
      parentSymbolName: parent?.startsWith("rake.") ? parent : undefined,
      hasBlock: true
    };
  }

  const task = /^\s*task\s+(?::([A-Za-z0-9_]+)|([A-Za-z0-9_]+):)/u.exec(line);
  if (task) {
    const name = slugName(task[1] ?? task[2]);
    const parent = owner?.qualifiedName?.startsWith("rake.") ? owner.qualifiedName : "rake";
    return {
      name,
      qualifiedName: `${parent}.${name}`,
      kind: "method",
      parentSymbolName: parent === "rake" ? undefined : parent,
      hasBlock: /\bdo\b/u.test(line)
    };
  }

  return undefined;
}

function routeForLine(
  line: string,
  relativePath: string,
  owner: RubyScope | undefined
): { name: string; qualifiedName: string; kind: "module" | "method"; parentSymbolName?: string; hasBlock: boolean; calls?: string[] } | undefined {
  if (relativePath !== "config/routes.rb") {
    return undefined;
  }
  const namespace = /^\s*namespace\s+[:"']([A-Za-z0-9_:-]+)["']?\s+do\b/u.exec(line);
  if (namespace) {
    const name = slugName(namespace[1]);
    const parent = owner?.qualifiedName?.startsWith("routes.") ? owner.qualifiedName : "routes";
    return {
      name,
      qualifiedName: `${parent}.${name}`,
      kind: "module",
      parentSymbolName: parent === "routes" ? undefined : parent,
      hasBlock: true
    };
  }

  const resources = /^\s*resources\s+[:"']([A-Za-z0-9_:-]+)["']?/u.exec(line);
  if (resources) {
    const name = slugName(resources[1]);
    const parent = owner?.qualifiedName?.startsWith("routes.") ? owner.qualifiedName : "routes";
    return {
      name,
      qualifiedName: `${parent}.${name}`,
      kind: "method",
      parentSymbolName: parent === "routes" ? undefined : parent,
      hasBlock: /\bdo\b/u.test(line)
    };
  }

  const route = /^\s*(?:get|post|put|patch|delete|match)\s+["']([^"']+)["']/u.exec(line);
  if (route) {
    const name = slugName(route[1]);
    const parent = owner?.qualifiedName?.startsWith("routes.") ? owner.qualifiedName : "routes";
    const target = railsRouteTarget(line);
    return {
      name,
      qualifiedName: `${parent}.${name}`,
      kind: "method",
      parentSymbolName: parent === "routes" ? undefined : parent,
      hasBlock: false,
      calls: target ? [target] : []
    };
  }

  return undefined;
}

function frameworkDeclarationsForLine(
  line: string,
  owner: RubyScope | undefined
): Array<{ name: string; qualifiedName: string; parentSymbolName: string }> {
  if (!owner || (owner.kind !== "class" && owner.kind !== "method")) {
    return [];
  }
  const migrationTable = /^\s*create_table\s+[:"']([A-Za-z0-9_]+)["']?/u.exec(line);
  if (migrationTable && owner.kind === "method") {
    const name = `create_table_${slugName(migrationTable[1])}`;
    return [{ name, qualifiedName: `${owner.qualifiedName}.${name}`, parentSymbolName: owner.qualifiedName }];
  }

  const migrationIndex = /^\s*add_index\s+[:"']([A-Za-z0-9_]+)["']?\s*,\s+[:"']([A-Za-z0-9_]+)["']?/u.exec(line);
  if (migrationIndex && owner.kind === "method") {
    const name = `add_index_${slugName(migrationIndex[1])}_${slugName(migrationIndex[2])}`;
    return [{ name, qualifiedName: `${owner.qualifiedName}.${name}`, parentSymbolName: owner.qualifiedName }];
  }

  if (owner.kind !== "class") {
    return [];
  }
  const association = /^\s*(has_many|has_one|belongs_to|has_and_belongs_to_many)\s+[:"']([A-Za-z0-9_]+)["']?/u.exec(line);
  if (association) {
    const name = `${association[1]}_${slugName(association[2])}`;
    return [{ name, qualifiedName: `${owner.qualifiedName}.${name}`, parentSymbolName: owner.qualifiedName }];
  }

  const validation = /^\s*validates\s+[:"']([A-Za-z0-9_]+)["']?/u.exec(line);
  if (validation) {
    const name = `validates_${slugName(validation[1])}`;
    return [{ name, qualifiedName: `${owner.qualifiedName}.${name}`, parentSymbolName: owner.qualifiedName }];
  }

  const scope = /^\s*scope\s+[:"']([A-Za-z0-9_]+)["']?/u.exec(line);
  if (scope) {
    const name = `scope_${slugName(scope[1])}`;
    return [{ name, qualifiedName: `${owner.qualifiedName}.${name}`, parentSymbolName: owner.qualifiedName }];
  }

  const queue = /^\s*queue_as\s+[:"']([A-Za-z0-9_]+)["']?/u.exec(line);
  if (queue) {
    const name = `queue_as_${slugName(queue[1])}`;
    return [{ name, qualifiedName: `${owner.qualifiedName}.${name}`, parentSymbolName: owner.qualifiedName }];
  }

  const jobHandler = /^\s*(retry_on|discard_on)\s+([A-Z][A-Za-z0-9_:]*)/u.exec(line);
  if (jobHandler) {
    const name = `${jobHandler[1]}_${slugName(jobHandler[2])}`;
    return [{ name, qualifiedName: `${owner.qualifiedName}.${name}`, parentSymbolName: owner.qualifiedName }];
  }

  const sidekiq = /^\s*sidekiq_options\s+(.+)$/u.exec(line);
  if (sidekiq) {
    return sidekiqOptionDeclarations(sidekiq[1], owner.qualifiedName);
  }

  const callback = /^\s*(before|after|around)_(?:validation|save|create|update|destroy|commit|action)\s+[:"']([A-Za-z0-9_!?]+)["']?/u.exec(line);
  if (callback) {
    const callbackName = line.trim().split(/\s+/u)[0];
    const name = `${callbackName}_${slugName(callback[2])}`;
    return [{ name, qualifiedName: `${owner.qualifiedName}.${name}`, parentSymbolName: owner.qualifiedName }];
  }

  return [];
}

function sidekiqOptionDeclarations(optionsText: string, ownerName: string): Array<{ name: string; qualifiedName: string; parentSymbolName: string }> {
  const declarations: Array<{ name: string; qualifiedName: string; parentSymbolName: string }> = [];
  for (const match of optionsText.matchAll(/\b(queue|retry)\s*:\s*(?::([A-Za-z0-9_]+)|([0-9]+)|["']([^"']+)["'])/gu)) {
    const optionName = match[1];
    const optionValue = match[2] ?? match[3] ?? match[4];
    const name = `sidekiq_${optionName}_${slugName(optionValue)}`;
    declarations.push({ name, qualifiedName: `${ownerName}.${name}`, parentSymbolName: ownerName });
  }
  return declarations;
}

function relatedCallEdges(item: RubyItem): CodeEdge[] {
  return (item.calls ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function railsRouteTarget(line: string): string | undefined {
  const target = /\bto:\s*["']([A-Za-z0-9_\/]+)#([A-Za-z0-9_!?]+)["']/u.exec(line);
  if (!target) {
    return undefined;
  }
  const controller = target[1].split("/").map((part) => classifyRubyConstant(part)).join("::");
  return `${controller}Controller.${target[2]}`;
}

function classifyRubyConstant(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function qualifyRubyName(name: string, ownerName?: string): string {
  if (name.includes("::") || !ownerName) {
    return name;
  }
  return `${ownerName}::${name}`;
}

function parentForRubyName(name: string, ownerName: string | undefined, moduleName: string): string {
  if (ownerName && !name.includes("::")) {
    return ownerName;
  }
  return moduleName;
}

function rubyNameLeaf(name: string): string {
  return name.split("::").pop() ?? name;
}

function importEdges(moduleName: string, lines: string[]): CodeEdge[] {
  const imports = new Set<string>();
  for (const rawLine of lines) {
    const imported = importedPath(stripLineComment(rawLine));
    if (imported) {
      imports.add(imported);
    }
  }
  return [...imports].sort().map((targetName) => ({
    sourceSymbolName: moduleName,
    targetName,
    kind: "symbol_imports_module",
    confidence: "name"
  }));
}

function importedPath(line: string): string | undefined {
  return /^\s*(?:require|require_relative|load)\s+["']([^"']+)["']/u.exec(line)?.[1];
}

function mixinsForBlock(lines: string[], startIndex: number, endLine: number): string[] {
  const names = new Set<string>();
  for (let index = startIndex + 1; index < endLine; index++) {
    const line = stripLineComment(lines[index]);
    const match = /^\s*(?:include|extend|prepend)\s+(.+)$/u.exec(line);
    if (!match) {
      continue;
    }
    for (const name of match[1].split(",")) {
      const trimmed = name.trim();
      if (/^[A-Z][A-Za-z0-9_:]*$/u.test(trimmed)) {
        names.add(trimmed);
      }
    }
  }
  return [...names].sort();
}

function conformanceEdges(item: RubyItem): CodeEdge[] {
  return (item.conformsTo ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_conforms_to",
    confidence: "name"
  }));
}

function callEdges(item: RubyItem, lines: string[]): CodeEdge[] {
  if (item.kind !== "method") {
    return [];
  }
  const text = lines.slice(item.startLine, item.endLine).join("\n");
  return calledNames(text).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function siblingCallEdges(item: RubyItem, lines: string[], items: RubyItem[]): CodeEdge[] {
  if (item.kind !== "method") {
    return [];
  }
  const siblingMethods = items.filter((candidate) => candidate.kind === "method" && candidate.parentSymbolName === item.parentSymbolName);
  if (siblingMethods.length === 0) {
    return [];
  }
  const instanceMethods = new Map(
    siblingMethods
      .filter((candidate) => !isRubyClassMethod(candidate))
      .map((candidate) => [rubyMethodLeaf(candidate), candidate.qualifiedName])
  );
  const classMethods = new Map(
    siblingMethods
      .filter((candidate) => isRubyClassMethod(candidate))
      .map((candidate) => [rubyMethodLeaf(candidate), candidate.qualifiedName])
  );
  const targets = new Set<string>();
  const calls = siblingCallNames(lines.slice(item.startLine, item.endLine).join("\n"));
  const callableSiblings = isRubyClassMethod(item) ? classMethods : instanceMethods;
  for (const name of calls.bare) {
    const target = callableSiblings.get(name);
    if (target && target !== item.qualifiedName) {
      targets.add(target);
    }
  }
  if (isRubyClassMethod(item)) {
    for (const name of calls.self) {
      const target = classMethods.get(name);
      if (target && target !== item.qualifiedName) {
        targets.add(target);
      }
    }
  }
  return [...targets].sort().map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "exact"
  }));
}

function isRubyClassMethod(item: RubyItem): boolean {
  return item.name.startsWith("self.");
}

function rubyMethodLeaf(item: RubyItem): string {
  return item.name.replace(/^self\./u, "");
}

function siblingCallNames(text: string): { bare: Set<string>; self: Set<string> } {
  const bare = new Set<string>();
  const self = new Set<string>();
  const stripped = text.replace(/#.*$/gmu, "");
  for (const match of stripped.matchAll(/\bself\.([a-z_][A-Za-z0-9_!?=]*)\s*(?:\(|\b)/gu)) {
    self.add(match[1]);
  }
  for (const match of stripped.matchAll(/(?:^|[^\.:])\b([a-z_][A-Za-z0-9_!?=]*)\s*(?:\(|\b)/gu)) {
    const name = match[1];
    if (!rubyCallStopwords.has(name) && !isRubyKeywordOrSymbolLabel(stripped, match)) {
      bare.add(name);
    }
  }
  return { bare, self };
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  const stripped = text.replace(/#.*$/gmu, "");
  for (const match of stripped.matchAll(/\b([A-Z][A-Za-z0-9_:]*)\b(?=\s*(?:\.|\(|\b))/gu)) {
    names.add(match[1]);
  }
  for (const match of stripped.matchAll(/(?:\.|\b)([a-z_][A-Za-z0-9_!?=]*)\s*(?:\(|\b)/gu)) {
    const name = match[1];
    if (!rubyCallStopwords.has(name) && !isRubyKeywordOrSymbolLabel(stripped, match)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function isRubyKeywordOrSymbolLabel(text: string, match: RegExpMatchArray): boolean {
  if (match.index === undefined) {
    return false;
  }
  const name = match[1];
  const nameStart = match.index + match[0].lastIndexOf(name);
  const before = previousNonWhitespace(text, nameStart - 1);
  const nameEnd = nameStart + name.length;
  return before === ":" || text[nameEnd] === ":";
}

function previousNonWhitespace(text: string, startIndex: number): string | undefined {
  for (let index = startIndex; index >= 0; index--) {
    if (!/\s/u.test(text[index])) {
      return text[index];
    }
  }
  return undefined;
}

const rubyCallStopwords = new Set([
  "def",
  "end",
  "if",
  "unless",
  "while",
  "until",
  "case",
  "when",
  "do",
  "return",
  "self",
  "class",
  "module",
  "include",
  "extend",
  "prepend",
  "require",
  "require_relative",
  "load",
  "true",
  "false",
  "nil"
]);

function endLineForRubyBlock(lines: string[], startIndex: number): number {
  let depth = 1;
  for (let index = startIndex + 1; index < lines.length; index++) {
    const line = stripLineComment(lines[index]);
    depth += rubyBlockOpenCount(line);
    depth -= rubyBlockEndCount(line);
    if (depth <= 0) {
      return index + 1;
    }
  }
  return startIndex + 1;
}

function rubyBlockOpenCount(line: string): number {
  const trimmed = line.trim();
  if (trimmed === "") {
    return 0;
  }
  let count = /^(?:class|module|def|if|unless|case|while|until|for|begin)\b/u.test(trimmed) ? 1 : 0;
  if (/\bdo\b/u.test(trimmed)) {
    count++;
  }
  return count;
}

function rubyBlockEndCount(line: string): number {
  return /^\s*end\b/u.test(line) ? 1 : 0;
}

function isRakeFile(relativePath: string): boolean {
  return relativePath.endsWith(".rake") || relativePath.endsWith("Rakefile");
}

function isGherkinFile(file: SourceFile): boolean {
  return file.relativePath.endsWith(".feature");
}

function endLineBeforeNextGherkinFeature(lines: string[], startIndex: number): number {
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (/^\s*Feature:\s+/u.test(lines[index])) {
      return index;
    }
  }
  return Math.max(lines.length, startIndex + 1);
}

function endLineBeforeNextGherkinScenario(lines: string[], startIndex: number): number {
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (/^\s*(?:Scenario(?: Outline)?|Feature):\s+/u.test(lines[index])) {
      return index;
    }
  }
  return Math.max(lines.length, startIndex + 1);
}

function slugName(value: string, options: { lower?: boolean } = {}): string {
  const slug = value
    .trim()
    .replace(/^#+/u, "")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_");
  return options.lower ? slug.toLowerCase() : slug;
}

function stripLineComment(line: string): string {
  let quote: "\"" | "'" | undefined;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
      continue;
    }
    if (char === "#" && !quote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function normalizedLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function chunkForLines(symbolName: string, lines: string[], startLine: number, endLine: number): CodeChunk {
  return {
    symbolName,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}
