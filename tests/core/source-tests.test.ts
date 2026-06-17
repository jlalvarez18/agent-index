import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { findSourceTests } from "../../src/core/source-tests.js";

describe("findSourceTests", () => {
  test("prefers source/test pairs with matching behavior evidence over source-only term density", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-source-tests-pair-ranking-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "lockfile.py"),
      `def parse_lock_file_entries(data):
    lock_file = data
    source_repository = data.get("source")
    environment_marker = data.get("marker")
    install_operations = []
    same_version_entries = [lock_file, source_repository, environment_marker]
    return same_version_entries, install_operations

def dump_lock_file_entries(entries):
    return [
        (entry.source_repository, entry.environment_marker, entry.install_operations)
        for entry in entries
    ]
`
    );
    await writeFile(
      path.join(root, "pkg", "selection.py"),
      `def choose_install_entry(entries, platform):
    for entry in entries:
        if entry.source == "linux-wheels" and entry.marker == platform:
            return entry
    return entries[0]
`
    );
    await writeFile(
      path.join(root, "tests", "test_install_selection.py"),
      `from pkg.selection import choose_install_entry

def test_same_version_entries_use_source_and_marker_for_install():
    entries = [
        type("Entry", (), {"source": "pypi", "marker": "darwin"})(),
        type("Entry", (), {"source": "linux-wheels", "marker": "linux"})(),
    ]
    assert choose_install_entry(entries, "linux").source == "linux-wheels"
`
    );
    await indexTarget(root);

    const result = findSourceTests(
      {
        terms: ["lock file", "same version", "source", "repository", "environment marker", "install operations"],
        roles: ["source"]
      },
      { target: root, limit: 2, testLimit: 1 }
    );

    expect(result.bundles[0].source.file).toBe("pkg/selection.py");
    expect(result.bundles[0].tests[0]).toMatchObject({
      file: "tests/test_install_selection.py"
    });
  });

  test("limits related-test fanout while keeping lower-ranked source candidates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-source-tests-fanout-limit-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    for (const name of ["alpha", "bravo", "charlie", "delta"]) {
      await writeFile(
        path.join(root, "pkg", `${name}.py`),
        `def ${name}_workflow():
    shared_navigation_topic = "${name}"
    return shared_navigation_topic
`
      );
      await writeFile(
        path.join(root, "tests", `test_${name}.py`),
        `from pkg.${name} import ${name}_workflow

def test_${name}_workflow():
    assert ${name}_workflow() == "${name}"
`
      );
    }
    await indexTarget(root);

    const result = findSourceTests(
      {
        terms: ["shared", "navigation", "topic"],
        roles: ["source"]
      },
      { target: root, limit: 4, testLimit: 1 }
    );

    expect(result.bundles).toHaveLength(4);
    expect(result.bundles.slice(0, 3).every((bundle) => bundle.tests.length === 1)).toBe(true);
    expect(result.bundles[3].tests).toEqual([]);
  });

  test("does not use test files as source candidates when source role is requested", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-source-tests-source-role-normalized-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "canvas.py"),
      `def apply_chain_group_continuation():
    return "chain group continuation"
`
    );
    await writeFile(
      path.join(root, "tests", "test_canvas.py"),
      `from pkg.canvas import apply_chain_group_continuation

def test_chain_group_continuation():
    assert apply_chain_group_continuation() == "chain group continuation"
`
    );
    await indexTarget(root);

    const result = findSourceTests(
      {
        terms: ["chain", "group", "continuation"],
        roles: ["source", "test"],
        pathHints: ["canvas"]
      },
      { target: root, limit: 2, testLimit: 1, testFanoutLimit: 1 }
    );

    expect(result.bundles[0].source.file).toBe("pkg/canvas.py");
    expect(result.bundles.map((bundle) => bundle.source.file)).not.toContain("tests/test_canvas.py");
    expect(result.bundles[0].tests[0]).toMatchObject({
      file: "tests/test_canvas.py"
    });
  });

  test("links colocated TypeScript test files without treating them as source candidates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-source-tests-colocated-ts-"));
    await mkdir(path.join(root, "src", "client"), { recursive: true });
    await writeFile(
      path.join(root, "src", "client", "api.ts"),
      `export function createClient(options) {
  return { options };
}
`
    );
    await writeFile(
      path.join(root, "src", "client", "api.test.ts"),
      `import { createClient } from "./api";

test("createClient forwards options", () => {
  expect(createClient({ baseUrl: "/" }).options.baseUrl).toBe("/");
});
`
    );
    await indexTarget(root);

    const result = findSourceTests(
      {
        terms: ["createClient", "client", "options"],
        roles: ["source", "test"],
        pathHints: ["src/client"]
      },
      { target: root, limit: 2, testLimit: 1, testFanoutLimit: 1 }
    );

    expect(result.bundles[0].source.file).toBe("src/client/api.ts");
    expect(result.bundles.map((bundle) => bundle.source.file)).not.toContain("src/client/api.test.ts");
    expect(result.bundles[0].tests[0]).toMatchObject({
      file: "src/client/api.test.ts",
      symbols: ["test_createClient_forwards_options"]
    });
    expect(result.bundles[0].tests[0].why).toEqual(expect.arrayContaining(["test imports source module", "test calls source symbol"]));
  });

  test("links SwiftPM source files to XCTest files through testable imports and async method calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-source-tests-swift-"));
    await mkdir(path.join(root, "Sources", "Checkout"), { recursive: true });
    await mkdir(path.join(root, "Tests", "CheckoutTests"), { recursive: true });
    await writeFile(
      path.join(root, "Sources", "Checkout", "PaymentAuthorizer.swift"),
      `import Foundation

protocol PaymentAuthorizing {
    func authorize(_ request: PaymentRequest) async throws -> Receipt
}

struct PaymentAuthorizer: PaymentAuthorizing {
    func authorize(_ request: PaymentRequest) async throws -> Receipt {
        try await Gateway().authorize(request)
    }
}
`
    );
    await writeFile(
      path.join(root, "Tests", "CheckoutTests", "PaymentAuthorizerTests.swift"),
      `import XCTest
@testable import Checkout

final class PaymentAuthorizerTests: XCTestCase {
    func testAuthorizeReturnsReceipt() async throws {
        let receipt = try await PaymentAuthorizer().authorize(.fixture)
        XCTAssertEqual(receipt.id, "fixture")
    }
}
`
    );
    await indexTarget(root);

    const result = findSourceTests(
      {
        terms: ["PaymentAuthorizer", "authorize", "receipt"],
        roles: ["source", "test"],
        pathHints: ["Sources/Checkout"]
      },
      { target: root, limit: 2, testLimit: 1, testFanoutLimit: 1 }
    );

    expect(result.bundles[0].source.file).toBe("Sources/Checkout/PaymentAuthorizer.swift");
    expect(result.bundles.map((bundle) => bundle.source.file)).not.toContain("Tests/CheckoutTests/PaymentAuthorizerTests.swift");
    expect(result.bundles[0].tests[0]).toMatchObject({
      file: "Tests/CheckoutTests/PaymentAuthorizerTests.swift",
      symbols: expect.arrayContaining(["PaymentAuthorizerTests.testAuthorizeReturnsReceipt"])
    });
    expect(result.bundles[0].tests[0].why).toEqual(expect.arrayContaining(["test imports source module", "test calls source symbol"]));
  });

  test("links Android Kotlin ViewModels to coroutine tests through imports and method calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-source-tests-kotlin-"));
    await mkdir(path.join(root, "app", "src", "main", "kotlin", "com", "acme", "checkout"), { recursive: true });
    await mkdir(path.join(root, "app", "src", "test", "kotlin", "com", "acme", "checkout"), { recursive: true });
    await writeFile(
      path.join(root, "app", "src", "main", "kotlin", "com", "acme", "checkout", "CheckoutViewModel.kt"),
      `package com.acme.checkout

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.Flow

class CheckoutViewModel(
    private val repository: PaymentRepository
) : ViewModel() {
    fun refresh(userId: UserId) {
        viewModelScope.launch {
            repository.observePayments(userId).collect { emitAnalytics(it) }
        }
    }
}
`
    );
    await writeFile(
      path.join(root, "app", "src", "test", "kotlin", "com", "acme", "checkout", "CheckoutViewModelTest.kt"),
      `package com.acme.checkout

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import com.acme.checkout.CheckoutViewModel

class CheckoutViewModelTest {
    @Test
    fun refreshCollectsPayments() = runTest {
        val viewModel = CheckoutViewModel(FakePaymentRepository())
        viewModel.refresh(UserId("fixture"))
    }
}
`
    );
    await indexTarget(root);

    const result = findSourceTests(
      {
        terms: ["CheckoutViewModel", "refresh", "collect", "payments"],
        roles: ["source", "test"],
        pathHints: ["app/src/main/kotlin"]
      },
      { target: root, limit: 2, testLimit: 1, testFanoutLimit: 1 }
    );

    expect(result.bundles[0].source.file).toBe("app/src/main/kotlin/com/acme/checkout/CheckoutViewModel.kt");
    expect(result.bundles.map((bundle) => bundle.source.file)).not.toContain("app/src/test/kotlin/com/acme/checkout/CheckoutViewModelTest.kt");
    expect(result.bundles[0].tests[0]).toMatchObject({
      file: "app/src/test/kotlin/com/acme/checkout/CheckoutViewModelTest.kt",
      symbols: expect.arrayContaining(["com.acme.checkout.CheckoutViewModelTest.refreshCollectsPayments"])
    });
    expect(result.bundles[0].tests[0].why).toEqual(expect.arrayContaining(["test imports source module", "test calls source symbol"]));
  });

  test("links Java Spring services to JUnit tests through imports and method calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-source-tests-java-"));
    await mkdir(path.join(root, "service", "src", "main", "java", "com", "acme", "checkout"), { recursive: true });
    await mkdir(path.join(root, "service", "src", "test", "java", "com", "acme", "checkout"), { recursive: true });
    await writeFile(
      path.join(root, "service", "src", "main", "java", "com", "acme", "checkout", "CheckoutService.java"),
      `package com.acme.checkout;

import org.springframework.stereotype.Service;

@Service
public class CheckoutService {
    public Receipt submit(OrderRequest request) {
        return workflow.submit(request).receipt();
    }
}
`
    );
    await writeFile(
      path.join(root, "service", "src", "test", "java", "com", "acme", "checkout", "CheckoutServiceTest.java"),
      `package com.acme.checkout;

import org.junit.jupiter.api.Test;
import com.acme.checkout.CheckoutService;

class CheckoutServiceTest {
    @Test
    void submitReturnsReceipt() {
        CheckoutService service = new CheckoutService();
        service.submit(OrderRequest.fixture());
    }
}
`
    );
    await indexTarget(root);

    const result = findSourceTests(
      {
        terms: ["CheckoutService", "submit", "receipt"],
        roles: ["source", "test"],
        pathHints: ["service/src/main/java"]
      },
      { target: root, limit: 2, testLimit: 1, testFanoutLimit: 1 }
    );

    expect(result.bundles[0].source.file).toBe("service/src/main/java/com/acme/checkout/CheckoutService.java");
    expect(result.bundles.map((bundle) => bundle.source.file)).not.toContain("service/src/test/java/com/acme/checkout/CheckoutServiceTest.java");
    expect(result.bundles[0].tests[0]).toMatchObject({
      file: "service/src/test/java/com/acme/checkout/CheckoutServiceTest.java",
      symbols: expect.arrayContaining(["com.acme.checkout.CheckoutServiceTest.submitReturnsReceipt"])
    });
    expect(result.bundles[0].tests[0].why).toEqual(expect.arrayContaining(["test imports source module", "test calls source symbol"]));
  });
});
