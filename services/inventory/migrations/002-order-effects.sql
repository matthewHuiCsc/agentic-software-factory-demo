CREATE TABLE product_recipes (
    product_id uuid NOT NULL,
    stock_id uuid NOT NULL REFERENCES stock(id),
    quantity_per_unit integer NOT NULL CHECK (quantity_per_unit > 0),
    PRIMARY KEY (product_id, stock_id)
);

INSERT INTO product_recipes (product_id, stock_id, quantity_per_unit)
VALUES
    ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000201', 50),
    ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000201', 50)
ON CONFLICT DO NOTHING;

ALTER TABLE stock_adjustments ADD COLUMN operation_id uuid;
CREATE UNIQUE INDEX stock_adjustment_operation
    ON stock_adjustments (operation_id, stock_id) WHERE operation_id IS NOT NULL;

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
CREATE INDEX inventory_effects_order ON event_effects (order_id, created_at, event_id);
CREATE INDEX inventory_effects_pending ON event_effects (created_at, event_id) WHERE status = 'pending';
