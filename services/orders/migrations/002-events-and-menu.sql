CREATE TABLE order_menu (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(trim(name)) > 0),
    description text NOT NULL CHECK (length(trim(description)) > 0),
    unit_price_minor integer NOT NULL CHECK (unit_price_minor >= 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$')
);

INSERT INTO order_menu (id, name, description, unit_price_minor, currency)
VALUES
    ('00000000-0000-4000-8000-000000000011', 'Classic milk tea', 'Classic milk tea with tapioca pearls.', 550, 'USD'),
    ('00000000-0000-4000-8000-000000000012', 'Brown sugar milk tea', 'Milk tea with brown sugar and tapioca pearls.', 650, 'USD')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE order_outbox (
    event_id uuid PRIMARY KEY,
    operation_id uuid NOT NULL UNIQUE,
    order_id uuid NOT NULL REFERENCES orders(id),
    event_type text NOT NULL CHECK (event_type IN ('OrderPlaced', 'OrderCompleted', 'OrderRejected', 'OrderCancelled')),
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);
CREATE INDEX order_outbox_pending ON order_outbox (created_at, event_id) WHERE status = 'pending';
CREATE INDEX order_outbox_order ON order_outbox (order_id, created_at, event_id);
