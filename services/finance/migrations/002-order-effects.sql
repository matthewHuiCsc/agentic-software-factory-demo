ALTER TABLE ledger_entries ADD COLUMN operation_id uuid;
CREATE UNIQUE INDEX ledger_operation_id ON ledger_entries (operation_id) WHERE operation_id IS NOT NULL;

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
CREATE INDEX finance_effects_order ON event_effects (order_id, created_at, event_id);
CREATE INDEX finance_effects_pending ON event_effects (created_at, event_id) WHERE status = 'pending';
