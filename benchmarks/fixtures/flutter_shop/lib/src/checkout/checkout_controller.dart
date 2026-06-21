import 'package:flutter/foundation.dart';

import '../models/cart.dart';
import '../models/receipt.dart';
import '../payments/payment_repository.dart';

enum CheckoutStatus {
  idle,
  submitting,
  paid,
  failed;

  bool get canSubmit => this == idle || this == failed;
}

class CheckoutController extends ChangeNotifier {
  CheckoutController(this.repository);

  final PaymentRepository repository;
  CheckoutStatus status = CheckoutStatus.idle;
  String message = '';
  Receipt? receipt;

  Future<void> submit(Cart cart) async {
    if (!status.canSubmit) {
      return;
    }
    status = CheckoutStatus.submitting;
    notifyListeners();

    try {
      receipt = await repository.authorize(cart);
      status = CheckoutStatus.paid;
      message = receipt!.label;
    } catch (error) {
      status = CheckoutStatus.failed;
      message = 'Payment failed';
    } finally {
      notifyListeners();
    }
  }

  void reset() {
    status = CheckoutStatus.idle;
    message = '';
    receipt = null;
    notifyListeners();
  }
}
