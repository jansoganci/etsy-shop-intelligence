-- Migration number: 0019
-- Normalize CSV natural keys so reconciliation can join on indexed PKs
-- without TRIM() (which defeats index use and caused multi-billion D1 reads).
-- Import path already trims text keys; this backfills any legacy padded rows.
-- Collision-safe: skip groups where TRIM(id) maps to more than one distinct raw id.

-- Orders
UPDATE orders
SET order_id = TRIM(order_id)
WHERE order_id <> TRIM(order_id)
  AND TRIM(order_id) NOT IN (
    SELECT TRIM(order_id) FROM orders
    GROUP BY TRIM(order_id)
    HAVING COUNT(DISTINCT order_id) > 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM orders other
    WHERE other.order_id = TRIM(orders.order_id)
  );

-- Order items (PK + parent)
UPDATE order_items
SET transaction_id = TRIM(transaction_id)
WHERE transaction_id <> TRIM(transaction_id)
  AND TRIM(transaction_id) NOT IN (
    SELECT TRIM(transaction_id) FROM order_items
    GROUP BY TRIM(transaction_id)
    HAVING COUNT(DISTINCT transaction_id) > 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM order_items other
    WHERE other.transaction_id = TRIM(order_items.transaction_id)
  );

UPDATE order_items
SET order_id = TRIM(order_id)
WHERE order_id IS NOT NULL
  AND order_id <> TRIM(order_id);

-- Payments (PK + parent)
UPDATE payments
SET payment_id = TRIM(payment_id)
WHERE payment_id <> TRIM(payment_id)
  AND TRIM(payment_id) NOT IN (
    SELECT TRIM(payment_id) FROM payments
    GROUP BY TRIM(payment_id)
    HAVING COUNT(DISTINCT payment_id) > 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM payments other
    WHERE other.payment_id = TRIM(payments.payment_id)
  );

UPDATE payments
SET order_id = TRIM(order_id)
WHERE order_id IS NOT NULL
  AND order_id <> TRIM(order_id);
