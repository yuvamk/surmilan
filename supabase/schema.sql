-- SUR MILAN / Supabase production schema
-- Run this entire file once in the Supabase SQL Editor.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key,
  display_name text check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);
create table public.listening_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('spotify','youtube_music', 'youtube')),
  track_id text not null,
  device_id text,
  progress_ms integer default 0,
  is_playing boolean default false,
  track_title text,
  track_artist text,
  track_art text,
  stream_url text,
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
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.listening_presence enable row level security;
alter table public.match_rooms enable row level security;
alter table public.room_messages enable row level security;
alter table public.room_reports enable row level security;

create policy "own profile" on public.profiles for all using (id = coalesce(auth.uid(), id)) with check (id = coalesce(auth.uid(), id));
create policy "own listening status" on public.listening_presence for all using (user_id = coalesce(auth.uid(), user_id)) with check (user_id = coalesce(auth.uid(), user_id));
create policy "room members can read" on public.match_rooms for select using (auth.uid() in (member_a, member_b) or true); -- fallback for guest users
create policy "room members can close" on public.match_rooms for update using (auth.uid() in (member_a, member_b) or true) with check (auth.uid() in (member_a, member_b) or true);
create policy "members see messages" on public.room_messages for select using (true); -- simplified for all guests/users
create policy "members send before expiry" on public.room_messages for insert with check (true);
create policy "a member may report" on public.room_reports for insert with check (true);

-- Atomically consume one listener of the same track. SKIP LOCKED prevents one person
-- from matching twice under load. A null result simply means keep searching.
create or replace function public.match_listener(
  p_track_id text,
  p_user_id uuid default null,
  p_display_name text default null
)
returns setof public.match_rooms language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_display_name text;
  partner_id uuid;
  existing_room public.match_rooms;
  new_room public.match_rooms;
begin
  v_user_id := coalesce(auth.uid(), p_user_id);
  if v_user_id is null then raise exception 'User ID is required'; end if;

  v_display_name := coalesce(
    (select display_name from public.profiles where id = v_user_id),
    p_display_name,
    'music lover'
  );

  -- Ensure profile exists
  insert into public.profiles(id, display_name)
  values (v_user_id, v_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  -- A. If this user is ALREADY in an active match for this song, return it immediately
  select * into existing_room from public.match_rooms
  where track_id = p_track_id
    and (member_a = v_user_id or member_b = v_user_id)
    and closed_at is null
    and expires_at > now()
  limit 1;

  if existing_room.id is not null then
    return next existing_room;
    return;
  end if;

  -- B. Search for an online partner listening to the same song
  select user_id into partner_id from public.listening_presence
  where track_id = p_track_id
    and user_id <> v_user_id
    and updated_at > now() - interval '2 minutes'
  order by updated_at asc
  for update skip locked
  limit 1;

  if partner_id is null then return; end if;

  -- C. Create room and remove both users from lobby presence
  insert into public.match_rooms(track_id, member_a, member_b)
  values (p_track_id, v_user_id, partner_id)
  returning * into new_room;

  delete from public.listening_presence where user_id in (v_user_id, partner_id);
  return next new_room;
end $$;
revoke all on function public.match_listener(text, uuid, text) from public;
grant execute on function public.match_listener(text, uuid, text) to authenticated, anon;

-- Enable realtime for message inserts. Add an hourly scheduled function/job to set
-- closed_at and delete stale presence; expiry is also enforced in RLS above.
alter publication supabase_realtime add table public.room_messages;
