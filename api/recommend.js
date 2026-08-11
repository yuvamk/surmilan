import { createClient } from '@supabase/supabase-js'

export async function handler(req, res) {
  const title = req.query?.title || ''
  const artist = req.query?.artist || ''
  const normalizedKey = req.query?.normalizedKey || ''

  if (!artist) {
    return res.status(200).json([]) // No artist to search recommendations for
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Database environment variables not configured' })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  try {
    console.log(`[MUSIC RECOMMENDATIONS] Finding recommendations for artist: "${artist}" (excluding: ${normalizedKey})`)

    // Step 1. Fetch already resolved cache tracks by the same artist from our DB
    const { data: dbTracks } = await supabase
      .from('music_tracks')
      .select('*')
      .ilike('artist', `%${artist}%`)
      .not('youtube_video_id', 'is', null)
      .limit(6)

    let recommendations = (dbTracks || [])
      .filter(t => t.normalized_key !== normalizedKey)
      .map(t => ({
        id: t.youtube_video_id,
        normalizedKey: t.normalized_key,
        title: t.title,
        artist: t.artist,
        art: t.artwork_url || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80',
        duration_ms: (t.duration_seconds || 240) * 1000
      }))

    // Step 2. Fall back/augment with iTunes search for this artist's tracks (unlimited, CORS-free, quota-free)
    try {
      const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&media=music&limit=8`)
      if (itunesRes.ok) {
        const data = await itunesRes.json()
        const itunesTracks = (data.results || []).map(track => {
          const normKey = `${cleanStr(track.trackName)}|${cleanStr(track.artistName)}`
          return {
            id: null, // to be resolved on-demand
            normalizedKey: normKey,
            title: track.trackName,
            artist: track.artistName,
            art: track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '300x300bb') : '',
            duration_ms: track.trackTimeMillis || 240000
          }
        }).filter(t => t.normalizedKey !== normalizedKey)

        if (itunesTracks.length > 0) {
          // Query if any of these iTunes tracks are already in our music_tracks cache
          const keys = itunesTracks.map(t => t.normalizedKey)
          const { data: cachedMatches } = await supabase
            .from('music_tracks')
            .select('normalized_key, youtube_video_id')
            .in('normalized_key', keys)

          const cacheMap = {}
          if (cachedMatches) {
            cachedMatches.forEach(match => {
              cacheMap[match.normalized_key] = match.youtube_video_id
            })
          }

          // Populate video IDs for iTunes tracks if they exist in cache
          itunesTracks.forEach(t => {
            if (cacheMap[t.normalizedKey]) {
              t.id = cacheMap[t.normalizedKey]
            }
          })

          // Merge lists: prioritize already resolved recommendations, then add unresolved iTunes ones
          const merged = [...recommendations]
          const seenKeys = new Set(recommendations.map(t => t.normalizedKey))

          itunesTracks.forEach(t => {
            if (!seenKeys.has(t.normalizedKey)) {
              seenKeys.add(t.normalizedKey)
              merged.push(t)
            }
          })

          recommendations = merged
        }
      }
    } catch (itunesErr) {
      console.warn('[MUSIC RECOMMENDATIONS] iTunes recommendations fetch error:', itunesErr)
    }

    // Dedup and slice down to maximum 6 results
    return res.status(200).json(recommendations.slice(0, 6))

  } catch (err) {
    console.error('[MUSIC RECOMMENDATIONS] Recommendations generation failed:', err)
    return res.status(500).json({ error: err.message })
  }
}

// Clean helper (matched with client normalization helper)
function cleanStr(str) {
  if (!str) return ''
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(official|audio|video|lyrics?|hd|4k|full\s*song|hq|music\s*video|lyric\s*video)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Vercel serverless function default export
export default async function (req, res) {
  return handler(req, res)
}
