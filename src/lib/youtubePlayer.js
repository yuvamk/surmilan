const INSTANCES = [
  'https://inv.tux.pizza',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://inv.vern.cc'
]

// Helper to query Invidious instances with a fallback strategy
async function fetchFromInvidious(path) {
  for (const instance of INSTANCES) {
    try {
      const url = `${instance}${path}`
      const res = await fetch(url)
      if (res.ok) {
        return await res.json()
      }
    } catch (e) {
      console.warn(`[Invidious] Instance ${instance} failed for ${path}:`, e)
    }
  }
  throw new Error('All Invidious API instances are currently unresponsive. Please try again.')
}

export async function searchYoutube(query) {
  if (!query.trim()) return []
  try {
    const data = await fetchFromInvidious(`/api/v1/search?q=${encodeURIComponent(query)}&type=video`)
    return (data || []).map(item => ({
      id: item.videoId,
      title: item.title,
      artist: item.author,
      art: item.videoThumbnails?.find(t => t.quality === 'medium')?.url || item.videoThumbnails?.[0]?.url || '',
      duration_ms: (item.lengthSeconds || 240) * 1000
    }))
  } catch (e) {
    console.error('[YouTube Search] Error:', e)
    throw e
  }
}

export async function getRecommendations(videoId) {
  if (!videoId) return []
  try {
    const data = await fetchFromInvidious(`/api/v1/videos/${videoId}`)
    const recs = data?.recommendedVideos || []
    return recs.map(item => ({
      id: item.videoId,
      title: item.title,
      artist: item.author,
      art: item.videoThumbnails?.find(t => t.quality === 'medium')?.url || item.videoThumbnails?.[0]?.url || '',
      duration_ms: (item.lengthSeconds || 240) * 1000
    }))
  } catch (e) {
    console.error('[YouTube Recs] Error:', e)
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

    // Register callback for YouTube script
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
