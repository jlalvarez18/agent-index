import { describe, expect, test } from "vitest";
import { extractJava } from "../../src/core/extractors/java.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "app/src/main/java/com/acme/checkout/CheckoutService.java", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "java",
    role,
    text
  };
}

describe("extractJava", () => {
  test("extracts packages, imports, annotations, Java types, constructors, methods, fields, hierarchy, and calls", () => {
    const result = extractJava(
      sourceFile(`package com.acme.checkout;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import jakarta.inject.Inject;

public interface PaymentRepository {
    PaymentState findById(String id);
}

@Service
public final class CheckoutService implements PaymentRepository {
    private final PaymentGateway gateway;

    @Inject
    public CheckoutService(PaymentGateway gateway) {
        this.gateway = gateway;
    }

    @Override
    @Transactional
    public PaymentState findById(String id) {
        return gateway.fetch(id).map(PaymentState::fromGateway).orElseThrow();
    }

    public record PaymentState(String id) {}
}

sealed interface CheckoutEvent permits PaymentStarted, PaymentFailed {}
enum PaymentStatus { STARTED, FAILED }
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "PaymentRepository",
          qualifiedName: "com.acme.checkout.PaymentRepository",
          kind: "class",
          parentSymbolName: "app/src/main/java/com/acme/checkout/CheckoutService.java"
        }),
        expect.objectContaining({
          name: "findById",
          qualifiedName: "com.acme.checkout.PaymentRepository.findById",
          kind: "method",
          parentSymbolName: "com.acme.checkout.PaymentRepository"
        }),
        expect.objectContaining({
          name: "CheckoutService",
          qualifiedName: "com.acme.checkout.CheckoutService",
          kind: "class",
          parentSymbolName: "app/src/main/java/com/acme/checkout/CheckoutService.java"
        }),
        expect.objectContaining({
          name: "CheckoutService",
          qualifiedName: "com.acme.checkout.CheckoutService.CheckoutService",
          kind: "method",
          parentSymbolName: "com.acme.checkout.CheckoutService"
        }),
        expect.objectContaining({
          name: "findById",
          qualifiedName: "com.acme.checkout.CheckoutService.findById",
          kind: "method",
          parentSymbolName: "com.acme.checkout.CheckoutService"
        }),
        expect.objectContaining({
          name: "gateway",
          qualifiedName: "com.acme.checkout.CheckoutService.gateway",
          kind: "method",
          parentSymbolName: "com.acme.checkout.CheckoutService"
        }),
        expect.objectContaining({
          name: "PaymentState",
          qualifiedName: "com.acme.checkout.CheckoutService.PaymentState",
          kind: "class",
          parentSymbolName: "com.acme.checkout.CheckoutService"
        }),
        expect.objectContaining({
          name: "CheckoutEvent",
          qualifiedName: "com.acme.checkout.CheckoutEvent",
          kind: "class"
        }),
        expect.objectContaining({
          name: "PaymentStatus",
          qualifiedName: "com.acme.checkout.PaymentStatus",
          kind: "class"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "app/src/main/java/com/acme/checkout/CheckoutService.java",
          targetName: "com.acme.checkout",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "app/src/main/java/com/acme/checkout/CheckoutService.java",
          targetName: "org.springframework.stereotype.Service",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutService",
          targetName: "PaymentRepository",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutService",
          targetName: "Service",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutService.CheckoutService",
          targetName: "Inject",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutService.findById",
          targetName: "Transactional",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutService.findById",
          targetName: "fetch",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutService.findById",
          targetName: "fromGateway",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutEvent",
          targetName: "PaymentStarted",
          kind: "symbol_conforms_to",
          confidence: "name"
        }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "com.acme.checkout.CheckoutService.findById",
          text: expect.stringContaining("gateway.fetch")
        })
      ])
    );
  });
});
