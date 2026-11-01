CREATE TABLE customer_order_totals (
    customer_id uuid NOT NULL REFERENCES customers(id),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    completed_order_count integer NOT NULL DEFAULT 0 CHECK (completed_order_count >= 0),
    total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
    PRIMARY KEY (customer_id, currency)
);

CREATE TABLE event_effects (
    event_id uuid PRIMARY KEY,
    operation_id uuid NOT NULL UNIQUE,
    order_id uuid NOT NULL,
    event_type text NOT NULL,
    event_payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed', 'skipped')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz
);
CREATE INDEX customers_effects_order ON event_effects (order_id, created_at, event_id);
CREATE INDEX customers_effects_pending ON event_effects (created_at, event_id) WHERE status = 'pending';
