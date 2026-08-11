import { supabase } from './supabase'

export const LOFI_STATIONS = [
  {
    id: 'lofi-chill-beats',
    title: 'Lofi Chill Radio',
    artist: 'Chillhop Beats',
    normalizedKey: 'lofi chill radio|chillhop beats',
    art: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=300&auto=format&fit=crop&q=80',
    streamUrl: 'https://streaming.radio.co/s5c9b68a86/listen',
    duration_ms: 999999999
  },
  {
    id: 'lofi-relaxing-vibes',
    title: 'Relaxing Vibes Radio',
    artist: 'Lofi Zeno',
    normalizedKey: 'relaxing vibes radio|lofi zeno',
    art: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=300&auto=format&fit=crop&q=80',
    streamUrl: 'https://stream.zeno.fm/f3wvbbq152zuv',
    duration_ms: 999999999
  }
]

const INSTANCES = [
  'https://inv.tux.pizza',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://inv.vern.cc',
  'https://invidious.no-logs.com'
]

// Normalizes song titles and artist names to match cross-platform and for DB key cache
export function normalizeTrackKey(title, artist) {
  const clean = (str) => {
    if (!str) return ''
    return str
      .normalize('NFD') // Unicode normalization
      .replace(/[\u0300-\u036f]/g, '') // remove accent marks
      .toLowerCase()
      // Remove common noise words
      .replace(/\b(official|audio|video|lyrics?|hd|4k|full\s*song|hq|music\s*video|lyric\s*video)\b/gi, '')
      .replace(/[^\w\s]/g, ' ') // replace punctuation with spaces
      .replace(/\s+/g, ' ') // collapse repeated whitespace
      .trim()
  }
  return `${clean(title)}|${clean(artist)}`
}

// Helper for Invidious fallback racing
async function fetchWithTimeout(url, timeoutMs = 4000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(id)
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`)
    return await res.json()
  } catch (err) {
    clearTimeout(id)
    throw err
  }
}

async function raceInvidious(path) {
  const promises = INSTANCES.map(async (instance) => {
    try {
      return await fetchWithTimeout(`${instance}${path}`, 2500)
    } catch (err) {
      throw err
    }
  })
  try {
    return await Promise.any(promises)
  } catch (err) {
    console.error('[Invidious Race] Failed:', err)
    throw err
  }
}

// ── Search Tracks ────────────────────────────────────────────────────────────

export async function searchYoutube(query) {
  if (!query.trim()) return []

  console.log('[YouTube Search] Querying iTunes music database...')
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=8`)
    if (res.ok) {
      const data = await res.json()
      
      const tracks = (data.results || []).map((track) => {
        const normKey = normalizeTrackKey(track.trackName, track.artistName)
        return {
          id: null, // to be resolved on play click
          itunesId: String(track.trackId || `${track.trackName}-${track.artistName}`),
          title: track.trackName,
          artist: track.artistName,
          normalizedKey: normKey,
          art: track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '300x300bb') : '',
          duration_ms: track.trackTimeMillis || 240000
        }
      })

      if (tracks.length > 0 && supabase) {
        // Query the database cache to see which tracks are already resolved
        const keys = tracks.map(t => t.normalizedKey)
        const { data: cached } = await supabase
          .from('music_tracks')
          .select('normalized_key, youtube_video_id')
          .in('normalized_key', keys)

        if (cached && cached.length > 0) {
          const cacheMap = {}
          cached.forEach(row => {
            if (row.youtube_video_id) {
              cacheMap[row.normalized_key] = row.youtube_video_id
            }
          })
          tracks.forEach(track => {
            if (cacheMap[track.normalizedKey]) {
              track.id = cacheMap[track.normalizedKey]
            }
          })
        }
      }
      return tracks
    }
  } catch (err) {
    console.error('[YouTube Search] iTunes search error:', err)
  }

  // Absolute fallback: search Invidious directly
  console.log('[YouTube Search] Falling back directly to Invidious race...')
  try {
    const data = await raceInvidious(`/api/v1/search?q=${encodeURIComponent(query)}&type=video`)
    return (data || []).slice(0, 8).map(item => {
      const normKey = normalizeTrackKey(item.title, item.author)
      return {
        id: item.videoId,
        title: item.title,
        artist: item.author,
        normalizedKey: normKey,
        art: item.videoThumbnails?.find(t => t.quality === 'medium')?.url || item.videoThumbnails?.[0]?.url || '',
        duration_ms: (item.lengthSeconds || 240) * 1000
      }
    })
  } catch (err) {
    throw new Error('Search failed. Please try a different song.')
  }
}

