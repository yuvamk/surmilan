# Sur Milan

A one-page music-social landing page with a six-minute same-song chat experience.

## Run it

1. Copy `.env.example` to `.env.local` and add the public Supabase URL and anon key.
2. In Supabase, run [`supabase/schema.sql`](./supabase/schema.sql), then enable **Spotify** under Authentication → Providers. Paste the Spotify client ID/secret there, not in this repository. Add `http://localhost:5173` (and your production domain) as redirect URLs in both Spotify Developer Dashboard and Supabase Auth settings.
3. In Spotify Developer Dashboard, request the `user-read-currently-playing` and `user-read-playback-state` scopes. The browser receives only the temporary provider token from the signed-in user; the Spotify app secret stays in Supabase.
4. Install packages with `npm install`, then start with `npm run dev`.

## Wallpaper swap

The hero image is only defined once: the `.wallpaper` background URL near the top of `src/styles.css`. Replace it with a local file placed in `public/` (for example `url('/wallpaper.jpg')`) whenever final artwork is ready. The overlay gradients keep text legible without redesigning the UI.

## Production architecture

The product is live-wired once the above configuration is supplied: `src/useMusicMatch.js` authenticates with Spotify, reads the playing track, advertises it for matching, and joins a room returned by the atomic database function. The chat listens to Supabase Realtime and has RLS protection. No secret is committed to the repository.

YouTube Music has no official public API for reading a listener's current playback, so its control intentionally remains labelled “soon”; it should not be represented as a functional integration until a permitted provider/partner method is selected.
