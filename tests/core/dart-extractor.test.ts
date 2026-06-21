import { describe, expect, test } from "vitest";
import { extractDart } from "../../src/core/extractors/dart.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "lib/src/checkout_controller.dart", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "dart",
    role,
    text
  };
}

describe("extractDart", () => {
  test("extracts imports, typedefs, classes, constructors, getters, setters, fields, methods, and calls", () => {
    const result = extractDart(
      sourceFile(`import 'dart:async';
import 'package:flutter/material.dart';
import '../models/cart.dart';

typedef ReceiptMapper = Receipt Function(Map<String, Object?> json);

class CheckoutController extends ChangeNotifier with DiagnosticableTreeMixin implements CheckoutState {
  final PaymentRepository repository;
  Receipt? _receipt;

  CheckoutController(this.repository);
  CheckoutController.guest() : repository = PaymentRepository.guest();

  String get receiptText => _receipt?.label ?? '';

  set receipt(Receipt? value) {
    _receipt = value;
    notifyListeners();
  }

  Future<void> submit(Cart cart) async {
    final receipt = await repository.authorize(cart);
    this.receipt = receipt;
    trackReceipt(receipt);
  }
}

Future<Receipt> trackReceipt(Receipt receipt) async {
  return receipt;
}
`)
    );

    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual([
      { name: "lib/src/checkout_controller.dart", qualifiedName: "lib/src/checkout_controller.dart", kind: "module", parentSymbolName: undefined },
      { name: "ReceiptMapper", qualifiedName: "ReceiptMapper", kind: "typealias", parentSymbolName: "lib/src/checkout_controller.dart" },
      { name: "CheckoutController", qualifiedName: "CheckoutController", kind: "class", parentSymbolName: "lib/src/checkout_controller.dart" },
      { name: "repository", qualifiedName: "CheckoutController.repository", kind: "method", parentSymbolName: "CheckoutController" },
      { name: "_receipt", qualifiedName: "CheckoutController._receipt", kind: "method", parentSymbolName: "CheckoutController" },
      { name: "CheckoutController", qualifiedName: "CheckoutController.CheckoutController", kind: "method", parentSymbolName: "CheckoutController" },
      { name: "CheckoutController.guest", qualifiedName: "CheckoutController.CheckoutController.guest", kind: "method", parentSymbolName: "CheckoutController" },
      { name: "receiptText", qualifiedName: "CheckoutController.receiptText", kind: "method", parentSymbolName: "CheckoutController" },
      { name: "receipt", qualifiedName: "CheckoutController.receipt", kind: "method", parentSymbolName: "CheckoutController" },
      { name: "submit", qualifiedName: "CheckoutController.submit", kind: "method", parentSymbolName: "CheckoutController" },
      { name: "trackReceipt", qualifiedName: "trackReceipt", kind: "function", parentSymbolName: "lib/src/checkout_controller.dart" }
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "lib/src/checkout_controller.dart", targetName: "dart:async", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "lib/src/checkout_controller.dart", targetName: "package:flutter/material.dart", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "lib/src/checkout_controller.dart", targetName: "../models/cart.dart", kind: "symbol_imports_module", confidence: "name" },
        { sourceSymbolName: "CheckoutController", targetName: "ChangeNotifier", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "CheckoutController", targetName: "DiagnosticableTreeMixin", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "CheckoutController", targetName: "CheckoutState", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "CheckoutController.submit", targetName: "authorize", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "CheckoutController.submit", targetName: "trackReceipt", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "CheckoutController.receipt", targetName: "notifyListeners", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "CheckoutController.submit",
          text: expect.stringContaining("repository.authorize")
        })
      ])
    );
  });

  test("extracts mixins, enums, extensions, Flutter widgets, and test declarations", () => {
    const result = extractDart(
      sourceFile(
        `import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

mixin LoadingState on ChangeNotifier {
  bool get isLoading => false;
}

enum CheckoutStatus {
  idle,
  submitting,
  failed;

  bool get canSubmit => this == idle;
}

extension CartFormatting on Cart {
  String get displayTotal => formatCurrency(total);
}

class CheckoutButton extends StatelessWidget {
  const CheckoutButton({super.key, required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: onPressed,
      child: const Text('Checkout'),
    );
  }
}

void main() {
  testWidgets('submits checkout', (tester) async {
    await tester.pumpWidget(CheckoutButton(onPressed: () {}));
    expect(find.text('Checkout'), findsOneWidget);
  });
}
`,
        "test/widgets/checkout_button_test.dart",
        "test"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "LoadingState", qualifiedName: "LoadingState", kind: "class" }),
        expect.objectContaining({ name: "CheckoutStatus", qualifiedName: "CheckoutStatus", kind: "class" }),
        expect.objectContaining({ name: "idle", qualifiedName: "CheckoutStatus.idle", kind: "method" }),
        expect.objectContaining({ name: "canSubmit", qualifiedName: "CheckoutStatus.canSubmit", kind: "method" }),
        expect.objectContaining({ name: "CartFormatting", qualifiedName: "Cart.extension.CartFormatting", kind: "class" }),
        expect.objectContaining({ name: "displayTotal", qualifiedName: "Cart.extension.CartFormatting.displayTotal", kind: "method" }),
        expect.objectContaining({ name: "CheckoutButton", qualifiedName: "CheckoutButton", kind: "class" }),
        expect.objectContaining({ name: "CheckoutButton", qualifiedName: "CheckoutButton.CheckoutButton", kind: "method" }),
        expect.objectContaining({ name: "onPressed", qualifiedName: "CheckoutButton.onPressed", kind: "method" }),
        expect.objectContaining({ name: "build", qualifiedName: "CheckoutButton.build", kind: "method" }),
        expect.objectContaining({ name: "main", qualifiedName: "main", kind: "function" }),
        expect.objectContaining({ name: "submits_checkout", qualifiedName: "main.submits_checkout", kind: "method", parentSymbolName: "main" })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { sourceSymbolName: "LoadingState", targetName: "ChangeNotifier", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "CheckoutButton", targetName: "StatelessWidget", kind: "symbol_conforms_to", confidence: "name" },
        { sourceSymbolName: "CheckoutButton.build", targetName: "ElevatedButton", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "main.submits_checkout", targetName: "pumpWidget", kind: "symbol_calls_name", confidence: "name" },
        { sourceSymbolName: "main.submits_checkout", targetName: "CheckoutButton", kind: "symbol_calls_name", confidence: "name" }
      ])
    );
  });
});
