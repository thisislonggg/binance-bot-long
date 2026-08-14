-- Jalankan di Supabase SQL editor (Project -> SQL Editor -> New query)

-- ── Riwayat harga P2P (untuk grafik fair_price) ─────────────────────────────
create table if not exists public.price_history (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  fair_price numeric not null
);

create index if not exists price_history_ts_idx on public.price_history (ts desc);

alter table public.price_history enable row level security;
-- (tidak ada policy dibuat -> hanya service role yang bisa akses)

-- ── Transaksi merchant (input manual + auto-sync dari Binance) ───────────────
create table if not exists public.trades (
  id               bigint generated always as identity primary key,
  ts               timestamptz not null default now(),
  side             text not null check (side in ('buy', 'sell')),
  price            numeric not null,
  amount_usdt      numeric not null,
  note             text,
  -- 'manual'        = dicatat sendiri oleh user
  -- 'binance_sync'  = ditarik otomatis dari Binance C2C API
  source           text not null default 'manual' check (source in ('manual', 'binance_sync')),
  -- Nomor order Binance — unik, dipakai sebagai kunci deduplikasi saat sync.
  -- NULL untuk entri manual.
  binance_order_no text unique
);

create index if not exists trades_ts_idx on public.trades (ts desc);

alter table public.trades enable row level security;
-- (tidak ada policy dibuat -> hanya service role yang bisa akses)

-- ── Pengaturan user (termasuk timestamp sync Binance terakhir) ───────────────
create table if not exists public.user_settings (
  key   text primary key,
  value text not null
);

alter table public.user_settings enable row level security;

-- ── Opsi Sinkronisasi 24/7 Otomatis (Background Serverless) ─────────────────
-- Jika ingin auto-sync berjalan 24 jam nonstop tanpa perlu browser terbuka:
-- 1. Deploy edge function:
--    supabase functions deploy sync-binance-trades --no-verify-jwt
-- 2. Pastikan env var BINANCE_API_KEY & BINANCE_API_SECRET diisi di Supabase Secrets:
--    supabase secrets set BINANCE_API_KEY=xxx BINANCE_API_SECRET=yyy
-- 3. Jadwalkan di pg_cron (setiap 3 menit):
--    select cron.schedule(
--      'sync-binance-c2c-trades',
--      '*/3 * * * *',
--      $$
--      select net.http_post(
--        url := 'https://<project-ref>.supabase.co/functions/v1/sync-binance-trades',
--        headers := jsonb_build_object('Content-Type', 'application/json')
--      ) as request_id;
--      $$
--    );

