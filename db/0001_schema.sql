create extension if not exists pgcrypto;

-- Everything for this app lives here. The project's public schema belongs to an
-- unrelated application and must not be touched.
create schema if not exists ehs;
grant usage on schema ehs to authenticated, anon;

-- Identity. One row per device that has redeemed a code.
create table ehs.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) between 1 and 60),
  role          text not null check (role in ('admin','inspector','viewer')),
  created_at    timestamptz not null default now()
);

-- Hashed access codes, one per role. Never readable by any client.
create table ehs.access_codes (
  role        text primary key check (role in ('admin','inspector','viewer')),
  code_hash   text not null,
  updated_at  timestamptz not null default now()
);

-- Rate limiting for code redemption, keyed by anonymous auth uid.
create table ehs.code_attempts (
  uid          uuid primary key,
  attempts     int not null default 0,
  first_at     timestamptz not null default now()
);

-- Catalog. Mirrors the Machine type in src/types.ts.
create table ehs.machines (
  lot             int primary key,
  year            int,
  make            text not null,
  model           text not null,
  title           text not null,
  category        text not null,
  power           text not null,
  hours           int,
  serial          text,
  location        text not null,
  image_url       text,
  source_url      text not null,
  features        text[] not null default '{}',
  notes           text,
  priority        text not null check (priority in ('P1','P2','P3')),
  fleet_fit       int not null,
  parts_support   int not null,
  rental_demand   int not null,
  source_verified boolean not null default false
);

-- Per-lot state, three independently versioned field groups.
create table ehs.machine_states (
  lot                     int primary key references ehs.machines(lot) on delete cascade,
  inspection              jsonb not null default '{}'::jsonb,
  inspection_updated_at   timestamptz not null default 'epoch',
  commercial              jsonb not null default '{}'::jsonb,
  commercial_updated_at   timestamptz not null default 'epoch',
  decision                text not null default 'UNASSESSED',
  shortlist               boolean not null default false,
  decision_updated_at     timestamptz not null default 'epoch'
);

create table ehs.photos (
  id            uuid primary key default gen_random_uuid(),
  lot           int not null references ehs.machines(lot) on delete cascade,
  storage_path  text not null unique,
  caption       text,
  taken_by      uuid references ehs.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index photos_lot_idx on ehs.photos (lot, created_at desc);

create table ehs.comments (
  id           uuid primary key default gen_random_uuid(),
  lot          int not null references ehs.machines(lot) on delete cascade,
  author_id    uuid references ehs.profiles(id) on delete set null,
  author_name  text not null,
  body         text not null check (length(trim(body)) between 1 and 4000),
  created_at   timestamptz not null default now(),
  edited_at    timestamptz
);
create index comments_lot_idx on ehs.comments (lot, created_at);

create table ehs.comment_reads (
  profile_id    uuid not null references ehs.profiles(id) on delete cascade,
  lot           int not null references ehs.machines(lot) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (profile_id, lot)
);

-- PostgREST needs table privileges as well as RLS policies; RLS then narrows
-- what these grants allow.
grant select, insert, update, delete on all tables in schema ehs to authenticated;

-- Deny-by-default. Policies arrive in 0003.
alter table ehs.profiles       enable row level security;
alter table ehs.access_codes   enable row level security;
alter table ehs.code_attempts  enable row level security;
alter table ehs.machines       enable row level security;
alter table ehs.machine_states enable row level security;
alter table ehs.photos         enable row level security;
alter table ehs.comments       enable row level security;
alter table ehs.comment_reads  enable row level security;
