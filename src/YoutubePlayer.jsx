import { useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Search, X, AlertCircle, RefreshCw } from 'lucide-react'
import { loadYoutubeSDK, searchYoutube, getRecommendations } from './lib/youtubePlayer'

const DEMO = {
  id: 'dQw4w9WgXcQ',
  title: 'Iktara',
  artist: 'Amit Trivedi · Kavita Seth',
  art: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=300&q=85',
  duration_ms: 240000,
}

function fmt(ms) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function YoutubePlayer({ onTrackChange }) {
  // Load track and history state from localStorage to prevent resetting on page reload
  const [activeTrack, setActiveTrack] = useState(() => {
    const stored = localStorage.getItem('sur-milan-active-track')
    return stored ? JSON.parse(stored) : DEMO
  })
  
  // Default to paused on refresh to comply with browser autoplay security policies
  const [isPaused, setIsPaused] = useState(true)
  
  const [progress, setProgress] = useState(() => {
    const stored = localStorage.getItem('sur-milan-progress')
    return stored ? Number(stored) : 0
  })
  
  const [duration, setDuration] = useState(() => {
    const stored = localStorage.getItem('sur-milan-duration')
    return stored ? Number(stored) : DEMO.duration_ms
  })
  
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  
  const [queue, setQueue] = useState([])
  const [history, setHistory] = useState(() => {
    const stored = localStorage.getItem('sur-milan-history')
    return stored ? JSON.parse(stored) : []
  })

  const playerRef = useRef(null)
  const progressIntervalRef = useRef(null)
  const isPlayingStartedRef = useRef(false)
  const iframeContainerId = 'yt-player-iframe'

  // Persist state in localStorage on changes
  useEffect(() => {
    localStorage.setItem('sur-milan-active-track', JSON.stringify(activeTrack))
  }, [activeTrack])

  useEffect(() => {
    localStorage.setItem('sur-milan-progress', progress.toString())
  }, [progress])

  useEffect(() => {
    localStorage.setItem('sur-milan-duration', duration.toString())
  }, [duration])

  useEffect(() => {
    localStorage.setItem('sur-milan-history', JSON.stringify(history))
  }, [history])

  // Initialize YT Player on mount and activeTrack changes
  useEffect(() => {
    let active = true
    let ytPlayer = null

    loadYoutubeSDK().then((YT) => {
      if (!active) return

      // Destroy old player before building new one
      if (playerRef.current) {
        try {
          playerRef.current.destroy()
        } catch (e) {
          console.warn('[YT Player] Destroy error:', e)
        }
        playerRef.current = null
      }

      ytPlayer = new YT.Player(iframeContainerId, {
        height: '0',
        width: '0',
        videoId: activeTrack.id,
        playerVars: {
          autoplay: isPaused ? 0 : 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          showinfo: 0,
          modestbranding: 1,
          origin: window.location.origin,
          // Start exactly at the saved progress offset (converted to seconds)
          start: Math.floor(progress / 1000)
        },
        events: {
          onReady: () => {
            if (!active) return
            playerRef.current = ytPlayer
            const trackDur = ytPlayer.getDuration() * 1000
            if (trackDur > 0) setDuration(trackDur)
            
            if (!isPaused) {
              ytPlayer.playVideo()
            }
          },
          onStateChange: async (event) => {
            if (!active) return
            const state = event.data

            if (state === YT.PlayerState.PLAYING) {
              setIsPaused(false)
              setDuration(ytPlayer.getDuration() * 1000)
              isPlayingStartedRef.current = true
              startProgressTicker()
            } else if (state === YT.PlayerState.PAUSED) {
              setIsPaused(true)
              stopProgressTicker()
            } else if (state === YT.PlayerState.ENDED) {
              setIsPaused(true)
              stopProgressTicker()
              await playNextSuggested()
            }
          },
        },
      })
    })

    // Fetch related recommendations to build autoplay list
    getRecommendations(activeTrack.id, activeTrack.title, activeTrack.artist).then((recs) => {
      if (active) {
        if (recs.length > 0) {
          setQueue(recs)
        } else {
          // If recommendation endpoint fails, build a fallback queue using the search results list
          console.log('[Autoplay] Recommendation list empty, using results fallback queue')
          const searchBackup = results.filter(t => t.id !== activeTrack.id)
          if (searchBackup.length > 0) setQueue(searchBackup)
        }
      }
    })

    return () => {
      active = false
      stopProgressTicker()
      if (ytPlayer) {
        try {
          ytPlayer.destroy()
        } catch {}
      }
    }
  }, [activeTrack.id])

  // Propagate track change to main app (for matching logic)
  useEffect(() => {
    onTrackChange?.(activeTrack)
  }, [activeTrack])

  // Progress ticker functions
  const startProgressTicker = () => {
    stopProgressTicker()
    progressIntervalRef.current = setInterval(() => {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        const timeMs = playerRef.current.getCurrentTime() * 1000
        setProgress(timeMs)
      }
    }, 500)
  }

  const stopProgressTicker = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current)
      progressIntervalRef.current = null
    }
  }

  // Autoplay next track from queue
  const playNextSuggested = async () => {
    if (queue.length > 0) {
      const nextSong = queue[0]
      setHistory(prev => [...prev, activeTrack])
      setQueue(prev => prev.slice(1))
      setActiveTrack(nextSong)
      setIsPaused(false)
      setProgress(0)
    } else {
      // If queue is completely dry, query new recommendations for current artist to keep playing
      const freshRecs = await getRecommendations(activeTrack.id, activeTrack.title, activeTrack.artist)
      if (freshRecs.length > 0) {
        const nextSong = freshRecs[0]
        setHistory(prev => [...prev, activeTrack])
        setQueue(freshRecs.slice(1))
        setActiveTrack(nextSong)
        setIsPaused(false)
        setProgress(0)
      }
    }
  }

  // Play previous track from history
  const handlePrev = () => {
    if (history.length > 0) {
      const prevSong = history[history.length - 1]
      setHistory(prev => prev.slice(0, -1))
      setQueue(prev => [activeTrack, ...prev])
      setActiveTrack(prevSong)
      setIsPaused(false)
      setProgress(0)
    }
  }

  // Skip to next song manually
  const handleNext = () => {
    playNextSuggested()
  }

  // Toggle play/pause state
  const handleToggle = () => {
    if (!playerRef.current) return
    if (isPaused) {
      playerRef.current.playVideo()
      setIsPaused(false)
    } else {
      playerRef.current.pauseVideo()
      setIsPaused(true)
    }
  }

  // Seek callback
  const handleSeek = e => {
    if (!duration || !playerRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = Math.floor(((e.clientX - rect.left) / rect.width) * duration)
    setProgress(pos)
    playerRef.current.seekTo(pos / 1000, true)
  }

  // Search logic
  useEffect(() => {
    if (!search.trim()) {
      setResults([])
      setSearchError('')
      return
    }

    setSearching(true)
    setSearchError('')
    const delayId = setTimeout(async () => {
      try {
        const tracks = await searchYoutube(search)
        setSearching(false)
        if (tracks.length > 0) {
          setResults(tracks)
        } else {
          setSearchError('No songs found. Try a different title.')
        }
      } catch (err) {
        setSearching(false)
        setSearchError('Search failed. Check your internet connection.')
      }
    }, 250)

    return () => {
      clearTimeout(delayId)
      setSearching(false)
    }
  }, [search])

  const handlePlaySong = (song) => {
    setHistory(prev => [...prev, activeTrack])
    setActiveTrack(song)
    setIsPaused(false)
    setProgress(0)
    setShowSearch(false)
    setSearch('')
    setResults([])
  }

  const closeSearch = () => {
    setShowSearch(false)
    setSearch('')
    setResults([])
    setSearchError('')
  }

  const pct = duration ? (progress / duration) * 100 : 0

  return (
    <div className="player-wrap">
      {/* Hidden container where YT Player builds its iframe */}
      <div id={iframeContainerId} style={{ display: 'none' }} />

      {/* ── Search panel slides up above the pill ── */}
      {showSearch && (
        <div className="search-panel">
          <div className="search-head">
            <input className="search-input" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search music to listen..." autoFocus />
            <button className="round-btn" onClick={closeSearch} aria-label="Close search">
              <X size={14}/>
            </button>
          </div>

          {!searching && !searchError && !results.length && !search.trim() && (
            <div className="search-status hint">Type a track name to search and match…</div>
          )}

          {searching && (
            <div className="search-status hint"><RefreshCw size={12} className="spin"/> Searching YouTube…</div>
          )}

          {searchError && !searching && (
            <div className="search-status error"><AlertCircle size={13}/> {searchError}</div>
          )}

          {results.length > 0 && (
            <div className="search-results">
              {results.map(t => (
                <button key={t.id} className="search-result" onClick={() => handlePlaySong(t)}>
                  <img src={t.art || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=80&q=80'} alt="" />
                  <div className="sr-info">
                    <strong>{t.name || t.title}</strong>
                    <span>{t.artist}</span>
                  </div>
                  <span className="sr-duration">{fmt(t.duration_ms)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Compact now playing pill ── */}
      <section className="now-playing">
        <img src={activeTrack.art || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=80&q=80'} alt="Album art" />

        <div className="track">
          <small>NOW PLAYING</small>
          <strong>{activeTrack.title}</strong>
          <span>{activeTrack.artist}</span>
        </div>

        <div className="player-controls">
          <button className="round-btn" onClick={handlePrev} disabled={history.length === 0} aria-label="Previous">
            <SkipBack size={14}/>
          </button>
          <button className="round-btn play-btn" onClick={handleToggle} aria-label={isPaused ? 'Play' : 'Pause'}>
            {isPaused ? <Play size={15} fill="currentColor"/> : <Pause size={15} fill="currentColor"/>}
          </button>
          <button className="round-btn" onClick={handleNext} disabled={queue.length === 0 && history.length === 0} aria-label="Next">
            <SkipForward size={14}/>
          </button>
        </div>

        {!isPaused && <div className="wave" aria-label="Playing"><b/><b/><b/><b/><b/><b/><b/></div>}

        <button className="round-btn" onClick={() => setShowSearch(s => !s)} aria-label="Search songs">
          <Search size={15}/>
        </button>

        {/* Progress row with live timestamps */}
        <div className="np-progress-row">
          <span className="np-time">{fmt(progress)}</span>
          <div className="np-seek" role="slider" aria-label="Song progress" onClick={handleSeek}>
            <div className="np-fill" style={{ width: `${pct}%` }}/>
            <div className="np-thumb" style={{ left: `${pct}%` }}/>
          </div>
          <span className="np-time np-time-end">{fmt(duration)}</span>
        </div>
      </section>
    </div>
  )
}
export default YoutubePlayer
