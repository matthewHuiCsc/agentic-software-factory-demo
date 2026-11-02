ALTER TABLE order_menu ADD COLUMN available boolean NOT NULL DEFAULT true;
ALTER TABLE order_menu ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX order_menu_name_unique ON order_menu (lower(trim(name)));
