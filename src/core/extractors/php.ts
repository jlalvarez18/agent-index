import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const phpExtractor: LanguageExtractor = {
  language: "php",
  extensions: [".php"],
  extract: extractPhp
};

interface PhpItem {
  name: string;
  qualifiedName: string;
  kind: "module" | "class" | "function" | "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  conformsTo?: string[];
  relatedNames?: string[];
}

interface PhpType {
  name: string;
  qualifiedName: string;
  endLine: number;
}

export function extractPhp(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const namespaceName = phpNamespaceName(lines);
  const namespaceSymbol = namespaceName
    ? {
        name: namespaceName,
        qualifiedName: namespaceName,
        kind: "module" as const,
        startLine: namespaceLine(lines, namespaceName),
        endLine: moduleSymbol.endLine,
        parentSymbolName: moduleName
      }
    : undefined;
  const structureLines = phpStructureLines(lines);
  const items = collectPhpItems(structureLines, moduleName, namespaceName);
  const symbols: CodeSymbol[] = [
    moduleSymbol,
    ...(namespaceSymbol ? [namespaceSymbol] : []),
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
    ...(namespaceSymbol ? [chunkForLines(namespaceSymbol.qualifiedName, lines, namespaceSymbol.startLine, namespaceSymbol.endLine)] : []),
    ...items.map((item) => chunkForLines(item.qualifiedName, lines, item.startLine, item.endLine))
  ];
  const edges: CodeEdge[] = [
    ...(namespaceSymbol
      ? [
          {
            sourceSymbolName: moduleName,
            targetName: namespaceSymbol.qualifiedName,
            kind: "file_contains_symbol" as const,
            confidence: "exact" as const
          }
        ]
      : []),
    ...phpImportEdges(moduleName, lines),
    ...items.map((item) => ({
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: item.parentSymbolName === moduleName || item.parentSymbolName === namespaceName ? ("file_contains_symbol" as const) : ("symbol_contains_symbol" as const),
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => conformanceEdges(item)),
    ...items.flatMap((item) => relatedNameEdges(item))
  ];
  for (const item of items.filter((current) => current.kind === "function" || current.kind === "method")) {
    edges.push(...callEdges(item, structureLines));
  }

  return { file, symbols, chunks, edges };
}

function collectPhpItems(lines: string[], moduleName: string, namespaceName?: string): PhpItem[] {
  const items: PhpItem[] = [];
  const typeStack: PhpType[] = [];
  let pendingAttributes: string[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    while (typeStack.length > 0 && index + 1 > typeStack[typeStack.length - 1].endLine) {
      typeStack.pop();
    }

    const attributes = attributeNames(line);
    if (attributes.length > 0) {
      pendingAttributes = [...pendingAttributes, ...attributes];
    }

    const signatureLine = signatureWindow(lines, index, line);
    const owner = typeStack[typeStack.length - 1];
    const anonymousTypeDeclaration = owner ? anonymousTypeDeclarationForLine(signatureLine, index + 1) : undefined;
    const typeDeclaration = anonymousTypeDeclaration ?? (canStartPhpType(line) ? typeDeclarationForLine(signatureLine) : undefined);
    if (typeDeclaration) {
      const qualifiedName = qualifyPhpName(typeDeclaration.name, owner?.qualifiedName, namespaceName);
      const endLine = endLineForBlock(lines, index);
      items.push({
        name: typeDeclaration.name,
        qualifiedName,
        kind: "class",
        startLine: index + 1,
        endLine,
        parentSymbolName: owner?.qualifiedName ?? namespaceName ?? moduleName,
        conformsTo: typeDeclaration.conformsTo,
        relatedNames: pendingAttributes
      });
      pendingAttributes = [];
      if (endLine > index + 1) {
        typeStack.push({ name: typeDeclaration.name, qualifiedName, endLine });
      }
    }

    const currentOwner = typeDeclaration
      ? { name: typeDeclaration.name, qualifiedName: qualifyPhpName(typeDeclaration.name, owner?.qualifiedName, namespaceName) }
      : typeStack[typeStack.length - 1];
    const methodDeclaration = currentOwner && canStartPhpMethod(line) ? methodForLine(signatureLine) : undefined;
    if (methodDeclaration && !typeDeclaration) {
      const parentSymbolName = currentOwner.qualifiedName;
      items.push({
        name: methodDeclaration.name,
        qualifiedName: `${parentSymbolName}::${methodDeclaration.name}`,
        kind: "method",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName,
        relatedNames: pendingAttributes
      });
      pendingAttributes = [];
    }

    const constantDeclaration = currentOwner && !methodDeclaration && !typeDeclaration ? constantForLine(line) : undefined;
    if (constantDeclaration) {
      const parentSymbolName = currentOwner.qualifiedName;
      items.push({
        name: constantDeclaration.name,
        qualifiedName: `${parentSymbolName}::${constantDeclaration.name}`,
        kind: "method",
        startLine: index + 1,
        endLine: index + 1,
        parentSymbolName
      });
    }

    const enumCaseDeclaration = currentOwner && !methodDeclaration && !typeDeclaration && !constantDeclaration ? enumCaseForLine(line) : undefined;
    if (enumCaseDeclaration) {
      const parentSymbolName = currentOwner.qualifiedName;
      items.push({
        name: enumCaseDeclaration.name,
        qualifiedName: `${parentSymbolName}::${enumCaseDeclaration.name}`,
        kind: "method",
        startLine: index + 1,
        endLine: index + 1,
        parentSymbolName
      });
    }

    const functionDeclaration = !currentOwner && canStartPhpFunction(line) ? functionForLine(signatureLine) : undefined;
    if (functionDeclaration) {
      items.push({
        name: functionDeclaration.name,
        qualifiedName: qualifyPhpName(functionDeclaration.name, undefined, namespaceName),
        kind: "function",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: namespaceName ?? moduleName,
        relatedNames: pendingAttributes
      });
      pendingAttributes = [];
    }

    const pestDeclaration = !currentOwner && !functionDeclaration ? pestTestForLine(line, lines, index, moduleName, namespaceName) : undefined;
    if (pestDeclaration) {
      items.push(pestDeclaration);
    }

    const routeDeclaration = !currentOwner && !functionDeclaration ? routeForLine(lines, index, moduleName) : undefined;
    if (routeDeclaration) {
      items.push(routeDeclaration);
    }

    const symfonyServiceDeclaration =
      !currentOwner && !functionDeclaration && !pestDeclaration && !routeDeclaration ? symfonyServiceForLine(lines, index, moduleName) : undefined;
    if (symfonyServiceDeclaration) {
      items.push(symfonyServiceDeclaration);
    }

    const appBindingDeclaration =
      currentOwner && !typeDeclaration && !methodDeclaration && !constantDeclaration && !enumCaseDeclaration
        ? appBindingForLine(lines, index, currentOwner)
        : undefined;
    if (appBindingDeclaration) {
      items.push(appBindingDeclaration);
    }

    const traitUse = currentOwner && traitUseForLine(line);
    if (traitUse) {
      const item = items.find((candidate) => candidate.qualifiedName === currentOwner.qualifiedName);
      if (item) {
        item.conformsTo = [...(item.conformsTo ?? []), ...traitUse];
      }
    }

    if (line.trim() !== "" && attributes.length === 0 && !line.trim().startsWith("#[")) {
      pendingAttributes = [];
    }
  }

  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function typeDeclarationForLine(line: string): { name: string; conformsTo: string[] } | undefined {
  const match =
    /^\s*(?:(?:abstract|final|readonly)\s+)*\b(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)([^{};]*)/u.exec(line);
  if (!match) {
    return undefined;
  }
  return { name: match[2], conformsTo: conformanceNames(match[3] ?? "") };
}

function anonymousTypeDeclarationForLine(line: string, lineNumber: number): { name: string; conformsTo: string[] } | undefined {
  const match = /\bnew\s+class\b(?:\s*\([^)]*\))?([^{};]*)/u.exec(line);
  if (!match) {
    return undefined;
  }
  return { name: `anonymous@${lineNumber}`, conformsTo: conformanceNames(match[1] ?? "") };
}

function methodForLine(line: string): { name: string } | undefined {
  const match =
    /^\s*(?:(?:public|private|protected|static|final|abstract|readonly)\s+)*function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(line);
  return match ? { name: match[1] } : undefined;
}

function functionForLine(line: string): { name: string } | undefined {
  const match = /^\s*function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(line);
  return match ? { name: match[1] } : undefined;
}

function constantForLine(line: string): { name: string } | undefined {
  const match = /^\s*(?:(?:public|private|protected)\s+)?const\s+([A-Z_][A-Z0-9_]*)\b/u.exec(line);
  return match ? { name: match[1] } : undefined;
}

function enumCaseForLine(line: string): { name: string } | undefined {
  const match = /^\s*case\s+([A-Za-z_][A-Za-z0-9_]*)\b/u.exec(line);
  return match ? { name: match[1] } : undefined;
}

function canStartPhpType(line: string): boolean {
  return /\b(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/u.test(line);
}

function canStartPhpMethod(line: string): boolean {
  return /\bfunction\b/u.test(line);
}

function canStartPhpFunction(line: string): boolean {
  return /^\s*function\b/u.test(line);
}

function phpNamespaceName(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = /^\s*namespace\s+([^;{]+)\s*[;{]/u.exec(stripLineComment(line));
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function namespaceLine(lines: string[], namespaceName: string): number {
  const index = lines.findIndex((line) => stripLineComment(line).includes(`namespace ${namespaceName}`));
  return index === -1 ? 1 : index + 1;
}

function phpImportEdges(moduleName: string, lines: string[]): CodeEdge[] {
  const modules = new Set<string>();
  for (const rawLine of lines) {
    const line = stripLineComment(rawLine);
    for (const imported of phpUseModules(line)) {
      modules.add(imported);
    }
    const included = phpIncludeModule(line);
    if (included) {
      modules.add(included);
    }
  }
  return [...modules].sort().map((targetName) => ({
    sourceSymbolName: moduleName,
    targetName,
    kind: "symbol_imports_module",
    confidence: "name"
  }));
}

function phpUseModules(line: string): string[] {
  const match = /^use\s+(?:(function|const)\s+)?([^;]+);/u.exec(line);
  if (!match) {
    return [];
  }
  return expandPhpUseExpression(match[2].trim());
}

function expandPhpUseExpression(expression: string): string[] {
  const braceStart = expression.indexOf("{");
  if (braceStart === -1) {
    const moduleName = stripPhpUseAlias(expression);
    return moduleName ? [moduleName] : [];
  }
  const braceEnd = matchingBraceIndex(expression, braceStart);
  if (braceEnd === -1) {
    const moduleName = stripPhpUseAlias(expression);
    return moduleName ? [moduleName] : [];
  }
  const prefix = expression.slice(0, braceStart);
  const inner = expression.slice(braceStart + 1, braceEnd);
  return splitTopLevel(inner, ",").flatMap((part) => expandPhpUseExpression(`${prefix}${part.trim()}`));
}

function stripPhpUseAlias(expression: string): string {
  return expression.replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s*$/iu, "").trim();
}

function matchingBraceIndex(value: string, startIndex: number): number {
  let depth = 0;
  for (let index = startIndex; index < value.length; index++) {
    if (value[index] === "{") {
      depth++;
    } else if (value[index] === "}") {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function phpIncludeModule(line: string): string | undefined {
  const match = /^\s*(?:require_once|include_once|require|include)\s*\(?\s*(.+?)\s*\)?\s*;/u.exec(line);
  return match?.[1].trim();
}

function routeForLine(lines: string[], startIndex: number, moduleName: string): PhpItem | undefined {
  const line = routeSignatureWindow(lines, startIndex);
  const lineNumber = startIndex + 1;
  const match = /^\s*(?:Route::|\$router->)(get|post|put|patch|delete|options|any|match|resource|apiResource)\s*\((.*)\)/su.exec(line);
  if (!match) {
    return undefined;
  }
  const verb = match[1];
  const routeName = routeChainStringArgument(line, "name");
  const pathName = routeFirstStringArgument(match[2] ?? "");
  const identifier = routeIdentifier(routeName ?? pathName ?? `${verb}.${lineNumber}`);
  return {
    name: `route.${verb}.${identifier}`,
    qualifiedName: `${moduleName}::route.${verb}.${identifier}`,
    kind: "method",
    startLine: lineNumber,
    endLine: endLineForStatement(lines, startIndex),
    parentSymbolName: moduleName,
    relatedNames: routeRelatedNames(line, verb)
  };
}

function routeSignatureWindow(lines: string[], startIndex: number): string {
  return statementWindow(lines, startIndex).text;
}

function routeRelatedNames(line: string, verb: string): string[] {
  const names = new Set<string>([`Route::${verb}`]);
  for (const action of routeControllerActions(line)) {
    names.add(action);
  }
  const routeName = routeChainStringArgument(line, "name");
  if (routeName) {
    names.add(routeName);
  }
  for (const middleware of routeChainStringArguments(line, "middleware")) {
    names.add(middleware);
  }
  return [...names].sort();
}

function routeControllerActions(line: string): string[] {
  const actions: string[] = [];
  for (const match of line.matchAll(/([A-Za-z_][A-Za-z0-9_]*)::class\s*,\s*['"]([^'"]+)['"]/gu)) {
    actions.push(`${match[1]}::${match[2]}`);
  }
  return actions;
}

function routeChainStringArgument(line: string, methodName: string): string | undefined {
  return routeChainStringArguments(line, methodName)[0];
}

function routeChainStringArguments(line: string, methodName: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`->${methodName}\\s*\\(\\s*['"]([^'"]+)['"]`, "gu");
  for (const match of line.matchAll(pattern)) {
    values.push(match[1]);
  }
  return values;
}

function routeFirstStringArgument(argumentsText: string): string | undefined {
  const match = /^\s*(?:\[[^\]]+\]\s*,\s*)?['"]([^'"]+)['"]/su.exec(argumentsText);
  return match?.[1];
}

function routeIdentifier(value: string): string {
  const normalized = value
    .replace(/^\//u, "")
    .replace(/\{([^}]+)\}/gu, "$1")
    .replace(/[^A-Za-z0-9_]+/gu, ".")
    .replace(/^\.+|\.+$/gu, "");
  return normalized.length > 0 ? normalized : "root";
}

function pestTestForLine(line: string, lines: string[], startIndex: number, moduleName: string, namespaceName?: string): PhpItem | undefined {
  const match = /^\s*(it|test)\s*\(\s*(['"])(.*?)\2\s*,/su.exec(line);
  if (!match) {
    return undefined;
  }
  const name = `${match[1]}.${routeIdentifier(match[3].toLowerCase())}`;
  return {
    name,
    qualifiedName: `${namespaceName ?? moduleName}::${name}`,
    kind: "function",
    startLine: startIndex + 1,
    endLine: endLineForBlock(lines, startIndex),
    parentSymbolName: namespaceName ?? moduleName,
    relatedNames: [match[3]]
  };
}

function symfonyServiceForLine(lines: string[], startIndex: number, moduleName: string): PhpItem | undefined {
  if (!/\$services->(?:set|alias)\s*\(/u.test(stripLineComment(lines[startIndex]))) {
    return undefined;
  }
  const line = routeSignatureWindow(lines, startIndex);
  const lineNumber = startIndex + 1;
  const match = /\$services->(set|alias)\s*\((.*)\)/su.exec(line);
  if (!match) {
    return undefined;
  }
  const operation = match[1];
  const args = splitPhpArguments(match[2] ?? "");
  const identifier = phpArgumentName(args[0]);
  if (!identifier) {
    return undefined;
  }
  const name = operation === "alias" ? `service.alias.${routeIdentifier(identifier)}` : `service.${routeIdentifier(identifier)}`;
  return {
    name,
    qualifiedName: `${moduleName}::${name}`,
    kind: "method",
    startLine: lineNumber,
    endLine: endLineForStatement(lines, startIndex),
    parentSymbolName: moduleName,
    relatedNames: symfonyServiceRelatedNames(line, args)
  };
}

function symfonyServiceRelatedNames(line: string, args: string[]): string[] {
  const names = new Set<string>();
  for (const arg of args.slice(0, 3)) {
    const name = phpArgumentName(arg);
    if (name) {
      names.add(name);
    }
  }
  for (const match of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_\\]*)::class\b/gu)) {
    names.add(phpTypeLeaf(match[1]));
  }
  for (const tag of routeChainStringArguments(line, "tag")) {
    names.add(tag);
  }
  return [...names].sort();
}

function appBindingForLine(lines: string[], startIndex: number, owner: Pick<PhpType, "qualifiedName">): PhpItem | undefined {
  if (!canStartAppBindingLine(stripLineComment(lines[startIndex]))) {
    return undefined;
  }
  const line = routeSignatureWindow(lines, startIndex);
  const lineNumber = startIndex + 1;
  const middleware = appMiddlewareAlias(line, owner, lineNumber);
  if (middleware) {
    return middleware;
  }
  const match = /(?:(?:\$this->app|\$app|app\(\))->|Container::)(bind|singleton|scoped|instance|alias)\s*\((.*)\)/su.exec(line);
  if (!match) {
    return undefined;
  }
  const operation = match[1];
  const args = splitPhpArguments(match[2] ?? "");
  const identifier = appBindingIdentifier(operation, args);
  if (!identifier) {
    return undefined;
  }
  const prefix = operation === "bind" ? "binding" : operation;
  const name = `${prefix}.${routeIdentifier(identifier)}`;
  return {
    name,
    qualifiedName: `${owner.qualifiedName}::${name}`,
    kind: "method",
    startLine: lineNumber,
    endLine: endLineForStatement(lines, startIndex),
    parentSymbolName: owner.qualifiedName,
    relatedNames: appBindingRelatedNames(line, args)
  };
}

function canStartAppBindingLine(line: string): boolean {
  return /(?:(?:\$this->app|\$app|app\(\))->|Container::)(?:bind|singleton|scoped|instance|alias)\s*\(/u.test(line) || /\baliasMiddleware\s*\(/u.test(line);
}

function appMiddlewareAlias(line: string, owner: Pick<PhpType, "qualifiedName">, lineNumber: number): PhpItem | undefined {
  const match = /(?:aliasMiddleware|middleware)\s*\((.*)\)/su.exec(line);
  if (!match || !/(?:router|Route::|\$router->|aliasMiddleware)/u.test(line)) {
    return undefined;
  }
  const args = splitPhpArguments(match[1] ?? "");
  const middlewareName = phpArgumentName(args[0]);
  if (!middlewareName) {
    return undefined;
  }
  const name = `middleware.${routeIdentifier(middlewareName)}`;
  return {
    name,
    qualifiedName: `${owner.qualifiedName}::${name}`,
    kind: "method",
    startLine: lineNumber,
    endLine: lineNumber,
    parentSymbolName: owner.qualifiedName,
    relatedNames: appBindingRelatedNames(line, args)
  };
}

function appBindingIdentifier(operation: string, args: string[]): string | undefined {
  if (operation === "alias") {
    return phpArgumentName(args[1]) ?? phpArgumentName(args[0]);
  }
  return phpArgumentName(args[0]);
}

function appBindingRelatedNames(line: string, args: string[]): string[] {
  const names = new Set<string>();
  for (const arg of args.slice(0, 3)) {
    const name = phpArgumentName(arg);
    if (name) {
      names.add(name);
    }
  }
  for (const match of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_\\]*)::class\b/gu)) {
    names.add(phpTypeLeaf(match[1]));
  }
  for (const match of line.matchAll(/\bnew\s+\\?([A-Za-z_][A-Za-z0-9_\\]*)\b/gu)) {
    names.add(phpTypeLeaf(match[1]));
  }
  for (const match of line.matchAll(/['"]([^'"]+)['"]/gu)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function phpArgumentName(argument: string | undefined): string | undefined {
  if (!argument) {
    return undefined;
  }
  const stringMatch = /^\s*['"]([^'"]+)['"]\s*$/su.exec(argument);
  if (stringMatch) {
    return stringMatch[1];
  }
  const classMatch = /\\?([A-Za-z_][A-Za-z0-9_\\]*)::class\b/u.exec(argument);
  if (classMatch) {
    return phpTypeLeaf(classMatch[1]);
  }
  const bareMatch = /^\s*\\?([A-Za-z_][A-Za-z0-9_\\]*)\s*$/u.exec(argument);
  if (bareMatch) {
    return phpTypeLeaf(bareMatch[1]);
  }
  return undefined;
}

function splitPhpArguments(argumentsText: string): string[] {
  return splitTopLevel(argumentsText, ",");
}

function splitTopLevel(value: string, separator: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const char of value) {
    if (quote) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth++;
    } else if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
    } else if (char === separator && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) {
    args.push(current.trim());
  }
  return args;
}

function conformanceNames(tail: string): string[] {
  const names = new Set<string>();
  for (const keyword of ["extends", "implements"]) {
    const match = new RegExp(`\\b${keyword}\\s+([^{};]+)`, "u").exec(tail);
    if (!match) {
      continue;
    }
    const stopAt = keyword === "extends" ? /\bimplements\b/u : /$/u;
    const section = match[1].split(stopAt)[0] ?? match[1];
    for (const part of section.split(",")) {
      const name = phpTypeLeaf(part.trim());
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

function traitUseForLine(line: string): string[] | undefined {
  const match = /^\s*use\s+([^;{]+)\s*;/u.exec(line);
  if (!match || line.includes("\\") && /^\s*use\s+[^;]+\\[^;]+;/u.test(line) && !line.startsWith("    ")) {
    return undefined;
  }
  const names = match[1]
    .split(",")
    .map((part) => phpTypeLeaf(part.trim()))
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name));
  return names.length > 0 ? names : undefined;
}

function conformanceEdges(item: PhpItem): CodeEdge[] {
  return [...new Set(item.conformsTo ?? [])].sort().map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_conforms_to",
    confidence: "name"
  }));
}

function relatedNameEdges(item: PhpItem): CodeEdge[] {
  return [...new Set(item.relatedNames ?? [])].sort().map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function callEdges(item: PhpItem, lines: string[]): CodeEdge[] {
  const text = lines.slice(item.startLine - 1, item.endLine).join("\n");
  const names = new Set<string>();
  const callPatterns = [
    /\bnew\s+\\?([A-Za-z_][A-Za-z0-9_\\]*)\s*\(/gu,
    /(?:->|::)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu,
    /(?<!function\s+)(?<!new\s+)\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu
  ];
  for (const pattern of callPatterns) {
    for (const match of text.matchAll(pattern)) {
      const name = phpTypeLeaf(match[1]);
      if (!PHP_CALL_STOP_WORDS.has(name) && name !== item.name) {
        names.add(name);
      }
    }
  }
  return [...names].sort().map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

const PHP_CALL_STOP_WORDS = new Set([
  "array",
  "catch",
  "class",
  "echo",
  "empty",
  "fn",
  "function",
  "isset",
  "list",
  "print",
  "return",
  "throw",
  "unset"
]);

function attributeNames(line: string): string[] {
  const names: string[] = [];
  for (const attribute of attributeExpressions(line)) {
    const match = /^\s*\\?([A-Za-z_][A-Za-z0-9_\\]*)(?:\s*\((.*)\))?\s*$/su.exec(attribute);
    if (!match) {
      continue;
    }
    names.push(phpTypeLeaf(match[1]));
    if (match[2]) {
      names.push(...attributeArgumentNames(match[2]));
    }
  }
  return names;
}

function attributeExpressions(line: string): string[] {
  const expressions: string[] = [];
  for (let start = line.indexOf("#["); start !== -1; start = line.indexOf("#[", start + 2)) {
    const end = matchingSquareBracketIndex(line, start + 1);
    if (end === -1) {
      continue;
    }
    expressions.push(...splitTopLevel(line.slice(start + 2, end), ",").filter((part) => part.trim().length > 0));
  }
  return expressions;
}

function matchingSquareBracketIndex(value: string, startIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let index = startIndex; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function attributeArgumentNames(argumentsText: string): string[] {
  const names = new Set<string>();
  for (const arg of splitTopLevel(argumentsText, ",")) {
    for (const match of arg.matchAll(/['"]([^'"]+)['"]/gu)) {
      names.add(match[1]);
    }
    for (const match of arg.matchAll(/\b([A-Za-z_][A-Za-z0-9_\\]*)::class\b/gu)) {
      names.add(phpTypeLeaf(match[1]));
    }
  }
  return [...names].sort();
}

function qualifyPhpName(name: string, parentName?: string, namespaceName?: string): string {
  if (parentName) {
    if (name.startsWith("anonymous@")) {
      return `${parentName}::${name}`;
    }
    return `${parentName}\\${name}`;
  }
  return namespaceName ? `${namespaceName}\\${name}` : name;
}

function phpTypeLeaf(name: string): string {
  const cleaned = name.replace(/^\?/, "").replace(/\([^)]*\)/gu, "").replace(/<[^>]+>/gu, "").trim();
  const parts = cleaned.split("\\");
  return parts[parts.length - 1].replace(/[^A-Za-z0-9_].*$/u, "");
}

function normalizedLines(text: string): string[] {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  return lines.length > 0 ? lines : [""];
}

function phpStructureLines(lines: string[]): string[] {
  let inBlockComment = false;
  return lines.map((line) => {
    let current = line;
    if (inBlockComment) {
      const end = current.indexOf("*/");
      if (end === -1) {
        return "";
      }
      current = current.slice(end + 2);
      inBlockComment = false;
    }
    while (current.includes("/*")) {
      const start = current.indexOf("/*");
      const end = current.indexOf("*/", start + 2);
      if (end === -1) {
        current = current.slice(0, start);
        inBlockComment = true;
        break;
      }
      current = `${current.slice(0, start)} ${current.slice(end + 2)}`;
    }
    return current;
  });
}

function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/u, "").replace(/#(?!\[).*$/u, "");
}

function signatureWindow(lines: string[], index: number, line: string): string {
  let signature = line.trimEnd();
  for (let cursor = index + 1; cursor < Math.min(lines.length, index + 6) && !/[{;]/u.test(signature); cursor++) {
    signature += ` ${stripLineComment(lines[cursor]).trim()}`;
  }
  return signature;
}

function endLineForBlock(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawOpen = false;
  for (let index = startIndex; index < lines.length; index++) {
    for (const char of lines[index]) {
      if (char === "{") {
        depth++;
        sawOpen = true;
      } else if (char === "}") {
        depth--;
        if (sawOpen && depth <= 0) {
          return index + 1;
        }
      }
    }
    if (!sawOpen && lines[index].includes(";")) {
      return index + 1;
    }
  }
  return lines.length;
}

function endLineForStatement(lines: string[], startIndex: number): number {
  return statementWindow(lines, startIndex).endLine;
}

function statementWindow(lines: string[], startIndex: number): { text: string; endLine: number } {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let sawOpen = false;
  const maxLines = Math.min(lines.length, startIndex + 40);
  for (let index = startIndex; index < maxLines; index++) {
    const line = stripLineComment(lines[index]).trim();
    parts.push(line);
    for (const char of line) {
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "(" || char === "[" || char === "{") {
        depth++;
        sawOpen = true;
      } else if (char === ")" || char === "]" || char === "}") {
        depth = Math.max(0, depth - 1);
      } else if (char === ";" && (!sawOpen || depth === 0)) {
        return { text: parts.join(" "), endLine: index + 1 };
      }
    }
  }
  return { text: parts.join(" "), endLine: startIndex + 1 };
}

function chunkForLines(symbolName: string, lines: string[], startLine: number, endLine: number): CodeChunk {
  const safeStart = Math.max(1, startLine);
  const safeEnd = Math.max(safeStart, Math.min(endLine, lines.length));
  return {
    symbolName,
    startLine: safeStart,
    endLine: safeEnd,
    text: lines.slice(safeStart - 1, safeEnd).join("\n")
  };
}
