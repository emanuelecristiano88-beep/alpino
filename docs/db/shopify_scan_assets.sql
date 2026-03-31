-- NEUMA — schema minimo per associare ordini Shopify ad asset 3D (Supabase/Postgres)
-- Uso tipico:
-- - quando crei un ordine su Shopify: salva shopify_order_id
-- - quando completi processing scan: salva scan_id e la "cartella" asset (Drive folder / Blob prefix / S3 key prefix)

create extension if not exists "pgcrypto";

create table if not exists public.neuma_scan_assets (
  id uuid primary key default gen_random_uuid(),

  -- Identificatore scansione (generato dal client, usato anche per upload chunk video/foto)
  scan_id uuid not null,

  -- Ordine Shopify (string per compatibilità: es. "gid://shopify/Order/123..." o "1234567890")
  shopify_order_id text not null,

  -- Dove vivono gli asset 3D (scegli uno o più campi a seconda dello storage)
  drive_folder_id text null,
  storage_prefix text null, -- es. "scans/<scan_id>/" su S3/Blob

  -- Identità utente (opzionale: Supabase auth.user id)
  user_id uuid null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists neuma_scan_assets_shopify_order_id_uq
  on public.neuma_scan_assets (shopify_order_id);

create index if not exists neuma_scan_assets_scan_id_idx
  on public.neuma_scan_assets (scan_id);

create index if not exists neuma_scan_assets_user_id_idx
  on public.neuma_scan_assets (user_id);

create or replace function public.neuma_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists neuma_scan_assets_touch_updated_at on public.neuma_scan_assets;
create trigger neuma_scan_assets_touch_updated_at
before update on public.neuma_scan_assets
for each row execute function public.neuma_touch_updated_at();

