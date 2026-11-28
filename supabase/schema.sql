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

-- Plans d'investissement publiés pour la page client (« ⭐ Mettre en avant » dans Forexia).
-- Lecture : tout compte connecté (les clients) voit les plans publiés ; écriture : seulement le compte qui les a publiés.
create table if not exists public.plans (
  id         text primary key check (char_length(id) between 1 and 120),
  owner      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null,
  published  boolean     not null default true,
  updated_at timestamptz not null default now()
);
alter table public.plans enable row level security;
drop policy if exists "Forexia : plans publiés (lecture)" on public.plans;
drop policy if exists "Forexia : mes plans (écriture)"     on public.plans;
create policy "Forexia : plans publiés (lecture)" on public.plans for select to authenticated using (published or owner = auth.uid());
create policy "Forexia : mes plans (écriture)"     on public.plans for all    to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
revoke all on public.plans from anon;
grant select, insert, update, delete on public.plans to authenticated;

-- ============================================================================
-- Trading réel (étape 1 : observation). Le PC Windows fait tourner l'agent Forexia (bridge/forexia_agent.py),
-- qui lit MT5 et dépose ici l'état du compte et chaque opération. L'agent a son propre compte Supabase :
-- il ne voit que sa machine, et la machine n'apparaît chez vous qu'après saisie de son code d'appairage
-- dans la page admin (admin.html).
-- ============================================================================
create table if not exists public.machines (
  id         text primary key check (char_length(id) between 6 and 40),
  agent      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  owner      uuid        references auth.users (id) on delete cascade,
  pair_code  text,
  pair_until timestamptz,
  name       text        check (char_length(name) <= 80),
  info       jsonb       not null default '{}'::jsonb,   -- compte MT5 : solde, marge, mode hedging…
  positions  jsonb       not null default '[]'::jsonb,   -- positions ouvertes
  seen_at    timestamptz,
  created_at timestamptz not null default now()
);

-- opérations MT5 (une ligne par transaction ; le ticket MT5 garantit qu'aucune n'est comptée deux fois)
create table if not exists public.trade_ops (
  machine_id  text        not null references public.machines (id) on delete cascade,
  ticket      bigint      not null,
  at          timestamptz not null,
  magic       bigint      not null default 0,
  symbol      text,
  kind        text,        -- achat, vente, solde, crédit, frais…
  entry       text,        -- in, out, inout, out_by
  volume      double precision,
  price       double precision,
  profit      double precision not null default 0,
  swap        double precision not null default 0,
  commission  double precision not null default 0,
  fee         double precision not null default 0,
  position_id bigint,
  order_id    bigint,
  comment     text,
  primary key (machine_id, ticket)
);
create index if not exists trade_ops_magic on public.trade_ops (machine_id, magic, at);
create index if not exists trade_ops_at on public.trade_ops (machine_id, at desc);

-- photos régulières du compte (courbe de valeur, future barre de progression)
create table if not exists public.trade_snaps (
  machine_id text        not null references public.machines (id) on delete cascade,
  at         timestamptz not null,
  data       jsonb       not null,
  primary key (machine_id, at)
);

-- plans en cours sur une machine (étape 1 : rattachement manuel d'un numéro magique à un plan)
create table if not exists public.activations (
  id         text primary key default gen_random_uuid()::text,
  owner      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  machine_id text        not null references public.machines (id) on delete cascade,
  magic      bigint      not null,
  plan_id    text,
  label      text        check (char_length(label) <= 120),
  capital    double precision,
  status     text        not null default 'manuel',
  started_at timestamptz not null default now(),
  data       jsonb       not null default '{}'::jsonb,
  unique (machine_id, magic)
);

create or replace function public.machine_role(mid text) returns text
language sql stable security definer set search_path = public as $$
  select case when m.owner = auth.uid() then 'owner' when m.agent = auth.uid() then 'agent' end
  from public.machines m where m.id = mid
$$;

-- La page admin rattache une machine à votre compte avec le code affiché par l'agent (valable 24 h, renouvelé par l'agent).
create or replace function public.claim_machine(code text) returns text
language plpgsql security definer set search_path = public as $$
declare mid text;
begin
  if auth.uid() is null then raise exception 'Non connecté.'; end if;
  update public.machines set owner = auth.uid(), pair_code = null, pair_until = null
   where pair_code = upper(trim(code)) and owner is null and pair_until > now()
   returning id into mid;
  if mid is null then raise exception 'Code inconnu ou expiré : relancez l''agent pour en obtenir un nouveau.'; end if;
  return mid;
