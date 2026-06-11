# Agent Index Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript/Node prototype that tests whether a symbol-first local index helps coding agents find code better than plain text search.

**Architecture:** The implementation uses a reusable core plus a thin CLI. Python files are scanned, parsed with Tree-sitter, written to SQLite/FTS5, queried with symbol-first ranking, and measured with golden benchmark questions.

**Tech Stack:** TypeScript, Node.js, Commander, Better SQLite3, SQLite FTS5, Tree-sitter Python, Vitest.

---

## Tasks

- [x] Scaffold `package.json`, `tsconfig.json`, and `vitest.config.ts`.
- [x] Add schema types for files, symbols, chunks, edges, query results, and benchmark results.
- [x] Implement Python file scanning with ignored generated/vendor directories.
- [x] Implement Tree-sitter Python extraction for modules, classes, functions, methods, chunks, imports, and name-based calls.
- [x] Implement SQLite indexing at `<target>/.codeindex/index.sqlite`.
- [x] Implement FTS query with symbol, file path, identifier, source-text, and nearby-edge ranking signals.
- [x] Implement benchmark scoring for Hit@1, Hit@5, MRR, partial file hits, and latency.
- [x] Implement CLI commands: `index`, `query`, and `benchmark`.
- [x] Add a 10-question Graphify benchmark seed file.
- [x] Add process and publishing documentation.

## Verification

Run:

```bash
npm test
npm run build
npm run agent-index index ./work/graphify-v8
npm run agent-index benchmark ./benchmarks/graphify-python.json --target ./work/graphify-v8
```

The final two commands require `./work/graphify-v8` to exist locally.
