-- SUR MILAN / Supabase production schema
-- Run this entire file once in the Supabase SQL Editor.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);
create table public.listening_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('spotify','youtube_music')),
  track_id text not null,
  updated_at timestamptz not null default now()
);
create table public.match_rooms (
  id uuid primary key default gen_random_uuid(),
  track_id text not null,
  member_a uuid not null references public.profiles(id) on delete cascade,
  member_b uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '6 minutes'),
  closed_at timestamptz,
  check (member_a <> member_b)
);
create table public.room_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.match_rooms(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create table public.room_reports (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.match_rooms(id) on delete cascade,
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.listening_presence enable row level security;
alter table public.match_rooms enable row level security;
alter table public.room_messages enable row level security;
alter table public.room_reports enable row level security;

create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own listening status" on public.listening_presence for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "room members can read" on public.match_rooms for select using (auth.uid() in (member_a, member_b));
create policy "room members can close" on public.match_rooms for update using (auth.uid() in (member_a, member_b)) with check (auth.uid() in (member_a, member_b));
create policy "members see messages" on public.room_messages for select using (exists (select 1 from public.match_rooms r where r.id = room_id and auth.uid() in (r.member_a,r.member_b) and r.expires_at > now() and r.closed_at is null));
create policy "members send before expiry" on public.room_messages for insert with check (author_id = auth.uid() and exists (select 1 from public.match_rooms r where r.id = room_id and auth.uid() in (r.member_a,r.member_b) and r.expires_at > now() and r.closed_at is null));
create policy "a member may report" on public.room_reports for insert with check (reporter_id = auth.uid() and exists (select 1 from public.match_rooms r where r.id = room_id and auth.uid() in (r.member_a,r.member_b)));

-- Atomically consume one listener of the same track. SKIP LOCKED prevents one person
-- from matching twice under load. A null result simply means keep searching.
create or replace function public.match_listener(p_track_id text)
returns setof public.match_rooms language plpgsql security definer set search_path = public as $$
declare partner_id uuid; new_room public.match_rooms;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.profiles(id) values (auth.uid()) on conflict do nothing;
  select user_id into partner_id from public.listening_presence
    where track_id = p_track_id and user_id <> auth.uid() and updated_at > now() - interval '2 minutes'
    order by updated_at asc for update skip locked limit 1;
  if partner_id is null then return; end if;
  insert into public.match_rooms(track_id, member_a, member_b) values (p_track_id, auth.uid(), partner_id) returning * into new_room;
  delete from public.listening_presence where user_id in (auth.uid(), partner_id);
  return next new_room;
end $$;
revoke all on function public.match_listener(text) from public;
grant execute on function public.match_listener(text) to authenticated;

-- Enable realtime for message inserts. Add an hourly scheduled function/job to set
-- closed_at and delete stale presence; expiry is also enforced in RLS above.
alter publication supabase_realtime add table public.room_messages;
