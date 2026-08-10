const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY

const INSTANCES = [
  'https://inv.tux.pizza',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://inv.vern.cc',
  'https://invidious.no-logs.com'
]

// Helper for Invidious fallback racing
async function fetchWithTimeout(url, timeoutMs = 2000) {
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
      return await fetchWithTimeout(`${instance}${path}`, 2000)
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

  // Method 1: Use official Google YouTube API if key is supplied (blazing fast & stable)
  if (apiKey) {
    try {
      console.log('[YouTube API] Searching using official Google API...')
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=8&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&key=${apiKey}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        return (data.items || []).map(item => ({
          id: item.id.videoId,
          title: item.snippet.title,
          artist: item.snippet.channelTitle,
          art: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
          duration_ms: 240000 // duration retrieved on load by iframe player
        }))
      } else {
        const errorData = await res.json().catch(() => ({}))
        console.error('[YouTube API] Google Error response:', errorData)
      }
    } catch (err) {
      console.error('[YouTube API] Google fetch error:', err)
    }
  }

  // Method 2: Fall back to iTunes Music search (keyless, 100% stable, CORS-free, ultra-fast)
  console.log('[YouTube Search] Falling back to iTunes search...')
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=8`)
    if (res.ok) {
      const data = await res.json()
      
      // For each iTunes track, find its video ID on YouTube in parallel using Invidious race
      const trackPromises = (data.results || []).map(async (track) => {
        try {
          // Search for track ID
          const ytSearch = await raceInvidious(`/api/v1/search?q=${encodeURIComponent(track.trackName + ' ' + track.artistName)}&type=video`)
          const videoId = ytSearch?.[0]?.videoId
          if (!videoId) return null
          
          return {
            id: videoId,
            title: track.trackName,
            artist: track.artistName,
            art: track.artworkUrl100.replace('100x100bb', '300x300bb'),
            duration_ms: track.trackTimeMillis || 240000
          }
        } catch {
          return null
        }
      })
      
      const tracks = await Promise.all(trackPromises)
      const validTracks = tracks.filter(Boolean)
      if (validTracks.length > 0) return validTracks
    }
  } catch (err) {
    console.error('[YouTube Search] iTunes fallback error:', err)
  }

  // Method 3: Absolute fallback directly search Invidious
  console.log('[YouTube Search] Falling back directly to Invidious race...')
  try {
    const data = await raceInvidious(`/api/v1/search?q=${encodeURIComponent(query)}&type=video`)
    return (data || []).slice(0, 8).map(item => ({
      id: item.videoId,
      title: item.title,
      artist: item.author,
      art: item.videoThumbnails?.find(t => t.quality === 'medium')?.url || item.videoThumbnails?.[0]?.url || '',
      duration_ms: (item.lengthSeconds || 240) * 1000
    }))
  } catch (err) {
    throw new Error('Search failed. Please try a different song or check API key.')
  }
}

// ── Get Suggested Song recommendations for Autoplay ─────────────────────────

export async function getRecommendations(videoId, title = '', artist = '') {
  if (!videoId) return []

  // Method 1: Use official Google YouTube API to search for other songs by the same artist
  if (apiKey && artist) {
    try {
      console.log(`[YouTube Recs] Fetching similar tracks for artist: ${artist}...`)
      // Search for the artist's tracks on YouTube
      const query = `${artist} songs`
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=8&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&key=${apiKey}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        return (data.items || [])
          .filter(item => item.id.videoId !== videoId) // filter out current song
          .map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            artist: item.snippet.channelTitle,
            art: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
            duration_ms: 240000
          }))
      }
    } catch (err) {
      console.error('[YouTube Recs] Google API fetch error:', err)
    }
  }

  // Method 2: Fallback to Invidious recommendations
  try {
    const data = await raceInvidious(`/api/v1/videos/${videoId}`)
    const recs = data?.recommendedVideos || []
    return recs.map(item => ({
      id: item.videoId,
      title: item.title,
      artist: item.author,
      art: item.videoThumbnails?.find(t => t.quality === 'medium')?.url || item.videoThumbnails?.[0]?.url || '',
      duration_ms: (item.lengthSeconds || 240) * 1000
    }))
  } catch (e) {
    // Method 3: Absolute fallback - search general popular songs
    if (apiKey) {
      try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&q=lodi%20songs%20lofi%20music&type=video&videoCategoryId=10&key=${apiKey}`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          return (data.items || []).map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            artist: item.snippet.channelTitle,
            art: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
            duration_ms: 240000
          }))
        }
      } catch {}
    }
    return []
  }
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
