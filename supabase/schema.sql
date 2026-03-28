-- SmartDocs / crm-mock
-- Base schema for Supabase.
-- Run this in the Supabase SQL editor or as a migration.

create extension if not exists "pgcrypto";

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company text,
  timezone text not null default 'UTC',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- My documents / personal files
create table if not exists public.my_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  size bigint not null default 0,
  type text not null default '',
  category text not null check (category in ('personal', 'company')),
  url text not null,
  uploadthing_key text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Shared documents / signing / review workflow
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  subject text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'waiting', 'reviewing', 'reviewed', 'approved', 'signed', 'completed', 'rejected')),
  category text,
  file_url text,
  file_key text,
  content text,
  sender jsonb not null default '{}'::jsonb,
  recipients jsonb not null default '[]'::jsonb,
  source text not null default 'uploadthing',
  sent_at timestamptz,
  reviewed_at timestamptz,
  signed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Event / audit trail
create table if not exists public.document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Templates
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'Legal',
  color text,
  preview jsonb not null default '{}'::jsonb,
  content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My signature',
  data_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Generic updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_my_documents_updated_at on public.my_documents;
create trigger set_my_documents_updated_at
before update on public.my_documents
for each row execute function public.set_updated_at();

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists set_templates_updated_at on public.templates;
create trigger set_templates_updated_at
before update on public.templates
for each row execute function public.set_updated_at();

drop trigger if exists set_signatures_updated_at on public.signatures;
create trigger set_signatures_updated_at
before update on public.signatures
for each row execute function public.set_updated_at();

-- Create a profile row automatically for new auth users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, company)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'company', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.my_documents enable row level security;
alter table public.documents enable row level security;
alter table public.document_events enable row level security;
alter table public.templates enable row level security;
alter table public.signatures enable row level security;

-- Profiles policies
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- My documents policies
drop policy if exists "my_documents_crud_own" on public.my_documents;
create policy "my_documents_crud_own"
on public.my_documents for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- Documents policies
drop policy if exists "documents_crud_own" on public.documents;
create policy "documents_crud_own"
on public.documents for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- Events policies
drop policy if exists "document_events_crud_own" on public.document_events;
create policy "document_events_crud_own"
on public.document_events for all
using (
  exists (
    select 1
    from public.documents d
    where d.id = document_events.document_id
      and d.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.documents d
    where d.id = document_events.document_id
      and d.owner_id = auth.uid()
  )
);

-- Templates policies
drop policy if exists "templates_crud_own" on public.templates;
create policy "templates_crud_own"
on public.templates for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "signatures_crud_own" on public.signatures;
create policy "signatures_crud_own"
on public.signatures for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);
