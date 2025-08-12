-- Database initialization for both development and production environments
-- This script creates tables in both schemas for compatibility

-- Create internal schema for production
CREATE SCHEMA IF NOT EXISTS internal;

-- Create products table in public schema (development)
CREATE TABLE IF NOT EXISTS public.chatgpt_products (
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

-- Create products table in internal schema (production)
CREATE TABLE IF NOT EXISTS internal.products (
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

-- Create indexes for public schema (development)
CREATE INDEX IF NOT EXISTS idx_chatgpt_products_product_id ON public.chatgpt_products(product_id);
CREATE INDEX IF NOT EXISTS idx_chatgpt_products_captured_at ON public.chatgpt_products(captured_at);

-- Add content_hash to enable idempotent inserts
ALTER TABLE public.chatgpt_products
  ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_chatgpt_products_conv_hash
  ON public.chatgpt_products (conversation_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- Create indexes for internal schema (production)
CREATE INDEX IF NOT EXISTS idx_internal_products_product_id ON internal.products(product_id);
CREATE INDEX IF NOT EXISTS idx_internal_products_captured_at ON internal.products(captured_at);
CREATE INDEX IF NOT EXISTS idx_internal_products_source ON internal.products(source);
CREATE INDEX IF NOT EXISTS idx_internal_products_conversation_id ON internal.products(conversation_id);

-- Add content_hash to enable idempotent inserts (production schema)
ALTER TABLE internal.products
  ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_internal_products_conv_hash
  ON internal.products (conversation_id, content_hash)
  WHERE content_hash IS NOT NULL;


