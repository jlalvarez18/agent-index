import Parser, { type SyntaxNode } from "tree-sitter";
import Python from "tree-sitter-python";
import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

const parser = new Parser();
parser.setLanguage(Python);

export const pythonExtractor: LanguageExtractor = {
  language: "python",
  extensions: [".py"],
  extract: extractPython
};

export function extractPython(file: SourceFile): ExtractionResult {
  const tree = parser.parse((index) => file.text.slice(index, index + 4096) || null);
  const root = tree.rootNode;
  const moduleName = file.relativePath;
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: sourceLineCount(file.text)
  };
  const symbols: CodeSymbol[] = [moduleSymbol];
  const chunks: CodeChunk[] = [chunkForNode(moduleName, root, file.text, 1, moduleSymbol.endLine)];
  const edges: CodeEdge[] = [];

  for (const child of root.namedChildren) {
    collectTopLevel(child, moduleName, file, symbols, chunks, edges);
  }

  return { file, symbols, chunks, edges };
}

function collectTopLevel(
  node: SyntaxNode,
  moduleName: string,
  file: SourceFile,
  symbols: CodeSymbol[],
  chunks: CodeChunk[],
  edges: CodeEdge[]
) {
  if (node.type === "import_statement" || node.type === "import_from_statement") {
    for (const imported of importedModules(node)) {
      edges.push({
        sourceSymbolName: moduleName,
        targetName: imported,
        kind: "symbol_imports_module",
        confidence: "name"
      });
    }
    return;
  }

  if (node.type === "class_definition") {
    const name = requiredName(node);
    const symbol = symbolForNode(name, name, "class", node, moduleName);
    symbols.push(symbol);
    chunks.push(chunkForNode(symbol.qualifiedName, node, file.text));
    edges.push({
      sourceSymbolName: moduleName,
      targetName: symbol.qualifiedName,
      kind: "file_contains_symbol",
      confidence: "exact"
    });

    const body = node.childForFieldName("body");
    for (const member of body?.namedChildren ?? []) {
      if (member.type === "function_definition") {
        collectFunction(member, file, symbols, chunks, edges, name);
      }
    }
    return;
  }

  if (node.type === "function_definition") {
    collectFunction(node, file, symbols, chunks, edges, moduleName);
  }
}

function collectFunction(
  node: SyntaxNode,
  file: SourceFile,
  symbols: CodeSymbol[],
  chunks: CodeChunk[],
  edges: CodeEdge[],
  parentSymbolName: string
) {
  const name = requiredName(node);
  const isMethod = parentSymbolName !== file.relativePath;
  const qualifiedName = isMethod ? `${parentSymbolName}.${name}` : name;
  const symbol = symbolForNode(name, qualifiedName, isMethod ? "method" : "function", node, parentSymbolName);
  symbols.push(symbol);
  chunks.push(chunkForNode(symbol.qualifiedName, node, file.text));
  edges.push({
    sourceSymbolName: parentSymbolName,
    targetName: symbol.qualifiedName,
    kind: parentSymbolName === file.relativePath ? "file_contains_symbol" : "symbol_contains_symbol",
    confidence: "exact"
  });

  for (const calledName of calledNames(node)) {
    edges.push({
      sourceSymbolName: symbol.qualifiedName,
      targetName: calledName,
      kind: "symbol_calls_name",
      confidence: "name"
    });
  }
}

function symbolForNode(
  name: string,
  qualifiedName: string,
  kind: CodeSymbol["kind"],
  node: SyntaxNode,
  parentSymbolName?: string
): CodeSymbol {
  return {
    name,
    qualifiedName,
    kind,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    parentSymbolName
  };
}

function chunkForNode(
  symbolName: string,
  node: SyntaxNode,
  source: string,
  startLine = node.startPosition.row + 1,
  endLine = node.endPosition.row + 1
): CodeChunk {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  return {
    symbolName,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}

function requiredName(node: SyntaxNode): string {
  const name = node.childForFieldName("name")?.text;
  if (!name) {
    throw new Error(`Expected ${node.type} to have a name`);
  }
  return name;
}

function importedModules(node: SyntaxNode): string[] {
  if (node.type === "import_statement") {
    return node.namedChildren
      .map((child) => child.text.split(/\s+as\s+/)[0])
      .filter(Boolean);
  }

  const moduleName = node.childForFieldName("module_name")?.text;
  if (moduleName) {
    return [moduleName];
  }

  const dottedName = node.namedChildren.find((child) => child.type === "dotted_name")?.text;
  return dottedName ? [dottedName] : [];
}

function calledNames(node: SyntaxNode): string[] {
  const names = new Set<string>();

  function visit(current: SyntaxNode) {
    if (current.type === "call") {
      const fn = current.childForFieldName("function");
      const name = callableName(fn);
      if (name) {
        names.add(name);
      }
    }

    for (const child of current.namedChildren) {
      visit(child);
    }
  }

  visit(node);
  return [...names].sort();
}

function callableName(node: SyntaxNode | null): string | undefined {
  if (!node) {
    return undefined;
  }

  if (node.type === "identifier") {
    return node.text;
  }

  if (node.type === "attribute") {
    const attribute = node.childForFieldName("attribute");
    return attribute?.text;
  }

  return node.namedChildren.find((child) => child.type === "identifier")?.text;
}

function sourceLineCount(source: string): number {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  return Math.max(lines.length, 1);
}
