CREATE TABLE orders (
    id uuid PRIMARY KEY,
    store_id uuid NOT NULL,
    customer_id uuid,
    status text NOT NULL CHECK (status IN ('confirmed', 'preparing', 'completed', 'rejected', 'cancelled')),
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
    total_minor integer NOT NULL CHECK (total_minor >= 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status IN ('rejected', 'cancelled') AND reason IS NOT NULL AND length(trim(reason)) > 0)
        OR (status NOT IN ('rejected', 'cancelled') AND reason IS NULL))
);
CREATE INDEX orders_store_created ON orders (store_id, created_at DESC, id);

INSERT INTO orders (id, store_id, status, items, total_minor, currency)
VALUES (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'confirmed',
    '[{"productId":"00000000-0000-4000-8000-000000000011","name":"Classic milk tea","quantity":1,"unitPriceMinor":550}]',
    550,
    'USD'
);
