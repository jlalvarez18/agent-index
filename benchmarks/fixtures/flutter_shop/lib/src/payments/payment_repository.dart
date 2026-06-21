import '../models/cart.dart';
import '../models/receipt.dart';

typedef ReceiptMapper = Receipt Function(Map<String, Object?> json);

class PaymentRepository {
  PaymentRepository(this.mapReceipt);

  final ReceiptMapper mapReceipt;

  Future<Receipt> authorize(Cart cart) async {
    final payload = await postPayment(cart.totalCents);
    return mapReceipt(payload);
  }

  Future<Map<String, Object?>> postPayment(int totalCents) async {
    return {
      'id': 'receipt_123',
      'label': 'Paid $totalCents cents',
    };
  }
}
