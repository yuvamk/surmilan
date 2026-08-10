import { useEffect, useState } from 'react'
import { findMatch, supabase, updateListeningPresence } from './lib/supabase'

export function useMusicMatch() {
  const [track, setTrack] = useState(null)
  const [room, setRoom] = useState(null)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(0)

  useEffect(() => {
    if (!supabase) return
    const channel = supabase.channel('sur-milan-lobby', { config: { presence: { key: crypto.randomUUID() } } })
      .on('presence', { event: 'sync' }, () => setOnline(Object.keys(channel.presenceState()).length))
      .subscribe(status => { if (status === 'SUBSCRIBED') channel.track({ online_at: new Date().toISOString() }) })
    return () => { supabase.removeChannel(channel) }
  }, [])

  const match = async () => {
    try {
      setError('')
      if (!track) throw new Error('Select and play a song in the player first.')
      await updateListeningPresence(track)
      const found = await findMatch(track.id)
      if (found) setRoom(found)
      else setError('You are in the listening queue. We’ll pair you when a song twin arrives.')
    } catch (e) {
      setError(e.message)
    }
  }

  return { track, setTrack, room, setRoom, error, online, match }
}
