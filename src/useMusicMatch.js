import { useEffect, useState, useRef } from 'react'
import { findMatch, supabase, updateListeningPresence, ensureAuth, getOrCreateGuestUser, fetchDevicePresence } from './lib/supabase'

export function useMusicMatch(progressRef) {
  const [track, setTrack] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [room, setRoom] = useState(null)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(0)

  // Device sync & Handover states
  const [handoverTrack, setHandoverTrack] = useState(null)
  const [forcePause, setForcePause] = useState(false)

  const [clientDeviceId] = useState(() => {
    let id = sessionStorage.getItem('sur-milan-client-device-id')
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem('sur-milan-client-device-id', id)
    }
    return id
  })

  // 1. Maintain lobby presence and count online listeners
  useEffect(() => {
    if (!supabase) return
    let channel
    
    ensureAuth().then(() => {
      channel = supabase.channel('sur-milan-lobby', { config: { presence: { key: crypto.randomUUID() } } })
        .on('presence', { event: 'sync' }, () => setOnline(Object.keys(channel.presenceState()).length))
        .subscribe(status => { if (status === 'SUBSCRIBED') channel.track({ online_at: new Date().toISOString() }) })
    })

    return () => { if (channel) supabase.removeChannel(channel) }
  }, [])

  // 2. Fully Automatic Matching & Device Handover Loop
  useEffect(() => {
    const runMatch = async () => {
      try {
        setError('')

        // Fetch current user details to check presence row
        const { data: { user } } = await supabase.auth.getUser()
        const userId = user ? user.id : getOrCreateGuestUser().id

        // A. Check for handover (from another active device)
        const activePresence = await fetchDevicePresence(userId)
        if (activePresence) {
          const isFresh = (Date.now() - new Date(activePresence.updated_at).getTime()) < 15000
          
          if (activePresence.device_id !== clientDeviceId && isFresh) {
            // Another device has active playback
            if (activePresence.is_playing) {
              setHandoverTrack({
                id: activePresence.track_id,
                title: activePresence.track_title,
                artist: activePresence.track_artist,
                art: activePresence.track_art,
                streamUrl: activePresence.stream_url,
                progress_ms: activePresence.progress_ms,
                device_id: activePresence.device_id
              })
              
              // If we are currently playing, but the database says a different device took over playing, we pause!
              if (isPlaying) {
                setForcePause(true)
                setIsPlaying(false)
              }
            } else {
              setHandoverTrack(null)
            }
          } else if (activePresence.device_id === clientDeviceId) {
            setHandoverTrack(null)
          }
        }

        // B. Post local presence (only if active track is playing)
        if (track && isPlaying && !room) {
          const prog = progressRef ? progressRef.current : 0
          await updateListeningPresence(track, prog, isPlaying, clientDeviceId)

          // C. Match listener
          const found = await findMatch(track)
          if (found) {
            setRoom(found)
          }
        }
      } catch (e) {
        console.error('[Auto Match / Handover] Error:', e)
      }
    }

    // Run matching loop immediately
    runMatch()

    // Poll matching state and handover status every 8 seconds
    const interval = setInterval(runMatch, 8000)

    return () => clearInterval(interval)
  }, [track, isPlaying, room, clientDeviceId])

  const clearForcePause = () => setForcePause(false)

  return { 
    track, 
    setTrack, 
    isPlaying, 
    setIsPlaying, 
    room, 
    setRoom, 
    error, 
    online,
    clientDeviceId,
    handoverTrack,
    setHandoverTrack,
    forcePause,
    clearForcePause
  }
}
