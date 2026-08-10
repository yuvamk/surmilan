-- Apply after supabase/schema.sql. This makes next-match reservations safe at scale.
alter table public.match_rooms add column if not exists starts_at timestamptz not null default now();
create index if not exists match_rooms_members_active_idx on public.match_rooms(member_a, member_b, expires_at);
create index if not exists presence_match_idx on public.listening_presence(track_id, updated_at);

create table if not exists public.rematch_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  track_id text not null,
  available_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists rematch_queue_track_available_idx on public.rematch_queue(track_id, available_at, created_at);
alter table public.rematch_queue enable row level security;
create policy "users see own queued item" on public.rematch_queue for select using (user_id = auth.uid());

-- Called only during the final 15 seconds. It reserves a future room (rather than
-- interrupting the current one), and locks the selected queue row so nobody can pair twice.
create or replace function public.reserve_next_match(p_room_id uuid, p_track_id text)
returns setof public.match_rooms language plpgsql security definer set search_path = public as $$
declare current_room public.match_rooms; partner public.rematch_queue; created public.match_rooms;
begin
  select * into current_room from public.match_rooms where id = p_room_id and auth.uid() in (member_a,member_b) and closed_at is null for update;
  if current_room.id is null then raise exception 'Room not available'; end if;
  if now() < current_room.expires_at - interval '15 seconds' then raise exception 'Rematching starts in the final 15 seconds'; end if;
  insert into public.rematch_queue(user_id,track_id,available_at) values(auth.uid(),p_track_id,current_room.expires_at)
    on conflict(user_id) do update set track_id=excluded.track_id,available_at=excluded.available_at;
  select * into partner from public.rematch_queue q
    where q.track_id=p_track_id and q.user_id<>auth.uid() and abs(extract(epoch from (q.available_at-current_room.expires_at))) <= 20
    order by q.created_at for update skip locked limit 1;
  if partner.user_id is null then return; end if;
  insert into public.match_rooms(track_id,member_a,member_b,starts_at,expires_at)
    values(p_track_id,auth.uid(),partner.user_id,current_room.expires_at,current_room.expires_at + interval '6 minutes') returning * into created;
  delete from public.rematch_queue where user_id in (auth.uid(),partner.user_id);
  return next created;
end $$;
revoke all on function public.reserve_next_match(uuid,text) from public;
grant execute on function public.reserve_next_match(uuid,text) to authenticated;

-- Prevent messages before the scheduled room begins.
drop policy if exists "members see messages" on public.room_messages;
drop policy if exists "members send before expiry" on public.room_messages;
create policy "members see messages" on public.room_messages for select using (exists (select 1 from public.match_rooms r where r.id=room_id and auth.uid() in (r.member_a,r.member_b) and r.starts_at<=now() and r.expires_at>now() and r.closed_at is null));
create policy "members send before expiry" on public.room_messages for insert with check (author_id=auth.uid() and exists (select 1 from public.match_rooms r where r.id=room_id and auth.uid() in (r.member_a,r.member_b) and r.starts_at<=now() and r.expires_at>now() and r.closed_at is null));

-- Run this periodically with Supabase Cron (every 5 minutes). It keeps each table bounded.
create or replace function public.cleanup_music_match() returns void language sql security definer set search_path=public as $$
  update match_rooms set closed_at=now() where closed_at is null and expires_at < now();
  delete from listening_presence where updated_at < now()-interval '2 minutes';
  delete from rematch_queue where available_at < now()-interval '1 minute';
$$;

-- Required for clients that are waiting in the final-15-second rematch queue.
alter publication supabase_realtime add table public.match_rooms;
