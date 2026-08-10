const INSTANCES = [
  'https://inv.tux.pizza',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://inv.vern.cc',
  'https://invidious.no-logs.com'
]

// Helper to fetch from a single instance with a strict timeout
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

// Races multiple instances in parallel to get the fastest successful response
async function raceInvidious(path) {
  const promises = INSTANCES.map(async (instance) => {
    try {
      return await fetchWithTimeout(`${instance}${path}`, 2200)
    } catch (err) {
      // Reject so Promise.any knows this one failed
      throw err
    }
  })

  try {
    // Returns the fastest resolved promise
    return await Promise.any(promises)
  } catch (err) {
    console.error('[Invidious Race] All instances failed or timed out:', err)
    throw new Error('Search failed. All servers are busy, please try again.')
  }
}

export async function searchYoutube(query) {
  if (!query.trim()) return []
  try {
    const data = await raceInvidious(`/api/v1/search?q=${encodeURIComponent(query)}&type=video`)
    return (data || []).slice(0, 8).map(item => ({
      id: item.videoId,
      title: item.title,
      artist: item.author,
      art: item.videoThumbnails?.find(t => t.quality === 'medium')?.url || item.videoThumbnails?.[0]?.url || '',
      duration_ms: (item.lengthSeconds || 240) * 1000
    }))
  } catch (e) {
    console.error('[YouTube Search] Race error:', e)
    throw e
  }
}

export async function getRecommendations(videoId) {
  if (!videoId) return []
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
    console.error('[YouTube Recs] Race error:', e)
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
