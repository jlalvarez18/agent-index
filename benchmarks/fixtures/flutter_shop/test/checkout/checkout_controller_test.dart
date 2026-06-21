import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_shop/src/checkout/checkout_controller.dart';
import 'package:flutter_shop/src/models/cart.dart';
import 'package:flutter_shop/src/models/receipt.dart';
import 'package:flutter_shop/src/payments/payment_repository.dart';

void main() {
  test('submit authorizes payment and notifies listeners', () async {
    final controller = CheckoutController(
      PaymentRepository((json) => Receipt(json['id']! as String, json['label']! as String)),
    );
    var notifications = 0;
    controller.addListener(() => notifications += 1);

    await controller.submit(const Cart(4200));

    expect(controller.status, CheckoutStatus.paid);
    expect(controller.message, 'Paid 4200 cents');
    expect(notifications, 2);
  });
}
