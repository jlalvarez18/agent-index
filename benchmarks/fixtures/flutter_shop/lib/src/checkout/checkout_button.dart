import 'package:flutter/widgets.dart';

import '../models/cart.dart';
import 'checkout_controller.dart';

class CheckoutButton extends StatelessWidget {
  const CheckoutButton({
    super.key,
    required this.controller,
    required this.cart,
  });

  final CheckoutController controller;
  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final enabled = controller.status.canSubmit;
    return GestureDetector(
      onTap: enabled ? () => controller.submit(cart) : null,
      child: Text(enabled ? 'Checkout' : 'Submitting'),
    );
  }
}
