import { describe, expect, test } from "vitest";
import { extractSwift } from "../../src/core/extractors/swift.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "Sources/App/CheckoutViewModel.swift", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "swift",
    role,
    text
  };
}

describe("extractSwift", () => {
  test("extracts imports, protocols, types, extensions, methods, properties, chunks, and calls", () => {
    const result = extractSwift(
      sourceFile(`import Foundation
import SwiftUI

protocol PaymentAuthorizing {
    typealias Context = Cart
    func authorize(_ cart: Cart) async throws -> Receipt
}

struct CheckoutViewModel: ObservableObject {
    private let authorizer: PaymentAuthorizing
    var receiptText: String {
        receipt?.description ?? ""
    }

    func submit(cart: Cart) async -> Result<Receipt, CheckoutError> {
        do {
            let receipt = try await authorizer.authorize(cart)
            return .success(receipt)
        } catch {
            return .failure(mapError(error))
        }
    }

    private func mapError(_ error: Error) -> CheckoutError {
        CheckoutError.paymentFailed(error)
    }
}

extension CheckoutViewModel: Sendable {
    func retry(cart: Cart) async -> Result<Receipt, CheckoutError> {
        await submit(cart: cart)
    }
}
`)
    );

    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual([
      { name: "Sources/App/CheckoutViewModel.swift", qualifiedName: "Sources/App/CheckoutViewModel.swift", kind: "module", parentSymbolName: undefined },
      { name: "PaymentAuthorizing", qualifiedName: "PaymentAuthorizing", kind: "class", parentSymbolName: "Sources/App/CheckoutViewModel.swift" },
      { name: "Context", qualifiedName: "PaymentAuthorizing.Context", kind: "typealias", parentSymbolName: "PaymentAuthorizing" },
      { name: "authorize", qualifiedName: "PaymentAuthorizing.authorize", kind: "method", parentSymbolName: "PaymentAuthorizing" },
      { name: "CheckoutViewModel", qualifiedName: "CheckoutViewModel", kind: "class", parentSymbolName: "Sources/App/CheckoutViewModel.swift" },
      { name: "receiptText", qualifiedName: "CheckoutViewModel.receiptText", kind: "method", parentSymbolName: "CheckoutViewModel" },
      { name: "submit", qualifiedName: "CheckoutViewModel.submit", kind: "method", parentSymbolName: "CheckoutViewModel" },
      { name: "mapError", qualifiedName: "CheckoutViewModel.mapError", kind: "method", parentSymbolName: "CheckoutViewModel" },
      { name: "CheckoutViewModel", qualifiedName: "CheckoutViewModel.extension.Sendable", kind: "class", parentSymbolName: "Sources/App/CheckoutViewModel.swift" },
      { name: "retry", qualifiedName: "CheckoutViewModel.extension.Sendable.retry", kind: "method", parentSymbolName: "CheckoutViewModel.extension.Sendable" }
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "Sources/App/CheckoutViewModel.swift",
          targetName: "Foundation",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutViewModel.submit",
          targetName: "authorize",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutViewModel",
          targetName: "ObservableObject",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutViewModel.extension.Sendable",
          targetName: "Sendable",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutViewModel.submit",
          targetName: "mapError",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutViewModel.extension.Sendable.retry",
          targetName: "submit",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );

    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "CheckoutViewModel.submit",
          text: expect.stringContaining("Result<Receipt, CheckoutError>")
        })
      ])
    );
  });

  test("extracts XCTest and async test methods as navigable test symbols", () => {
    const result = extractSwift(
      sourceFile(
        `import XCTest
@testable import App

final class CheckoutViewModelTests: XCTestCase {
    func testSubmitMapsAuthorizationFailure() async throws {
        let model = CheckoutViewModel(authorizer: FailingAuthorizer())
        let result = await model.submit(cart: .fixture)
        XCTAssertEqual(result.error, .paymentFailed)
    }
}
`,
        "Tests/AppTests/CheckoutViewModelTests.swift",
        "test"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "CheckoutViewModelTests",
          qualifiedName: "CheckoutViewModelTests",
          kind: "class",
          parentSymbolName: "Tests/AppTests/CheckoutViewModelTests.swift"
        }),
        expect.objectContaining({
          name: "testSubmitMapsAuthorizationFailure",
          qualifiedName: "CheckoutViewModelTests.testSubmitMapsAuthorizationFailure",
          kind: "method",
          parentSymbolName: "CheckoutViewModelTests"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "Tests/AppTests/CheckoutViewModelTests.swift",
          targetName: "App",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutViewModelTests.testSubmitMapsAuthorizationFailure",
          targetName: "submit",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutViewModelTests.testSubmitMapsAuthorizationFailure",
          targetName: "XCTAssertEqual",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("extracts Package.swift manifests and qualified Swift imports for build-tooling navigation", () => {
    const result = extractSwift(
      sourceFile(
        `// swift-tools-version: 5.9
import PackageDescription
@_exported import ArgumentParser
public import struct Foundation.URL

let package = Package(
    name: "CheckoutTools",
    products: [
        .executable(name: "checkout-cli", targets: ["CheckoutCLI"])
    ],
    targets: [
        .executableTarget(name: "CheckoutCLI", dependencies: ["ArgumentParser"]),
        .testTarget(name: "CheckoutCLITests", dependencies: ["CheckoutCLI"])
    ]
)
`,
        "Package.swift"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "package",
          qualifiedName: "package",
          kind: "function",
          parentSymbolName: "Package.swift"
        }),
        expect.objectContaining({
          name: "checkout-cli",
          qualifiedName: "package.executable.checkout_cli",
          kind: "method",
          parentSymbolName: "package"
        }),
        expect.objectContaining({
          name: "CheckoutCLI",
          qualifiedName: "package.executableTarget.CheckoutCLI",
          kind: "method",
          parentSymbolName: "package"
        }),
        expect.objectContaining({
          name: "CheckoutCLITests",
          qualifiedName: "package.testTarget.CheckoutCLITests",
          kind: "method",
          parentSymbolName: "package"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "Package.swift",
          targetName: "PackageDescription",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "Package.swift",
          targetName: "ArgumentParser",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "Package.swift",
          targetName: "Foundation",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "package",
          targetName: "Package",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "package",
          targetName: "executableTarget",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "package",
          targetName: "testTarget",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "package.executable.checkout_cli",
          targetName: "CheckoutCLI",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "package.executableTarget.CheckoutCLI",
          targetName: "ArgumentParser",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "package.testTarget.CheckoutCLITests",
          targetName: "CheckoutCLI",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "package",
          text: expect.stringContaining(".testTarget")
        })
      ])
    );
  });

  test("keeps constrained Swift extensions navigable as distinct implementation blocks", () => {
    const result = extractSwift(
      sourceFile(`import NIOCore

struct EventLoopFuture<Value> {}

extension EventLoopFuture where Value == Void {
    func cascadeFailure(to promise: EventLoopPromise<Void>) {
        promise.fail(ChannelError.ioOnClosedChannel)
    }
}

extension EventLoopFuture: Sendable {
    func hop(to eventLoop: EventLoop) -> EventLoopFuture<Value> {
        flatMapThrowing { value in value }
    }
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "EventLoopFuture",
          qualifiedName: "EventLoopFuture.extension.Value_Void",
          kind: "class",
          parentSymbolName: "Sources/App/CheckoutViewModel.swift"
        }),
        expect.objectContaining({
          name: "cascadeFailure",
          qualifiedName: "EventLoopFuture.extension.Value_Void.cascadeFailure",
          kind: "method",
          parentSymbolName: "EventLoopFuture.extension.Value_Void"
        }),
        expect.objectContaining({
          name: "EventLoopFuture",
          qualifiedName: "EventLoopFuture.extension.Sendable",
          kind: "class",
          parentSymbolName: "Sources/App/CheckoutViewModel.swift"
        }),
        expect.objectContaining({
          name: "hop",
          qualifiedName: "EventLoopFuture.extension.Sendable.hop",
          kind: "method",
          parentSymbolName: "EventLoopFuture.extension.Sendable"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "EventLoopFuture.extension.Value_Void.cascadeFailure",
          targetName: "fail",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "EventLoopFuture.extension.Sendable",
          targetName: "Sendable",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "EventLoopFuture.extension.Sendable.hop",
          targetName: "flatMapThrowing",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("extracts SwiftUI property-wrapper view model flow", () => {
    const result = extractSwift(
      sourceFile(`import SwiftUI

@MainActor
final class CheckoutViewModel: ObservableObject {
    func submit() async throws {
        try await service.authorize()
    }
}

struct CheckoutView: View {
    @StateObject private var viewModel = CheckoutViewModel()

    var body: some View {
        Button("Pay") {
            Task {
                try? await viewModel.submit()
            }
        }
    }
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "viewModel",
          qualifiedName: "CheckoutView.viewModel",
          kind: "method",
          parentSymbolName: "CheckoutView"
        }),
        expect.objectContaining({
          name: "body",
          qualifiedName: "CheckoutView.body",
          kind: "method",
          parentSymbolName: "CheckoutView"
        }),
        expect.objectContaining({
          name: "submit",
          qualifiedName: "CheckoutViewModel.submit",
          kind: "method",
          parentSymbolName: "CheckoutViewModel"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "CheckoutView.viewModel",
          targetName: "CheckoutViewModel",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutView.body",
          targetName: "submit",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("extracts Swift error enum cases for Result and throws flow tracing", () => {
    const result = extractSwift(
      sourceFile(`import Foundation

enum CheckoutError: Error {
    case paymentFailed(Error)
    case invalidCart, cancelled
}

struct CheckoutService {
    func submit(cart: Cart) async -> Result<Receipt, CheckoutError> {
        do {
            let receipt = try await gateway.authorize(cart)
            return .success(receipt)
        } catch {
            return .failure(mapError(error))
        }
    }

    func mapError(_ error: Error) -> CheckoutError {
        CheckoutError.paymentFailed(error)
    }
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "paymentFailed",
          qualifiedName: "CheckoutError.paymentFailed",
          kind: "method",
          parentSymbolName: "CheckoutError"
        }),
        expect.objectContaining({
          name: "invalidCart",
          qualifiedName: "CheckoutError.invalidCart",
          kind: "method",
          parentSymbolName: "CheckoutError"
        }),
        expect.objectContaining({
          name: "cancelled",
          qualifiedName: "CheckoutError.cancelled",
          kind: "method",
          parentSymbolName: "CheckoutError"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "CheckoutService.submit",
          targetName: "failure",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutService.submit",
          targetName: "mapError",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "CheckoutService.mapError",
          targetName: "paymentFailed",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("ignores braces and calls inside multiline string bodies when finding Swift structure", () => {
    const result = extractSwift(
      sourceFile(`extension CommandInfo {
  var bashCompletionScript: String {
    """
    offer_flags_options() {
      case "\${word}" in
        --)
          COMPREPLY+=($(compgen -W "\${flags[*]}" -- "\${cur}"))
          ;;
      esac
    }
    """
  }

  func valueCompletion(_ arg: ArgumentInfo) -> String {
    renderCompletion(arg)
  }
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          qualifiedName: "CommandInfo.extension.bashCompletionScript",
          startLine: 2,
          endLine: 12
        }),
        expect.objectContaining({
          qualifiedName: "CommandInfo.extension.valueCompletion",
          startLine: 14,
          endLine: 16
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "CommandInfo.extension.valueCompletion",
          targetName: "renderCompletion",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
    expect(result.edges).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSymbolName: "CommandInfo.extension.bashCompletionScript",
          targetName: "offer_flags_options"
        })
      ])
    );
  });
});
