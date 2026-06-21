import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_shop/src/checkout/checkout_button.dart';
import 'package:flutter_shop/src/checkout/checkout_controller.dart';
import 'package:flutter_shop/src/models/cart.dart';
import 'package:flutter_shop/src/models/receipt.dart';
import 'package:flutter_shop/src/payments/payment_repository.dart';

void main() {
  testWidgets('checkout button submits the cart when enabled', (tester) async {
    final controller = CheckoutController(
      PaymentRepository((json) => Receipt(json['id']! as String, json['label']! as String)),
    );

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: CheckoutButton(controller: controller, cart: const Cart(4200)),
      ),
    );
    await tester.tap(find.text('Checkout'));

    expect(controller.status, CheckoutStatus.paid);
  });
}
