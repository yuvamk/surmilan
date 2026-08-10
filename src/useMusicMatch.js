import { useEffect, useState } from 'react'
import { findMatch, getSpotifyTrack, signInWithSpotify, supabase, updateListeningPresence } from './lib/supabase'

export function useMusicMatch() {
  const [session, setSession] = useState(null), [track, setTrack] = useState(null), [room, setRoom] = useState(null), [error, setError] = useState(''), [online, setOnline] = useState(0)

  useEffect(() => {
    if (!supabase) return
    // Grab the initial session (handles the OAuth callback hash on first load)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSession(data.session)
    })
    const { data: auth } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    const channel = supabase.channel('sur-milan-lobby', { config: { presence: { key: crypto.randomUUID() } } })
      .on('presence', { event: 'sync' }, () => setOnline(Object.keys(channel.presenceState()).length))
      .subscribe(status => { if (status === 'SUBSCRIBED') channel.track({ online_at: new Date().toISOString() }) })
    return () => { auth.subscription.unsubscribe(); supabase.removeChannel(channel) }
  }, [])

  const refreshTrack = async () => {
    // Always fetch the freshest session to ensure provider_token is present
    const { data: { session: freshSession } } = await supabase.auth.getSession()
    const token = freshSession?.provider_token
    if (!token) throw new Error('Connect Spotify first — click the "Connect Spotify" button below.')
    const song = await getSpotifyTrack(token)
    if (!song) throw new Error('Play a song in Spotify, then try again.')
    setTrack(song)
    return song
  }

  const connect = async () => { try { setError(''); await signInWithSpotify() } catch (e) { setError(e.message) } }
  const match = async () => { try { setError(''); const song = await refreshTrack(); await updateListeningPresence(song); const found = await findMatch(song.id); if (found) setRoom(found); else setError('You are in the listening queue. We\u2019ll pair you when a song twin arrives.') } catch (e) { setError(e.message) } }
  return { session, track, setTrack, room, setRoom, error, online, connect, match }
}