end $$;

alter table public.machines    enable row level security;
alter table public.trade_ops   enable row level security;
alter table public.trade_snaps enable row level security;
alter table public.activations enable row level security;

drop policy if exists "Forexia : machines (lecture)"      on public.machines;
drop policy if exists "Forexia : machines (agent crée)"   on public.machines;
drop policy if exists "Forexia : machines (mise à jour)"  on public.machines;
drop policy if exists "Forexia : machines (suppression)"  on public.machines;
create policy "Forexia : machines (lecture)"     on public.machines for select to authenticated using (owner = auth.uid() or agent = auth.uid());
create policy "Forexia : machines (agent crée)"  on public.machines for insert to authenticated with check (agent = auth.uid() and owner is null);
create policy "Forexia : machines (mise à jour)" on public.machines for update to authenticated using (owner = auth.uid() or agent = auth.uid()) with check (owner = auth.uid() or agent = auth.uid());
create policy "Forexia : machines (suppression)" on public.machines for delete to authenticated using (owner = auth.uid());

drop policy if exists "Forexia : opérations (lecture)"   on public.trade_ops;
drop policy if exists "Forexia : opérations (agent)"     on public.trade_ops;
drop policy if exists "Forexia : opérations (agent maj)" on public.trade_ops;
drop policy if exists "Forexia : opérations (suppression)" on public.trade_ops;
create policy "Forexia : opérations (lecture)"     on public.trade_ops for select to authenticated using (public.machine_role(machine_id) is not null);
create policy "Forexia : opérations (agent)"       on public.trade_ops for insert to authenticated with check (public.machine_role(machine_id) = 'agent');
create policy "Forexia : opérations (agent maj)"   on public.trade_ops for update to authenticated using (public.machine_role(machine_id) = 'agent') with check (public.machine_role(machine_id) = 'agent');
create policy "Forexia : opérations (suppression)" on public.trade_ops for delete to authenticated using (public.machine_role(machine_id) = 'owner');

drop policy if exists "Forexia : photos (lecture)"   on public.trade_snaps;
drop policy if exists "Forexia : photos (agent)"     on public.trade_snaps;
drop policy if exists "Forexia : photos (agent maj)" on public.trade_snaps;
drop policy if exists "Forexia : photos (suppression)" on public.trade_snaps;
create policy "Forexia : photos (lecture)"     on public.trade_snaps for select to authenticated using (public.machine_role(machine_id) is not null);
create policy "Forexia : photos (agent)"       on public.trade_snaps for insert to authenticated with check (public.machine_role(machine_id) = 'agent');
create policy "Forexia : photos (agent maj)"   on public.trade_snaps for update to authenticated using (public.machine_role(machine_id) = 'agent') with check (public.machine_role(machine_id) = 'agent');
create policy "Forexia : photos (suppression)" on public.trade_snaps for delete to authenticated using (public.machine_role(machine_id) = 'owner');

drop policy if exists "Forexia : activations (propriétaire)" on public.activations;
drop policy if exists "Forexia : activations (agent lit)"    on public.activations;
create policy "Forexia : activations (propriétaire)" on public.activations for all to authenticated
  using (owner = auth.uid() and public.machine_role(machine_id) = 'owner') with check (owner = auth.uid() and public.machine_role(machine_id) = 'owner');
create policy "Forexia : activations (agent lit)" on public.activations for select to authenticated using (public.machine_role(machine_id) = 'agent');

revoke all on public.machines, public.trade_ops, public.trade_snaps, public.activations from anon;
revoke all on public.machines from authenticated;
grant select, insert, delete on public.machines to authenticated;
-- personne ne change « agent » ni « owner » directement (le rattachement passe par claim_machine)
grant update (name, info, positions, seen_at, pair_code, pair_until) on public.machines to authenticated;
grant select, insert, update, delete on public.trade_ops, public.trade_snaps, public.activations to authenticated;
revoke all on function public.claim_machine(text) from public, anon;
grant execute on function public.claim_machine(text) to authenticated;
grant execute on function public.machine_role(text) to authenticated;

notify pgrst, 'reload schema';
