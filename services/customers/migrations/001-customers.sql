CREATE TABLE customers (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(trim(name)) > 0),
    email text NOT NULL CHECK (email = lower(email)),
    phone text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (email)
);
CREATE INDEX customers_created ON customers (created_at DESC, id);

INSERT INTO customers (id, name, email)
VALUES ('00000000-0000-4000-8000-000000000401', 'Demo Customer', 'demo@example.test');
