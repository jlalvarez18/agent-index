import { describe, expect, test } from "vitest";
import { extractCSharp } from "../../src/core/extractors/csharp.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "src/Checkout/CheckoutController.cs", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "csharp",
    role,
    text
  };
}

describe("extractCSharp", () => {
  test("extracts namespaces, types, members, ASP.NET roles, using directives, inheritance, extension methods, and calls", () => {
    const result = extractCSharp(
      sourceFile(`using System.Threading;
using Microsoft.AspNetCore.Mvc;
using Acme.Payments;

namespace Acme.Checkout.Api;

public interface IPaymentRepository
{
    Task<PaymentState> FindAsync(string id);
}

public record PaymentState(string Id, string Status);

public readonly struct Money
{
    public decimal Amount { get; init; }
}

public enum PaymentStatus { Started, Failed }

[ApiController]
[Route("api/[controller]")]
public sealed class CheckoutController : ControllerBase, IPaymentRepository
{
    private readonly IPaymentGateway gateway;

    public CheckoutController(IPaymentGateway gateway)
    {
        this.gateway = gateway;
    }

    public async Task<PaymentState> FindAsync(string id)
    {
        var state = await gateway.FetchAsync(id);
        return state.ToPaymentState();
    }

    public string Status { get; init; }
}

public static class PaymentExtensions
{
    public static PaymentState ToPaymentState(this PaymentDto dto)
    {
        return new PaymentState(dto.Id, dto.Status);
    }
}

namespace Acme.Checkout.Workers
{
    public sealed class PaymentHostedService : BackgroundService
    {
        protected override Task ExecuteAsync(CancellationToken stoppingToken)
        {
            return Task.CompletedTask;
        }
    }
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Acme.Checkout.Api",
          qualifiedName: "Acme.Checkout.Api",
          kind: "module",
          parentSymbolName: "src/Checkout/CheckoutController.cs"
        }),
        expect.objectContaining({
          name: "IPaymentRepository",
          qualifiedName: "Acme.Checkout.Api.IPaymentRepository",
          kind: "class",
          parentSymbolName: "Acme.Checkout.Api"
        }),
        expect.objectContaining({
          name: "FindAsync",
          qualifiedName: "Acme.Checkout.Api.IPaymentRepository.FindAsync",
          kind: "method",
          parentSymbolName: "Acme.Checkout.Api.IPaymentRepository"
        }),
        expect.objectContaining({
          name: "PaymentState",
          qualifiedName: "Acme.Checkout.Api.PaymentState",
          kind: "class"
        }),
        expect.objectContaining({
          name: "Money",
          qualifiedName: "Acme.Checkout.Api.Money",
          kind: "class"
        }),
        expect.objectContaining({
          name: "Amount",
          qualifiedName: "Acme.Checkout.Api.Money.Amount",
          kind: "method",
          parentSymbolName: "Acme.Checkout.Api.Money"
        }),
        expect.objectContaining({
          name: "PaymentStatus",
          qualifiedName: "Acme.Checkout.Api.PaymentStatus",
          kind: "class"
        }),
        expect.objectContaining({
          name: "CheckoutController",
          qualifiedName: "Acme.Checkout.Api.CheckoutController",
          kind: "class"
        }),
        expect.objectContaining({
          name: "CheckoutController",
          qualifiedName: "Acme.Checkout.Api.CheckoutController.CheckoutController",
          kind: "method"
        }),
        expect.objectContaining({
          name: "FindAsync",
          qualifiedName: "Acme.Checkout.Api.CheckoutController.FindAsync",
          kind: "method"
        }),
        expect.objectContaining({
          name: "Status",
          qualifiedName: "Acme.Checkout.Api.CheckoutController.Status",
          kind: "method"
        }),
        expect.objectContaining({
          name: "ToPaymentState",
          qualifiedName: "Acme.Checkout.Api.PaymentExtensions.PaymentDto.ToPaymentState",
          kind: "method"
        }),
        expect.objectContaining({
          name: "PaymentHostedService",
          qualifiedName: "Acme.Checkout.Workers.PaymentHostedService",
          kind: "class"
        }),
        expect.objectContaining({
          name: "ExecuteAsync",
          qualifiedName: "Acme.Checkout.Workers.PaymentHostedService.ExecuteAsync",
          kind: "method"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "src/Checkout/CheckoutController.cs",
          targetName: "Microsoft.AspNetCore.Mvc",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "Acme.Checkout.Api.CheckoutController",
          targetName: "ControllerBase",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "Acme.Checkout.Api.CheckoutController",
          targetName: "IPaymentRepository",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "Acme.Checkout.Api.CheckoutController",
          targetName: "ApiController",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Acme.Checkout.Api.CheckoutController.FindAsync",
          targetName: "FetchAsync",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Acme.Checkout.Api.PaymentExtensions.PaymentDto.ToPaymentState",
          targetName: "PaymentDto",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Acme.Checkout.Workers.PaymentHostedService",
          targetName: "BackgroundService",
          kind: "symbol_conforms_to",
          confidence: "name"
        }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "Acme.Checkout.Api.CheckoutController.FindAsync",
          text: expect.stringContaining("gateway.FetchAsync")
        })
      ])
    );
  });

  test("distinguishes overloaded methods with compact parameter signatures", () => {
    const result = extractCSharp(
      sourceFile(`namespace Acme.Parsing;

public sealed class Parser
{
    public Result Parse(string text) => ParseCore(text);
    public Result Parse(ReadOnlySpan<char> text) => ParseCore(text.ToString());
    public Result Parse(string text, ParserOptions options) => ParseCore(text);
    public Result Format(string text) => ParseCore(text);
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Parse",
          qualifiedName: "Acme.Parsing.Parser.Parse(string)",
          kind: "method"
        }),
        expect.objectContaining({
          name: "Parse",
          qualifiedName: "Acme.Parsing.Parser.Parse(ReadOnlySpan<char>)",
          kind: "method"
        }),
        expect.objectContaining({
          name: "Parse",
          qualifiedName: "Acme.Parsing.Parser.Parse(string,ParserOptions)",
          kind: "method"
        }),
        expect.objectContaining({
          name: "Format",
          qualifiedName: "Acme.Parsing.Parser.Format",
          kind: "method"
        })
      ])
    );
    expect(result.chunks.map((chunk) => chunk.symbolName)).toEqual(
      expect.arrayContaining([
        "Acme.Parsing.Parser.Parse(string)",
        "Acme.Parsing.Parser.Parse(ReadOnlySpan<char>)",
        "Acme.Parsing.Parser.Parse(string,ParserOptions)"
      ])
    );
  });

  test("emits record primary-constructor parameters as property symbols", () => {
    const result = extractCSharp(
      sourceFile(`namespace Acme.Checkout;

public sealed record PaymentState(string Id, string Status, decimal Amount);
public readonly record struct Money(decimal Amount, string Currency);
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Id",
          qualifiedName: "Acme.Checkout.PaymentState.Id",
          kind: "method",
          parentSymbolName: "Acme.Checkout.PaymentState"
        }),
        expect.objectContaining({
          name: "Status",
          qualifiedName: "Acme.Checkout.PaymentState.Status",
          kind: "method",
          parentSymbolName: "Acme.Checkout.PaymentState"
        }),
        expect.objectContaining({
          name: "Amount",
          qualifiedName: "Acme.Checkout.Money.Amount",
          kind: "method",
          parentSymbolName: "Acme.Checkout.Money"
        }),
        expect.objectContaining({
          name: "Currency",
          qualifiedName: "Acme.Checkout.Money.Currency",
          kind: "method",
          parentSymbolName: "Acme.Checkout.Money"
        })
      ])
    );
  });
});
