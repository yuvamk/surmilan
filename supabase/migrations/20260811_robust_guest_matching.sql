-- 1. Remove the strict foreign key to auth.users to allow guest profiles
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- 2. Add columns for Device Handover (play continuity) and track metadata
alter table public.listening_presence add column if not exists device_id text;
alter table public.listening_presence add column if not exists progress_ms integer default 0;
alter table public.listening_presence add column if not exists is_playing boolean default false;
alter table public.listening_presence add column if not exists track_title text;
alter table public.listening_presence add column if not exists track_artist text;
alter table public.listening_presence add column if not exists track_art text;
alter table public.listening_presence add column if not exists stream_url text;

-- 2. Relax RLS policies to allow guest users (anon role) to create profiles/presence
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (id = coalesce(auth.uid(), id)) with check (id = coalesce(auth.uid(), id));

drop policy if exists "own listening status" on public.listening_presence;
create policy "own listening status" on public.listening_presence for all using (user_id = coalesce(auth.uid(), user_id)) with check (user_id = coalesce(auth.uid(), user_id));

-- 3. Rewrite match_listener to align with JS params and prevent one-sided matches
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

grant execute on function public.match_listener(text, uuid, text) to authenticated, anon;

-- 4. Rewrite reserve_next_match to align with JS params and guest users
create or replace function public.reserve_next_match(
  p_room_id uuid,
  p_track_id text,
  p_user_id uuid default null
)
returns setof public.match_rooms language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  current_room public.match_rooms;
  partner public.rematch_queue;
  created public.match_rooms;
  existing_next public.match_rooms;
begin
  v_user_id := coalesce(auth.uid(), p_user_id);
  if v_user_id is null then raise exception 'User ID is required'; end if;

  select * into current_room from public.match_rooms where id = p_room_id and (member_a = v_user_id or member_b = v_user_id) and closed_at is null for update;
  if current_room.id is null then raise exception 'Room not available'; end if;

  -- Check if next room is already reserved/created by partner
  select * into existing_next from public.match_rooms
  where track_id = p_track_id
    and (member_a = v_user_id or member_b = v_user_id)
    and starts_at = current_room.expires_at
    and closed_at is null
  limit 1;

  if existing_next.id is not null then
    return next existing_next;
    return;
  end if;

  if now() < current_room.expires_at - interval '15 seconds' then raise exception 'Rematching starts in the final 15 seconds'; end if;
  
  insert into public.rematch_queue(user_id, track_id, available_at)
  values (v_user_id, p_track_id, current_room.expires_at)
  on conflict(user_id) do update set track_id = excluded.track_id, available_at = excluded.available_at;

  select * into partner from public.rematch_queue q
  where q.track_id = p_track_id
    and q.user_id <> v_user_id
    and abs(extract(epoch from (q.available_at - current_room.expires_at))) <= 20
  order by q.created_at
  for update skip locked
  limit 1;

  if partner.user_id is null then return; end if;

  insert into public.match_rooms(track_id, member_a, member_b, starts_at, expires_at)
  values (p_track_id, v_user_id, partner.user_id, current_room.expires_at, current_room.expires_at + interval '6 minutes') returning * into created;

  delete from public.rematch_queue where user_id in (v_user_id, partner.user_id);
  return next created;
end $$;

grant execute on function public.reserve_next_match(uuid, text, uuid) to authenticated, anon;
