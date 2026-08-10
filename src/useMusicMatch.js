import { useEffect, useState } from 'react'
import { findMatch, supabase, updateListeningPresence } from './lib/supabase'

export function useMusicMatch() {
  const [track, setTrack] = useState(null)
  const [room, setRoom] = useState(null)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(0)

  // 1. Maintain lobby presence and count online listeners
  useEffect(() => {
    if (!supabase) return
    const channel = supabase.channel('sur-milan-lobby', { config: { presence: { key: crypto.randomUUID() } } })
      .on('presence', { event: 'sync' }, () => setOnline(Object.keys(channel.presenceState()).length))
      .subscribe(status => { if (status === 'SUBSCRIBED') channel.track({ online_at: new Date().toISOString() }) })
    return () => { supabase.removeChannel(channel) }
  }, [])

  // 2. Fully Automatic Matching: Polls for matches in background when a track is active
  useEffect(() => {
    if (!track || room) return

    const runMatch = async () => {
      try {
        setError('')
        // Post presence
        await updateListeningPresence(track)
        // Check for song twins
        const found = await findMatch(track.id)
        if (found) {
          setRoom(found)
        }
      } catch (e) {
        console.error('[Auto Match] Error:', e)
        // Don't interrupt user play, just log or set transient match error if critical
      }
    }

    // Run matching immediately
    runMatch()

    // Poll matching state every 8 seconds
    const interval = setInterval(runMatch, 8000)

    return () => clearInterval(interval)
  }, [track, room])

  return { track, setTrack, room, setRoom, error, online }
}
