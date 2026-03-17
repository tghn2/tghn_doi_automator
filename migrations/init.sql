-- migrations/init.sql

-- counters table for atomic counters
create table if not exists counters (
  id text primary key,
  value bigint not null default 0
);

-- set starting counters
insert into counters (id, value) values ('highest_suffix', 180)
  on conflict (id) do update set value = excluded.value;

insert into counters (id, value) values ('batch_counter', 0)
  on conflict (id) do nothing;

-- books table (hubs)
create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  doi text,
  url text,
  publisher_name text,
  publication_year int,
  metadata jsonb,
  created_at timestamptz default now()
);

-- chapters table (resources within a hub)
create table if not exists chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books(id) on delete cascade,
  title text not null,
  doi text,
  resource_url text,
  metadata jsonb,
  created_at timestamptz default now()
);

-- submissions table (audit trail)
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books(id),
  batch_id text,
  timestamp text,
  registrant text,
  doi_prefix text,
  doi_suffix_base text,
  xml text,
  status text,
  crossref_response jsonb,
  created_by uuid, -- Supabase auth user id
  created_at timestamptz default now()
);

-- admins table to map supabase auth user IDs to admin role
create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid not null unique,
  email text not null,
  created_at timestamptz default now()
);

-- allocate_suffixes RPC: atomically allocate n suffixes and return start/last
create or replace function allocate_suffixes(n integer) returns table(start bigint, last bigint) as $$
declare
  curr bigint;
begin
  if n is null or n < 1 then
    raise exception 'n must be integer >= 1';
  end if;
  -- lock counters table to avoid races
  lock table counters in exclusive mode;
  select value into curr from counters where id='highest_suffix' for update;
  if curr is null then curr := 100; end if;
  update counters set value = curr + n where id='highest_suffix';
  return query select curr+1 as start, curr + n as last;
end;
$$ language plpgsql;