
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  source VARCHAR(50) NOT NULL,
  conversation_id TEXT,
  product_id TEXT,
  title TEXT,
  merchant_default TEXT,
  price_text TEXT,
  price_numeric NUMERIC,
  currency TEXT,
  delivery_by TEXT,
  free_delivery BOOLEAN,
  min_spend_for_free_delivery NUMERIC,
  avg_rating NUMERIC,
  num_ratings INTEGER,
  geotags JSONB,
  product_object JSONB NOT NULL,
  raw_chatgpt_text TEXT NOT NULL,
  extras JSONB
);
CREATE INDEX IF NOT EXISTS idx_products_product_id ON products(product_id);
CREATE INDEX IF NOT EXISTS idx_products_captured_at ON products(captured_at);


