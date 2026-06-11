import type { ExtractionResult, SourceFile } from "../schema.js";

export interface LanguageExtractor {
  language: string;
  extensions: string[];
  extract(file: SourceFile): ExtractionResult;
}
