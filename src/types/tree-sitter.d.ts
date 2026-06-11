declare module "tree-sitter" {
  export default class Parser {
    setLanguage(language: unknown): void;
    parse(input: string | ((index: number, position: unknown) => string | null)): Tree;
  }

  export interface Tree {
    rootNode: SyntaxNode;
  }

  export interface Point {
    row: number;
    column: number;
  }

  export interface SyntaxNode {
    type: string;
    text: string;
    startPosition: Point;
    endPosition: Point;
    namedChildren: SyntaxNode[];
    childForFieldName(name: string): SyntaxNode | null;
  }
}

declare module "tree-sitter-python" {
  const Python: unknown;
  export default Python;
}