// Resolve YouTube video ID for a song on-demand (first from serverless cache, then races fallbacks)
export async function resolveYoutubeVideoId(title, artist, normalizedKey) {
  if (!normalizedKey) {
    normalizedKey = normalizeTrackKey(title, artist)
  }

  console.log(`[Resolve YT ID] Requesting serverless API resolution: "${title}" by "${artist}"`)
  try {
    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, artist, normalizedKey })
    })

    if (res.ok) {
      const data = await res.json()
      if (data.youtubeVideoId) {
        console.log(`[Resolve YT ID] Serverless API resolved to: ${data.youtubeVideoId}`)
        return data.youtubeVideoId
      }
    } else {
      const err = await res.json().catch(() => ({}))
      console.warn('[Resolve YT ID] Serverless API error response:', err)
    }
  } catch (err) {
    console.warn('[Resolve YT ID] Serverless API error, calling client race...', err)
  }

  // Client-side fallback race across Piped and Invidious
  return raceClientFallbacks(title, artist)
}

async function raceClientFallbacks(title, artist) {
  const query = `${title} ${artist}`
  const PIPED_INSTANCES = [
    'https://piped.mha.fi',
    'https://piped-api.hostux.net',
    'https://pipedapi.adminforge.de',
    'https://piped-api.lunar.icu',
    'https://pipedapi.kavin.rocks'
  ]

  const INVIDIOUS_INSTANCES = [
    'https://yewtu.be',
    'https://inv.tux.pizza',
    'https://invidious.nerdvpn.de',
    'https://inv.vern.cc',
    'https://invidious.no-logs.com'
  ]

  console.log('[Resolve YT ID] Racing client-side Piped mirrors...')
  const pipedPromises = PIPED_INSTANCES.map(async (instance) => {
    const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=videos`
    try {
      const res = await fetchWithTimeout(url, 4000)
      const video = res.items?.find(item => item.type === 'video')
      if (video?.videoId) return video.videoId
      throw new Error('No video found')
    } catch (err) {
      throw err
    }
  })

  try {
    const videoId = await Promise.any(pipedPromises)
    if (videoId) return videoId
  } catch (err) {
    console.warn('[Resolve YT ID] Client Piped race failed, trying Invidious...')
  }

  console.log('[Resolve YT ID] Racing client-side Invidious mirrors...')
  const invidiousPromises = INVIDIOUS_INSTANCES.map(async (instance) => {
    const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`
    try {
      const res = await fetchWithTimeout(url, 4000)
      const videoId = res?.[0]?.videoId
      if (videoId) return videoId
      throw new Error('No video found')
    } catch (err) {
      throw err
    }
  })

  try {
    const videoId = await Promise.any(invidiousPromises)
    if (videoId) return videoId
  } catch (err) {
    console.error('[Resolve YT ID] Client Invidious race failed too.')
  }

  throw new Error('Could not resolve video on YouTube')
}

// ── Get Suggested Song recommendations for Autoplay ─────────────────────────

export async function getRecommendations(normalizedKey, title = '', artist = '') {
  if (!normalizedKey) {
    normalizedKey = normalizeTrackKey(title, artist)
  }

  console.log(`[Recommendations] Pulling recommendations for: ${normalizedKey}`)
  try {
    const res = await fetch(`/api/recommend?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}&normalizedKey=${encodeURIComponent(normalizedKey)}`)
    if (res.ok) {
      const data = await res.json()
      if (data && data.length > 0) {
        return data
      }
    }
  } catch (err) {
    console.error('[Recommendations] API call failed:', err)
  }

  // Client-side fallback recommendations
  return [
    {
      id: 'lofi-chill-beats',
      normalizedKey: 'lofi chill radio|chillhop beats',
      title: 'Lofi Chill Radio',
      artist: 'Chillhop Beats',
      art: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=300&auto=format&fit=crop&q=80',
      duration_ms: 240000
    },
    {
      id: 'lofi-relaxing-vibes',
      normalizedKey: 'relaxing vibes radio|lofi zeno',
      title: 'Relaxing Vibes Radio',
      artist: 'Lofi Zeno',
      art: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=300&auto=format&fit=crop&q=80',
      duration_ms: 240000
    }
  ]
}

// ── YouTube IFrame SDK Loader ──────────────────────────────────────────────

let sdkPromise = null

export function loadYoutubeSDK() {
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT)
      return
    }

    const prevCallback = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback()
      resolve(window.YT)
    }

    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    const firstScriptTag = document.getElementsByTagName('script')[0]
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
  })

  return sdkPromise
}
