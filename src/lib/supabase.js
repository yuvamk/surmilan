import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = url && key ? createClient(url, key) : null

export async function signInWithSpotify() {
  if (!supabase) throw new Error('Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local first.')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'spotify',
    options: { redirectTo: window.location.origin, scopes: 'streaming user-modify-playback-state user-read-email user-read-private user-read-currently-playing user-read-playback-state' },
  })
  if (error) throw error
  // signInWithOAuth v2 returns the URL — we must navigate manually
  if (data?.url) window.location.href = data.url
}

export async function getSpotifyTrack(accessToken) {
  const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: `Bearer ${accessToken}` } })
  if (response.status === 204) return null
  if (!response.ok) throw new Error('Spotify could not read your current song. Start playing a track and try again.')
  const data = await response.json()
  if (!data.item) return null
  return { id: data.item.id, title: data.item.name, artist: data.item.artists.map(a => a.name).join(' · '), art: data.item.album?.images?.[1]?.url || data.item.album?.images?.[0]?.url }
}

let guestUser = null

export function getOrCreateGuestUser() {
  if (guestUser) return guestUser
  let stored = localStorage.getItem('sur-milan-guest-user')
  if (stored) {
    try {
      guestUser = JSON.parse(stored)
      return guestUser
    } catch {}
  }
  const id = crypto.randomUUID()
  const guestName = `Guest ${Math.floor(1000 + Math.random() * 9000)}`
  guestUser = { id, display_name: guestName }
  localStorage.setItem('sur-milan-guest-user', JSON.stringify(guestUser))
  return guestUser
}

export async function updateListeningPresence(track) {
  if (!supabase) return
  let userId, displayName
  
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    userId = user.id
    displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'music lover'
  } else {
    const guest = getOrCreateGuestUser()
    userId = guest.id
    displayName = guest.display_name
  }

  const profile = await supabase.from('profiles').upsert({ id: userId, display_name: displayName })
  if (profile.error) throw profile.error

  const { error } = await supabase.from('listening_presence').upsert({ 
    user_id: userId, 
    provider: 'youtube', 
    track_id: track.id, 
    updated_at: new Date().toISOString() 
  })
  if (error) throw error
}

export async function leaveRoom(roomId) {
  if (!supabase) return
  await supabase.from('match_rooms').update({ closed_at: new Date().toISOString() }).eq('id', roomId)
}

export async function reportRoom(roomId, reason = 'User report') {
  if (!supabase) return
  await supabase.from('room_reports').insert({ room_id: roomId, reason })
}

export async function findMatch(trackId) {
  let userId, displayName
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    userId = user.id
    displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'music lover'
  } else {
    const guest = getOrCreateGuestUser()
    userId = guest.id
    displayName = guest.display_name
  }

  const { data, error } = await supabase.rpc('match_listener', { 
    p_track_id: trackId,
    p_user_id: userId,
    p_display_name: displayName
  })
  if (error) throw error
  return data?.[0] || null
}

export async function reserveNextMatch(roomId, trackId) {
  let userId
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    userId = user.id
  } else {
    const guest = getOrCreateGuestUser()
    userId = guest.id
  }

  const { data, error } = await supabase.rpc('reserve_next_match', { 
    p_room_id: roomId, 
    p_track_id: trackId,
    p_user_id: userId
  })
  if (error) throw error
  return data?.[0] || null
}
