import { describe, expect, test } from "vitest";
import { extractCpp } from "../../src/core/extractors/cpp.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "source/common/router/checkout_service.cc", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "cpp",
    role,
    text
  };
}

describe("extractCpp", () => {
  test("extracts namespaces, templates, types, methods, free functions, includes, hierarchy, overrides, and calls", () => {
    const result = extractCpp(
      sourceFile(`#include <memory>
#include "checkout/payment_gateway.h"

#define CHECKOUT_API __attribute__((visibility("default")))

namespace acme::checkout {

template <typename T>
struct StateCache {
  T FindById(const std::string& id);
};

class PaymentRepository {
public:
  virtual ~PaymentRepository() = default;
  virtual PaymentState FindById(const std::string& id) const = 0;
};

CHECKOUT_API class CheckoutService final : public PaymentRepository {
public:
  explicit CheckoutService(std::shared_ptr<PaymentGateway> gateway);
  ~CheckoutService() override = default;

  PaymentState FindById(const std::string& id) const override {
    return gateway_->Fetch(id).Map(&PaymentState::FromGateway);
  }

private:
  std::shared_ptr<PaymentGateway> gateway_;
};

std::unique_ptr<CheckoutService> MakeCheckoutService(std::shared_ptr<PaymentGateway> gateway) {
  return std::make_unique<CheckoutService>(std::move(gateway));
}

}  // namespace acme::checkout
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "acme::checkout",
          qualifiedName: "acme::checkout",
          kind: "module",
          parentSymbolName: "source/common/router/checkout_service.cc"
        }),
        expect.objectContaining({
          name: "StateCache",
          qualifiedName: "acme::checkout::StateCache",
          kind: "class",
          parentSymbolName: "acme::checkout"
        }),
        expect.objectContaining({
          name: "PaymentRepository",
          qualifiedName: "acme::checkout::PaymentRepository",
          kind: "class",
          parentSymbolName: "acme::checkout"
        }),
        expect.objectContaining({
          name: "~PaymentRepository",
          qualifiedName: "acme::checkout::PaymentRepository.~PaymentRepository",
          kind: "method",
          parentSymbolName: "acme::checkout::PaymentRepository"
        }),
        expect.objectContaining({
          name: "FindById",
          qualifiedName: "acme::checkout::PaymentRepository.FindById",
          kind: "method",
          parentSymbolName: "acme::checkout::PaymentRepository"
        }),
        expect.objectContaining({
          name: "CheckoutService",
          qualifiedName: "acme::checkout::CheckoutService",
          kind: "class",
          parentSymbolName: "acme::checkout"
        }),
        expect.objectContaining({
          name: "CheckoutService",
          qualifiedName: "acme::checkout::CheckoutService.CheckoutService",
          kind: "method",
          parentSymbolName: "acme::checkout::CheckoutService"
        }),
        expect.objectContaining({
          name: "~CheckoutService",
          qualifiedName: "acme::checkout::CheckoutService.~CheckoutService",
          kind: "method",
          parentSymbolName: "acme::checkout::CheckoutService"
        }),
        expect.objectContaining({
          name: "FindById",
          qualifiedName: "acme::checkout::CheckoutService.FindById",
          kind: "method",
          parentSymbolName: "acme::checkout::CheckoutService"
        }),
        expect.objectContaining({
          name: "MakeCheckoutService",
          qualifiedName: "acme::checkout::MakeCheckoutService",
          kind: "function",
          parentSymbolName: "acme::checkout"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "source/common/router/checkout_service.cc",
          targetName: "memory",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "source/common/router/checkout_service.cc",
          targetName: "checkout/payment_gateway.h",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "acme::checkout::CheckoutService",
          targetName: "PaymentRepository",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "acme::checkout::CheckoutService.FindById",
          targetName: "Fetch",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "acme::checkout::CheckoutService.FindById",
          targetName: "FromGateway",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "acme::checkout::MakeCheckoutService",
          targetName: "make_unique",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "acme::checkout::CheckoutService.FindById",
          text: expect.stringContaining("gateway_->Fetch")
        })
      ])
    );
  });

  test("extracts CMake, Bazel, and Meson target ownership symbols", () => {
    const cmake = extractCpp(
      sourceFile(
        `add_library(checkout_core checkout_service.cc)
target_link_libraries(checkout_core PUBLIC payment_gateway)
`,
        "CMakeLists.txt"
      )
    );
    const bazel = extractCpp(
      sourceFile(
        `cc_library(
    name = "checkout_core",
    srcs = ["checkout_service.cc"],
    deps = ["//checkout:payment_gateway"],
)
`,
        "BUILD.bazel"
      )
    );
    const meson = extractCpp(
      sourceFile(
        `checkout_core = library('checkout_core', 'checkout_service.cc',
  dependencies: [payment_gateway_dep])
`,
        "meson.build"
      )
    );

    expect(cmake.symbols).toEqual(expect.arrayContaining([expect.objectContaining({ qualifiedName: "cmake.target.checkout_core" })]));
    expect(cmake.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "cmake.target.checkout_core",
          targetName: "payment_gateway",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
    expect(bazel.symbols).toEqual(expect.arrayContaining([expect.objectContaining({ qualifiedName: "bazel.cc_library.checkout_core" })]));
    expect(bazel.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "bazel.cc_library.checkout_core",
          targetName: "//checkout:payment_gateway",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
    expect(meson.symbols).toEqual(expect.arrayContaining([expect.objectContaining({ qualifiedName: "meson.library.checkout_core" })]));
  });
});
