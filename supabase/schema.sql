-- Jalankan di Supabase SQL editor (Project -> SQL Editor -> New query)

create table if not exists public.price_history (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  fair_price numeric not null
);

create index if not exists price_history_ts_idx on public.price_history (ts desc);

-- Server pakai service role key (bypass RLS), jadi RLS boleh tetap aktif dan
-- ditutup rapat dari akses publik/anon:
alter table public.price_history enable row level security;
-- (tidak ada policy dibuat -> hanya service role yang bisa akses)
