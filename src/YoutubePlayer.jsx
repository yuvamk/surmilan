import { useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Search, X, AlertCircle, RefreshCw } from 'lucide-react'
import { loadYoutubeSDK, searchYoutube, getRecommendations, resolveYoutubeVideoId, LOFI_STATIONS } from './lib/youtubePlayer'

const DEMO = {
  id: 'dQw4w9WgXcQ',
  title: 'Iktara',
  artist: 'Amit Trivedi · Kavita Seth',
  normalizedKey: 'iktara|amit trivedi kavita seth',
  art: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=300&q=85',
  duration_ms: 240000,
}

function fmt(ms) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function YoutubePlayer({ onTrackChange, progressRef, forcePause, onForcePauseCleared }) {
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
  const audioPlayerRef = useRef(null)
  const progressIntervalRef = useRef(null)
  const isPlayingStartedRef = useRef(false)
  const iframeContainerId = 'yt-player-iframe'

  const isAudioStream = Boolean(activeTrack.streamUrl || (activeTrack.previewUrl && !activeTrack.id))

  // Persist state in localStorage on changes
  useEffect(() => {
    localStorage.setItem('sur-milan-active-track', JSON.stringify(activeTrack))
  }, [activeTrack])

  useEffect(() => {
    localStorage.setItem('sur-milan-progress', progress.toString())
    if (progressRef) {
      progressRef.current = progress
    }
  }, [progress])

  useEffect(() => {
    localStorage.setItem('sur-milan-duration', duration.toString())
  }, [duration])

  useEffect(() => {
    localStorage.setItem('sur-milan-history', JSON.stringify(history))
  }, [history])

  // Handle external take-over pause trigger
  useEffect(() => {
    if (forcePause) {
      if (isAudioStream) {
        const audio = audioPlayerRef.current
        if (audio) audio.pause()
      } else {
        if (playerRef.current) {
          try {
            playerRef.current.pauseVideo()
          } catch {}
        }
      }
      setIsPaused(true)
      onForcePauseCleared?.()
    }
  }, [forcePause])

  // Initialize YT Player on mount and activeTrack changes
  useEffect(() => {
    if (isAudioStream) return // Skip YT initialization for audio streams

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
          // Start exactly at the activeTrack's progress_ms if it exists, otherwise the local progress
          start: Math.floor((activeTrack.progress_ms || progress) / 1000)
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
    getRecommendations(activeTrack.normalizedKey, activeTrack.title, activeTrack.artist).then((recs) => {
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

  // HTML5 Audio Player logic
  useEffect(() => {
    if (!isAudioStream) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause()
        audioPlayerRef.current.src = ''
      }
      return
    }

    // Stop YouTube player if active
    if (playerRef.current) {
      try {
        playerRef.current.pauseVideo()
      } catch {}
    }

    let audio = audioPlayerRef.current
    if (!audio) {
      audio = new Audio()
      audioPlayerRef.current = audio
    }

    audio.src = activeTrack.streamUrl || activeTrack.previewUrl
    audio.preload = 'auto'

    // Set duration
    if (activeTrack.streamUrl) {
      setDuration(999999999) // Infinite for live stream
    } else {
      setDuration(activeTrack.duration_ms || 240000)
    }

    // Seek to handover offset if specified
    if (!activeTrack.streamUrl && activeTrack.progress_ms) {
      audio.currentTime = activeTrack.progress_ms / 1000
    }

    const onPlay = () => {
      setIsPaused(false)
      startProgressTicker()
    }

    const onPause = () => {
      setIsPaused(true)
      stopProgressTicker()
    }

    const onEnded = async () => {
      setIsPaused(true)
      stopProgressTicker()
      await playNextSuggested()
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)

    if (!isPaused) {
      audio.play().catch(err => {
        console.warn('[HTML5 Audio] Play failed:', err)
        setIsPaused(true)
      })
    } else {
      audio.pause()
    }

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [activeTrack.id, activeTrack.streamUrl, activeTrack.previewUrl])

  // Propagate track and playback state change to main app (for matching logic)
  useEffect(() => {
    onTrackChange?.(activeTrack, !isPaused)
  }, [activeTrack, isPaused])

  // Progress ticker functions
  const startProgressTicker = () => {
    stopProgressTicker()
    progressIntervalRef.current = setInterval(() => {
      if (isAudioStream) {
        const audio = audioPlayerRef.current
        if (audio && !activeTrack.streamUrl) {
          setProgress(audio.currentTime * 1000)
        } else if (activeTrack.streamUrl) {
          setProgress(p => p + 500)
        }
      } else {
        if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
          const timeMs = playerRef.current.getCurrentTime() * 1000
          setProgress(timeMs)
        }
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
      handlePlaySong(nextSong)
    } else {
      // If queue is completely dry, query new recommendations for current artist to keep playing
      const freshRecs = await getRecommendations(activeTrack.normalizedKey, activeTrack.title, activeTrack.artist)
      if (freshRecs.length > 0) {
        const nextSong = freshRecs[0]
        setHistory(prev => [...prev, activeTrack])
        setQueue(freshRecs.slice(1))
        handlePlaySong(nextSong)
      }
    }
  }

  // Play previous track from history
  const handlePrev = () => {
    if (history.length > 0) {
      const prevSong = history[history.length - 1]
      setHistory(prev => prev.slice(0, -1))
      setQueue(prev => [activeTrack, ...prev])
      handlePlaySong(prevSong)
    }
  }

  // Skip to next song manually
  const handleNext = () => {
    playNextSuggested()
  }

  // Toggle play/pause state
  const handleToggle = () => {
    if (isAudioStream) {
      const audio = audioPlayerRef.current
      if (audio) {
        if (isPaused) {
          audio.play().catch(() => setIsPaused(true))
          setIsPaused(false)
        } else {
          audio.pause()
          setIsPaused(true)
        }
      }
    } else {
      if (!playerRef.current) return
      if (isPaused) {
        playerRef.current.playVideo()
        setIsPaused(false)
      } else {
        playerRef.current.pauseVideo()
        setIsPaused(true)
      }
    }
  }

  // Seek callback
  const handleSeek = e => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = Math.floor(((e.clientX - rect.left) / rect.width) * duration)
    setProgress(pos)

    if (isAudioStream) {
      const audio = audioPlayerRef.current
      if (audio && !activeTrack.streamUrl) {
        audio.currentTime = pos / 1000
      }
    } else {
      if (playerRef.current) {
        playerRef.current.seekTo(pos / 1000, true)
      }
    }
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

  const handlePlaySong = async (song) => {
    let resolvedSong = { ...song }

    // If it's a standard song with no YouTube ID (from iTunes fallback), resolve it
    if (resolvedSong.id === null && !resolvedSong.streamUrl) {
      setSearching(true)
      setSearchError('Finding video on YouTube...')
      try {
        const videoId = await resolveYoutubeVideoId(song.title, song.artist, song.normalizedKey)
        resolvedSong.id = videoId
        setSearchError('')
      } catch (err) {
        setSearching(false)
        setSearchError('Connection busy, please try another song.')
        return
      }
      setSearching(false)
    }

    setHistory(prev => [...prev, activeTrack])
    setActiveTrack(resolvedSong)
    setIsPaused(false)
    setProgress(song.progress_ms || 0)
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
            <div className="search-results">
              <div className="search-status hint" style={{ borderBottom: '1px solid #eef2e8', paddingBottom: '12px', marginBottom: '8px' }}>
                Featured Lofi FM Stations (Quota-Free Matching):
              </div>
              {LOFI_STATIONS.map(station => (
                <button key={station.id} className="search-result" onClick={() => handlePlaySong(station)}>
                  <img src={station.art} alt="" />
                  <div className="sr-info">
                    <strong>{station.title}</strong>
                    <span>{station.artist} (Live)</span>
                  </div>
                  <span className="sr-duration" style={{ color: '#688c58', fontWeight: 'bold' }}>LIVE</span>
                </button>
              ))}
            </div>
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
                <button key={t.id || t.itunesId} className="search-result" onClick={() => handlePlaySong(t)}>
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
          <span className="np-time">{activeTrack.streamUrl ? 'LIVE' : fmt(progress)}</span>
          <div className="np-seek" role="slider" aria-label="Song progress" onClick={handleSeek}>
            <div className="np-fill" style={{ width: `${pct}%` }}/>
            <div className="np-thumb" style={{ left: `${pct}%` }}/>
          </div>
          <span className="np-time np-time-end">{activeTrack.streamUrl ? '∞' : fmt(duration)}</span>
        </div>
      </section>
      
      {/* Credits below the player */}
      <div className="player-credits">
        Build by Yuvam · <a href="mailto:yuvamk6@gmail.com" style={{ color: 'inherit', textDecoration: 'underline' }}>yuvamk6@gmail.com</a>
      </div>
    </div>
  )
}
export default YoutubePlayer
