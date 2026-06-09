-- Reset Workout App — Supabase schema
-- Single shared user. Hard-coded USER_ID in db.js must match the UUID used here.

create extension if not exists "pgcrypto";

-- Singleton row holding the program state (week, in-progress sets, active swaps)
create table if not exists public.app_state (
  user_id     uuid primary key,
  week        int  not null default 1,
  progress    jsonb not null default '{}'::jsonb,
  swaps       jsonb not null default '{}'::jsonb,
  videos      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- One row per completed workout session
create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  day_id        text not null,
  day_name      text not null,
  completed_at  timestamptz not null default now(),
  done_sets     int  not null,
  total_sets    int  not null,
  exercises     jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now()
);
create index if not exists sessions_user_completed_idx on public.sessions (user_id, completed_at desc);

-- Per-exercise log of reps + weight (written whenever she edits the inputs)
create table if not exists public.exercise_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  session_id    uuid references public.sessions(id) on delete set null,
  exercise_id   text not null,
  reps          text,
  weight        numeric,
  logged_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists exercise_logs_user_ex_idx on public.exercise_logs (user_id, exercise_id, logged_at desc);

-- Weekly body-weight check-in
create table if not exists public.weights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  kg            numeric not null,
  recorded_on   date not null default current_date,
  updated_at    timestamptz not null default now(),
  unique (user_id, recorded_on)
);
create index if not exists weights_user_date_idx on public.weights (user_id, recorded_on desc);

-- Daily nutrition check-in
create table if not exists public.nutrition (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  recorded_on   date not null default current_date,
  rating        text not null check (rating in ('great','okay','struggled','skipped')),
  note          text,
  updated_at    timestamptz not null default now(),
  unique (user_id, recorded_on)
);
create index if not exists nutrition_user_date_idx on public.nutrition (user_id, recorded_on desc);

-- Row level security: allow anon read/write where user_id matches the configured UUID.
-- Replace 'YOUR-USER-UUID-HERE' with the same UUID used in db.js (USER_ID constant).
alter table public.app_state     enable row level security;
alter table public.sessions      enable row level security;
alter table public.exercise_logs enable row level security;
alter table public.weights       enable row level security;
alter table public.nutrition     enable row level security;

-- Replace this UUID, then run this file in the Supabase SQL editor.
do $$
declare
  fixed_uid uuid := 'a1f0c8d2-3b4e-4f5a-9c0d-1e2f3a4b5c6d';
begin
  -- app_state policy
  drop policy if exists app_state_rw on public.app_state;
  create policy app_state_rw on public.app_state
    for all using (user_id = fixed_uid) with check (user_id = fixed_uid);

  drop policy if exists sessions_rw on public.sessions;
  create policy sessions_rw on public.sessions
    for all using (user_id = fixed_uid) with check (user_id = fixed_uid);

  drop policy if exists exercise_logs_rw on public.exercise_logs;
  create policy exercise_logs_rw on public.exercise_logs
    for all using (user_id = fixed_uid) with check (user_id = fixed_uid);

  drop policy if exists weights_rw on public.weights;
  create policy weights_rw on public.weights
    for all using (user_id = fixed_uid) with check (user_id = fixed_uid);

  drop policy if exists nutrition_rw on public.nutrition;
  create policy nutrition_rw on public.nutrition
    for all using (user_id = fixed_uid) with check (user_id = fixed_uid);
end $$;

-- Seed the singleton state row (idempotent).
insert into public.app_state (user_id, week)
values ('a1f0c8d2-3b4e-4f5a-9c0d-1e2f3a4b5c6d', 1)
on conflict (user_id) do nothing;
