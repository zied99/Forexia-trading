-- Forexia : base de données en ligne (Supabase).
-- À exécuter une seule fois : Supabase → SQL Editor → New query → coller ce fichier → Run.
-- Chaque compte ne peut lire et modifier que ses propres lignes (Row Level Security).
-- Le script peut être relancé sans risque (aucune donnée n'est effacée).

create table if not exists public.strategies (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name       text        not null check (char_length(name) between 1 and 120),
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

create table if not exists public.simulations (
  user_id uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key     text        not null check (char_length(key) between 1 and 300),
  at      timestamptz not null,
  name    text,
  pair    text,
  data    jsonb       not null,
  primary key (user_id, key)
);
create index if not exists simulations_user_at on public.simulations (user_id, at);

create table if not exists public.events (
  id      bigint generated always as identity primary key,
  user_id uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  at      timestamptz not null default now(),
  type    text        not null check (char_length(type) between 1 and 60),
  summary text,
  data    jsonb
);
create index if not exists events_user_id on public.events (user_id, id desc);

create table if not exists public.settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Sécurité : accès réservé au propriétaire de chaque ligne.
alter table public.strategies  enable row level security;
alter table public.simulations enable row level security;
alter table public.events      enable row level security;
alter table public.settings    enable row level security;

drop policy if exists "Forexia : mes stratégies"  on public.strategies;
drop policy if exists "Forexia : mes simulations" on public.simulations;
drop policy if exists "Forexia : mon journal"     on public.events;
drop policy if exists "Forexia : mes réglages"    on public.settings;

create policy "Forexia : mes stratégies"  on public.strategies  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Forexia : mes simulations" on public.simulations for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Forexia : mon journal"     on public.events      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Forexia : mes réglages"    on public.settings    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Aucun accès sans être connecté.
revoke all on public.strategies, public.simulations, public.events, public.settings from anon;
grant select, insert, update, delete on public.strategies, public.simulations, public.events, public.settings to authenticated;

-- Demande à l'API de Supabase de prendre en compte les nouvelles tables tout de suite.
notify pgrst, 'reload schema';
