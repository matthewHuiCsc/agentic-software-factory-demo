CREATE TABLE stock (
    id uuid PRIMARY KEY,
    store_id uuid NOT NULL,
    name text NOT NULL CHECK (length(trim(name)) > 0),
    unit text NOT NULL CHECK (unit IN ('g', 'ml', 'pieces')),
    on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand BETWEEN 0 AND 1000000),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_store_name ON stock (store_id, lower(name));

CREATE TABLE stock_adjustments (
    id uuid PRIMARY KEY,
    stock_id uuid NOT NULL REFERENCES stock(id),
    delta integer NOT NULL CHECK (delta BETWEEN -1000000 AND 1000000 AND delta <> 0),
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_adjustments_history ON stock_adjustments (stock_id, created_at DESC, id);

INSERT INTO stock (id, store_id, name, unit, on_hand)
VALUES ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'Tapioca pearls', 'g', 10000);
