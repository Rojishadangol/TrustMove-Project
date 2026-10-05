-- Trust Move: run this whole file once in Supabase Dashboard > SQL Editor.
-- Before using admin.html, create an email/password user in Authentication > Users,
-- then run the final INSERT below with that user's email address.

create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  -- Keep this UUID type in sync with tracking_events.shipment_id below.
  id uuid primary key default gen_random_uuid(),
  tracking_number text not null unique,
  shipment_type text not null,
  sender_name text not null,
  recipient_name text not null,
  pickup_location text,
  origin text not null,
  destination text not null,
  shipment_date date not null,
  estimated_delivery date,
  status text not null default 'Processing',
  weight text not null,
  notes text,
  sender_email text,
  created_at timestamptz not null default now()
);

-- Existing Trust Move projects use UUID shipment IDs. Add dashboard fields to
-- that existing table without replacing its IDs or shipment data.
alter table public.shipments
  add column if not exists tracking_number text,
  add column if not exists shipment_type text,
  add column if not exists sender_name text,
  add column if not exists recipient_name text,
  add column if not exists pickup_location text,
  add column if not exists origin text,
  add column if not exists destination text,
  add column if not exists shipment_date date,
  add column if not exists estimated_delivery date,
  add column if not exists status text default 'Processing',
  add column if not exists weight text,
  add column if not exists notes text,
  add column if not exists sender_email text,
  add column if not exists created_at timestamptz default now();

create table if not exists public.tracking_events (
  id bigint generated always as identity primary key,
  -- The existing shipments table in this Supabase project uses UUID primary keys.
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  status text not null,
  location text,
  description text,
  event_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.quote_requests (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  phone text not null,
  pickup_location text not null,
  destination_country text not null,
  destination_city text not null,
  destination text,
  shipment_type text not null,
  weight numeric,
  package_count integer not null default 1 check (package_count > 0),
  pickup_date date,
  message text,
  status text not null default 'new',
  lookup_code uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Older quote forms used full_name. Keep old rows readable while exposing the
-- `name` column used by the current public form. Existing full_name NOT NULL
-- constraints must be relaxed so new inserts that send `name` can succeed.
alter table public.quote_requests
  add column if not exists name text,
  add column if not exists full_name text,
  add column if not exists destination text,
  add column if not exists status text default 'new';
alter table public.quote_requests
  add column if not exists lookup_code uuid not null default gen_random_uuid();

update public.quote_requests
set name = coalesce(name, full_name),
    full_name = coalesce(full_name, name)
where name is null or full_name is null;

alter table public.quote_requests
  alter column full_name drop not null;

create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  phone text not null,
  subject text not null,
  message text not null,
  status text not null default 'new',
  lookup_code uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Legacy contact tables may not have stored a subject line. The current public
-- form sends it and the admin dashboard displays it.
alter table public.contact_messages
  add column if not exists subject text,
  add column if not exists status text default 'new',
  add column if not exists lookup_code uuid not null default gen_random_uuid();

create unique index if not exists quote_requests_lookup_code_idx
  on public.quote_requests (lookup_code);
create unique index if not exists contact_messages_lookup_code_idx
  on public.contact_messages (lookup_code);

-- Customers can retrieve only the handling status for a request when they
-- provide its unguessable private reference code. No contact or message data
-- is returned by this public RPC.
create or replace function public.lookup_customer_request(p_lookup_code uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_id bigint;
  request_status text;
  request_kind text;
  request_created_at timestamptz;
begin
  select id, status, 'quote'::text, created_at into request_id, request_status, request_kind, request_created_at
  from public.quote_requests where lookup_code = p_lookup_code;
  if not found then
    select id, status, 'message'::text, created_at into request_id, request_status, request_kind, request_created_at
    from public.contact_messages where lookup_code = p_lookup_code;
  end if;
  if request_kind is null then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object('found', true, 'id', request_id, 'kind', request_kind,
    'status', request_status, 'created_at', request_created_at);
end;
$$;
revoke all on function public.lookup_customer_request(uuid) from public;
grant execute on function public.lookup_customer_request(uuid) to anon, authenticated;

create index if not exists tracking_events_shipment_date_idx
  on public.tracking_events (shipment_id, event_date desc);

-- Helper used by all admin-only policies. Normal website visitors never qualify.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where id = auth.uid()
  );
$$;

-- Public tracking exposes only delivery information, never sender/recipient/contact data.
create or replace function public.track_shipment(p_tracking_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  shipment_record public.shipments%rowtype;
begin
  select * into shipment_record
  from public.shipments
  where upper(tracking_number) = upper(trim(p_tracking_number));

  if not found then
    return jsonb_build_object('success', false);
  end if;

  return jsonb_build_object(
    'success', true,
    'shipment', jsonb_build_object(
      'tracking_number', shipment_record.tracking_number,
      'origin', shipment_record.origin,
      'destination', shipment_record.destination,
      'shipment_type', shipment_record.shipment_type,
      'shipment_date', shipment_record.shipment_date,
      'estimated_delivery', shipment_record.estimated_delivery,
      'current_status', shipment_record.status
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', e.status,
        'location', e.location,
        'description', e.description,
        'event_date', e.event_date
      ) order by e.event_date desc)
      from public.tracking_events e
      where e.shipment_id = shipment_record.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on public.shipments, public.tracking_events, public.quote_requests,
  public.contact_messages, public.admin_users from anon, authenticated;
grant execute on function public.track_shipment(text) to anon, authenticated;
grant select on public.admin_users to authenticated;
grant select, insert, update, delete on public.shipments, public.tracking_events,
  public.quote_requests, public.contact_messages to authenticated;
grant insert on public.quote_requests, public.contact_messages to anon;
grant usage, select on all sequences in schema public to anon, authenticated;

alter table public.admin_users enable row level security;
alter table public.shipments enable row level security;
alter table public.tracking_events enable row level security;
alter table public.quote_requests enable row level security;
alter table public.contact_messages enable row level security;

drop policy if exists "admins manage admin records" on public.admin_users;
drop policy if exists "admins manage shipments" on public.shipments;
drop policy if exists "admins manage tracking events" on public.tracking_events;
drop policy if exists "admins read quote requests" on public.quote_requests;
drop policy if exists "admins manage quote requests" on public.quote_requests;
drop policy if exists "visitors submit quote requests" on public.quote_requests;
drop policy if exists "admins read contact messages" on public.contact_messages;
drop policy if exists "admins manage contact messages" on public.contact_messages;
drop policy if exists "visitors submit contact messages" on public.contact_messages;

create policy "admins manage admin records" on public.admin_users
  for select to authenticated using (public.is_admin());
create policy "admins manage shipments" on public.shipments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage tracking events" on public.tracking_events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage quote requests" on public.quote_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "visitors submit quote requests" on public.quote_requests
  for insert to anon, authenticated with check (true);
create policy "admins manage contact messages" on public.contact_messages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "visitors submit contact messages" on public.contact_messages
  for insert to anon, authenticated with check (true);

-- Replace the email and run this after creating the admin user in Authentication > Users.
-- insert into public.admin_users (id)
-- select id from auth.users where email = 'your-admin-email@example.com'
-- on conflict (id) do nothing;

-- Refresh Supabase's API schema cache after running this migration.
notify pgrst, 'reload schema';
