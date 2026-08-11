import { useEffect, useState } from 'react'
import { findMatch, supabase, updateListeningPresence } from './lib/supabase'

export function useMusicMatch() {
  const [track, setTrack] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
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

  // 2. Fully Automatic Matching: Only matches when track is actively PLAYING
  useEffect(() => {
    if (!track || !isPlaying || room) return

    const runMatch = async () => {
      try {
        setError('')
        // Post presence only for actively playing listener
        await updateListeningPresence(track)
        // Check for song twins
        const found = await findMatch(track.id)
        if (found) {
          setRoom(found)
        }
      } catch (e) {
        console.error('[Auto Match] Error:', e)
      }
    }

    // Run matching immediately
    runMatch()

    // Poll matching state every 8 seconds while playing
    const interval = setInterval(runMatch, 8000)

    return () => clearInterval(interval)
  }, [track, isPlaying, room])

  return { track, setTrack, isPlaying, setIsPlaying, room, setRoom, error, online }
}

