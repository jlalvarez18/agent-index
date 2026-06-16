import { describe, expect, test } from "vitest";
import type { SourceFile } from "../../src/core/schema.js";
import { extractCython } from "../../src/core/extractors/cython.js";

function sourceFile(text: string): SourceFile {
  return {
    absolutePath: "/repo/sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp",
    relativePath: "sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp",
    language: "cython",
    role: "source",
    text
  };
}

describe("extractCython", () => {
  test("extracts templated cdef classes and methods from Cython templates", () => {
    const result = extractCython(
      sourceFile(`from sklearn.metrics._pairwise_distances_reduction._base cimport BaseDistancesReduction{{name_suffix}}

cdef class RadiusNeighbors{{name_suffix}}(BaseDistancesReduction{{name_suffix}}):
    @classmethod
    def compute(cls, X, Y, radius, sort_results=False):
        return cls()._finalize_results(return_distance=True)

    cdef void _parallel_on_X_prange_iter_finalize(self, int thread_num, int X_start, int X_end):
        self._merge_vectors(thread_num, self.chunks_n_threads)

    cdef void _merge_vectors(self, int idx, int n_threads):
        pass

    def _finalize_results(self, bint return_distance=False):
        return self.neigh_distances

cpdef helper():
    return RadiusNeighbors{{name_suffix}}
`)
    );

    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual([
      {
        name: "sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp",
        qualifiedName: "sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp",
        kind: "module",
        parentSymbolName: undefined
      },
      {
        name: "RadiusNeighbors",
        qualifiedName: "RadiusNeighbors",
        kind: "class",
        parentSymbolName: "sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp"
      },
      {
        name: "compute",
        qualifiedName: "RadiusNeighbors.compute",
        kind: "method",
        parentSymbolName: "RadiusNeighbors"
      },
      {
        name: "_parallel_on_X_prange_iter_finalize",
        qualifiedName: "RadiusNeighbors._parallel_on_X_prange_iter_finalize",
        kind: "method",
        parentSymbolName: "RadiusNeighbors"
      },
      {
        name: "_merge_vectors",
        qualifiedName: "RadiusNeighbors._merge_vectors",
        kind: "method",
        parentSymbolName: "RadiusNeighbors"
      },
      {
        name: "_finalize_results",
        qualifiedName: "RadiusNeighbors._finalize_results",
        kind: "method",
        parentSymbolName: "RadiusNeighbors"
      },
      {
        name: "helper",
        qualifiedName: "helper",
        kind: "function",
        parentSymbolName: "sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp"
      }
    ]);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSymbolName: "RadiusNeighbors.compute",
          targetName: "_finalize_results",
          kind: "symbol_calls_name"
        }),
        expect.objectContaining({
          sourceSymbolName: "RadiusNeighbors._parallel_on_X_prange_iter_finalize",
          targetName: "_merge_vectors",
          kind: "symbol_calls_name"
        })
      ])
    );
  });
});
