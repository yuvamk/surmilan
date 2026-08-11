-- 1. Create the music_tracks cache table
create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  album text,
  artwork_url text,
  duration_seconds integer,
  normalized_key text not null unique,
  youtube_video_id text,
  youtube_channel_id text,
  youtube_title text,
  youtube_match_confidence numeric,
  provider text default 'youtube',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_verified_at timestamptz
);

-- 2. Enable Row Level Security (RLS)
alter table public.music_tracks enable row level security;

-- 3. Create RLS Policies
drop policy if exists "allow select to all" on public.music_tracks;
create policy "allow select to all" on public.music_tracks for select using (true);

drop policy if exists "allow insert to all" on public.music_tracks;
create policy "allow insert to all" on public.music_tracks for insert with check (true);

drop policy if exists "allow update to all" on public.music_tracks;
create policy "allow update to all" on public.music_tracks for update using (true) with check (true);

-- 4. Create Indexes
create index if not exists music_tracks_normalized_key_idx on public.music_tracks(normalized_key);
create index if not exists music_tracks_youtube_video_id_idx on public.music_tracks(youtube_video_id);

-- 5. Concurrency-safe atomic resolution check/lock
create or replace function public.start_track_resolution(
  p_normalized_key text,
  p_title text,
  p_artist text
)
returns text language plpgsql security definer as $$
declare
  v_youtube_video_id text;
  v_updated_at timestamptz;
begin
  -- Ensure row exists (inserted with null video id)
  insert into public.music_tracks (title, artist, normalized_key, youtube_video_id)
  values (p_title, p_artist, p_normalized_key, null)
  on conflict (normalized_key) do nothing;

  -- Get current state
  select youtube_video_id, updated_at into v_youtube_video_id, v_updated_at
  from public.music_tracks where normalized_key = p_normalized_key;

  if v_youtube_video_id is not null then
    return v_youtube_video_id; -- Already resolved!
  end if;

  -- If another request is currently resolving (updated in last 15 seconds)
  if v_updated_at > now() - interval '15 seconds' then
    return 'pending';
  end if;

  -- Mark as pending by updating updated_at to now
  update public.music_tracks
  set updated_at = now()
  where normalized_key = p_normalized_key;

  return 'acquire';
end $$;

grant execute on function public.start_track_resolution(text, text, text) to authenticated, anon;
