import { createClient } from '@supabase/supabase-js'

export async function handler(req, res) {
  // Parse inputs
  let title = ''
  let artist = ''
  let normalizedKey = ''

  if (req.method === 'POST') {
    title = req.body?.title || ''
    artist = req.body?.artist || ''
    normalizedKey = req.body?.normalizedKey || ''
  } else {
    title = req.query?.title || ''
    artist = req.query?.artist || ''
    normalizedKey = req.query?.normalizedKey || ''
  }

  if (!title || !artist || !normalizedKey) {
    return res.status(400).json({ error: 'Missing title, artist, or normalizedKey parameter' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const youtubeApiKey = process.env.YOUTUBE_API_KEY || process.env.VITE_YOUTUBE_API_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Database environment variables not configured' })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  try {
    console.log(`[MUSIC ENGINE] Resolving track: "${title}" by "${artist}" [${normalizedKey}]`)

    // 1. Run concurrency-safe postgres atomic check & lock
    const { data: resCode, error: rpcErr } = await supabase.rpc('start_track_resolution', {
      p_normalized_key: normalizedKey,
      p_title: title,
      p_artist: artist
    })

    if (rpcErr) throw rpcErr

    // A. Already resolved!
    if (resCode && resCode !== 'pending' && resCode !== 'acquire') {
      console.log(`[MUSIC ENGINE] Cache HIT (DB): ${resCode} for ${normalizedKey}`)
      return res.status(200).json({ youtubeVideoId: resCode })
    }

    // B. Another request is currently resolving this track (Lock is active)
    if (resCode === 'pending') {
      console.log(`[MUSIC ENGINE] Resolution PENDING (locked). Waiting for active query...`)
      
      // Poll the database cache up to 5 times (total 7.5 seconds)
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        
        const { data: track } = await supabase
          .from('music_tracks')
          .select('youtube_video_id')
          .eq('normalized_key', normalizedKey)
          .single()
          
        if (track?.youtube_video_id) {
          console.log(`[MUSIC ENGINE] Wait completed. Resolved to: ${track.youtube_video_id}`)
          return res.status(200).json({ youtubeVideoId: track.youtube_video_id })
        }
      }
      
      return res.status(504).json({ error: 'Resolution timed out waiting for concurrent process' })
    }

    // C. Lock acquired! We are the chosen ones to make the YouTube search API call
    if (resCode === 'acquire') {
      if (!youtubeApiKey) {
        console.error('[MUSIC ENGINE] YouTube API key not configured on server')
        return res.status(500).json({ error: 'YouTube API key not configured on server' })
      }

      console.log(`[MUSIC ENGINE] Cache MISS. Querying YouTube Data API securely...`)
      const resolved = await fetchAndRankYoutube(title, artist, youtubeApiKey)

      if (resolved) {
        // Save the result back to the database cache
        const { error: updateErr } = await supabase
          .from('music_tracks')
          .update({
            youtube_video_id: resolved.id,
            youtube_channel_id: resolved.channelId,
            youtube_title: resolved.title,
            updated_at: new Date().toISOString()
          })
          .eq('normalized_key', normalizedKey)

        if (updateErr) console.error('[MUSIC ENGINE] Error updating cache row:', updateErr)

        console.log(`[MUSIC ENGINE] Resolved to: ${resolved.id}. Saved to database cache.`)
        return res.status(200).json({ youtubeVideoId: resolved.id })
      } else {
        // If YouTube returned no results, clean up or update so it can try again
        await supabase
          .from('music_tracks')
          .update({ updated_at: new Date(0).toISOString() }) // Reset lock
          .eq('normalized_key', normalizedKey)

        return res.status(404).json({ error: 'No matching videos found on YouTube' })
      }
    }
  } catch (err) {
    console.error('[MUSIC ENGINE] Resolution error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// YouTube Search and Ranking implementation
async function fetchAndRankYoutube(title, artist, apiKey) {
  const query = `"${title}" "${artist}"`
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&key=${apiKey}`

  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`YouTube API returned HTTP ${res.status}: ${err.error?.message || res.statusText}`)
  }

  const data = await res.json()
  const items = data.items || []
  if (items.length === 0) return null

  // Rank results based on match criteria
  const ranked = items.map(item => {
    const t = item.snippet.title.toLowerCase()
    const c = item.snippet.channelTitle.toLowerCase()
    const cleanTitle = title.toLowerCase()
    const cleanArtist = artist.toLowerCase()

    let score = 0

    // 1. Official artist/channel checks
    if (c.includes(cleanArtist) || c.includes('official') || c.includes('vevo')) {
      score += 10
    }

    // 2. Contains both title and artist in video title
    if (t.includes(cleanTitle) && t.includes(cleanArtist)) {
      score += 8
    } else if (t.includes(cleanTitle)) {
      score += 5
    }

    // 3. Official audio / music video tags
    if (t.includes('official audio') || t.includes('audio')) {
      score += 4
    } else if (t.includes('official video') || t.includes('official music video') || t.includes('music video')) {
      score += 3
    }

    // Avoid unrelated covers or live performances unless nothing else exists
    if (t.includes('cover') && !cleanTitle.includes('cover')) {
      score -= 5
    }
    if (t.includes('live') && !cleanTitle.includes('live')) {
      score -= 3
    }

    return {
      id: item.id.videoId,
      channelId: item.snippet.channelId,
      title: item.snippet.title,
      score
    }
  })

  // Sort descending by score
  ranked.sort((a, b) => b.score - a.score)
  return ranked[0]
}

// Vercel serverless function default export
export default async function (req, res) {
  return handler(req, res)
}
