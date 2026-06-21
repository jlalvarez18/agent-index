class Cart {
  const Cart(this.totalCents);

  factory Cart.empty() => const Cart(0);

  final int totalCents;
}
