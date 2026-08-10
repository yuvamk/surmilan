let _player = null
let _deviceId = null

function loadSDK() {
  return new Promise(resolve => {
    if (window.Spotify) { resolve(); return }
    const s = document.createElement('script')
    s.src = 'https://sdk.scdn.co/spotify-player.js'
    document.head.appendChild(s)
    window.onSpotifyWebPlaybackSDKReady = resolve
  })
}

export async function initSpotifyPlayer(token, { onStateChange, onReady, onError }) {
  try {
    await loadSDK()
    _player = new window.Spotify.Player({
      name: 'Sur Milan',
      getOAuthToken: cb => cb(token),
      volume: 0.7,
    })
    _player.addListener('player_state_changed', onStateChange)
    _player.addListener('ready', ({ device_id }) => { _deviceId = device_id; onReady(device_id) })
    _player.addListener('not_ready', () => { _deviceId = null })
    _player.addListener('initialization_error', ({ message }) => onError('Init: ' + message))
    _player.addListener('authentication_error', ({ message }) => onError('Auth: ' + message))
    _player.addListener('account_error', () => onError('Spotify Premium is required for full playback controls.'))
    const ok = await _player.connect()
    if (!ok) throw new Error('Spotify player failed to connect')
    return _player
  } catch (e) {
    onError(e.message)
    return null
  }
}

export function getPlayer() { return _player }
export function getDeviceId() { return _deviceId }
export function disconnectPlayer() {
  if (_player) { _player.disconnect(); _player = null; _deviceId = null }
}

// ── REST API helpers ───────────────────────────────────────────────────────────

function headers(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export async function searchTracks(query, token) {
  if (!query.trim() || !token) return { tracks: [], error: !token ? 'no_token' : null }
  try {
    const r = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=8`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      console.error('[Spotify Search] Error', r.status, body)
      return { tracks: [], error: `${r.status}: ${body?.error?.message || 'API error'}` }
    }
    const d = await r.json()
    console.log('[Spotify Search] Got', d.tracks?.items?.length, 'results')
    return { tracks: d.tracks?.items || [], error: null }
  } catch (e) {
    console.error('[Spotify Search] Fetch error', e)
    return { tracks: [], error: e.message }
  }
}

export async function apiPlay(playOptions, deviceId, token) {
  const url = `https://api.spotify.com/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`
  await fetch(url, { method: 'PUT', headers: headers(token), body: JSON.stringify(playOptions) })
}

export async function apiNext(token) {
  await fetch('https://api.spotify.com/v1/me/player/next', { method: 'POST', headers: headers(token) })
}

export async function apiPrev(token) {
  await fetch('https://api.spotify.com/v1/me/player/previous', { method: 'POST', headers: headers(token) })
}

export async function apiSeek(positionMs, token) {
  await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`, {
    method: 'PUT', headers: headers(token),
  })
}
