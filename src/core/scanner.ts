import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SourceFile } from "./schema.js";

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  "node_modules",
  ".codeindex",
  "__pycache__"
]);

export async function scanPythonFiles(target: string): Promise<SourceFile[]> {
  const root = path.resolve(target);
  const files: SourceFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await visit(path.join(directory, entry.name));
        }
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".py")) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const text = await readFile(absolutePath, "utf8");
      files.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
        language: "python",
        text
      });
    }
  }

  await visit(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
