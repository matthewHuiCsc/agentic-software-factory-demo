CREATE TABLE ledger_entries (
    id uuid PRIMARY KEY,
    store_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('income', 'expense')),
    amount_minor integer NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    memo text NOT NULL CHECK (length(trim(memo)) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_store_created ON ledger_entries (store_id, created_at DESC, id);

INSERT INTO ledger_entries (id, store_id, kind, amount_minor, currency, memo)
VALUES ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001',
        'expense', 2500, 'USD', 'Demo opening supplies (manual entry)');
