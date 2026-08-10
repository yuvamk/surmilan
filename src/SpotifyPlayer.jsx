import { useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Search, X, AlertCircle, RefreshCw } from 'lucide-react'
import { initSpotifyPlayer, disconnectPlayer, searchTracks, apiPlay, apiNext, apiPrev, apiSeek, getDeviceId } from './lib/spotifyPlayer'

const DEMO = {
  title: 'Iktara',
  artist: 'Amit Trivedi · Kavita Seth',
  art: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=300&q=85',
}

function fmt(ms) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function SpotifyPlayer({ session, onTrackChange }) {
  const [isPaused, setIsPaused]       = useState(true)
  const [progress, setProgress]       = useState(0)
  const [duration, setDuration]       = useState(0)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [search, setSearch]           = useState('')
  const [results, setResults]         = useState([])
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching]     = useState(false)
  const [showSearch, setShowSearch]   = useState(false)
  const [sdkReady, setSdkReady]       = useState(false)
  const [sdkError, setSdkError]       = useState('')
  const playerRef  = useRef(null)
  const progressRef = useRef(0)
  const token = session?.provider_token

  // ── Spotify Web Playback SDK ──────────────────────────────────────────────
  useEffect(() => {
    if (!token) return
    let alive = true
    console.log('[SpotifyPlayer] Initialising SDK, token prefix:', token.slice(0, 12))
    initSpotifyPlayer(token, {
      onStateChange: state => {
        if (!state || !alive) return
        setIsPaused(state.paused)
        setDuration(state.duration)
        progressRef.current = state.position
        setProgress(state.position)
        const t = state.track_window?.current_track
        if (t) {
          const track = { id: t.id, title: t.name, artist: t.artists.map(a => a.name).join(' · '), art: t.album.images[1]?.url || t.album.images[0]?.url }
          setCurrentTrack(track)
          onTrackChange?.(track)
        }
      },
      onReady: () => { if (alive) { setSdkReady(true); setSdkError('') } },
      onError: msg => { if (alive) setSdkError(msg) },
    }).then(p => { if (alive && p) playerRef.current = p })
    return () => { alive = false; disconnectPlayer() }
  }, [token])

  // ── Progress ticker ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isPaused) return
    const id = setInterval(() => {
      progressRef.current = Math.min(progressRef.current + 500, duration)
      setProgress(progressRef.current)
    }, 500)
    return () => clearInterval(id)
  }, [isPaused, duration])

  // ── Search ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!search.trim()) { setResults([]); setSearchError(''); return }
    if (!token) { setSearchError('Connect Spotify first to search songs.'); setResults([]); return }

    setSearching(true)
    setSearchError('')
    const id = setTimeout(async () => {
      const { tracks, error } = await searchTracks(search, token)
      setSearching(false)
      if (error) {
        if (error === 'no_token') setSearchError('Not connected — click Connect Spotify.')
        else setSearchError(`Search failed: ${error}`)
        setResults([])
      } else {
        setResults(tracks)
        if (!tracks.length) setSearchError('No songs found. Try a different name.')
      }
    }, 380)
    return () => { clearTimeout(id); setSearching(false) }
  }, [search, token])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSeek = async e => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = Math.floor(((e.clientX - rect.left) / rect.width) * duration)
    progressRef.current = pos
    setProgress(pos)
    if (playerRef.current) playerRef.current.seek(pos)
    else await apiSeek(pos, token)
  }

  const handlePlayResult = async t => {
    try {
      await apiPlay({ context_uri: t.album.uri, offset: { uri: t.uri } }, getDeviceId(), token)
      setSearch(''); setResults([]); setShowSearch(false); setSearchError('')
    } catch (e) {
      setSearchError('Could not play — is Spotify Premium active?')
    }
  }

  const handlePrev   = () => playerRef.current ? playerRef.current.previousTrack() : apiPrev(token)
  const handleNext   = () => playerRef.current ? playerRef.current.nextTrack()     : apiNext(token)
  const handleToggle = () => playerRef.current?.togglePlay()

  const closeSearch = () => { setShowSearch(false); setSearch(''); setResults([]); setSearchError('') }

  const pct     = duration ? (progress / duration) * 100 : 0
  const display = currentTrack || DEMO

  return (
    <div className="player-wrap">

      {/* ── Search panel slides up above the pill ── */}
      {showSearch && (
        <div className="search-panel">
          <div className="search-head">
            <input className="search-input" id="search-input" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search Spotify — type a song or artist…" autoFocus />
            <button className="round-btn" onClick={closeSearch} aria-label="Close search">
              <X size={14}/>
            </button>
          </div>

          {/* Token status badge */}
          {!token && (
            <div className="search-status error">
              <AlertCircle size={13}/> Not connected to Spotify — click <strong>Connect Spotify</strong> on the page first.
            </div>
          )}
          {token && !searching && !searchError && !results.length && !search.trim() && (
            <div className="search-status hint">Start typing to search real Spotify tracks…</div>
          )}

          {/* Loading */}
          {searching && (
            <div className="search-status hint"><RefreshCw size={12} className="spin"/> Searching…</div>
          )}

          {/* Error */}
          {searchError && !searching && (
            <div className="search-status error"><AlertCircle size={13}/> {searchError}</div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div className="search-results" id="search-results">
              {results.map(t => (
                <button key={t.id} className="search-result" onClick={() => handlePlayResult(t)}>
                  <img src={t.album.images[2]?.url || t.album.images[0]?.url} alt="" />
                  <div className="sr-info">
                    <strong>{t.name}</strong>
                    <span>{t.artists.map(a => a.name).join(', ')} · {t.album.name}</span>
                  </div>
                  <span className="sr-duration">{fmt(t.duration_ms)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Compact pill ── */}
      <section className="now-playing">

        <img src={display.art} alt="Album art" />

        <div className="track">
          <small>{sdkError ? '⚠ ' + (sdkError.includes('Premium') ? 'Premium needed' : 'SDK error') : 'NOW PLAYING'}</small>
          <strong>{display.title}</strong>
          <span>{display.artist}</span>
        </div>

        <div className="player-controls">
          <button className="round-btn" id="btn-prev" onClick={handlePrev} aria-label="Previous">
            <SkipBack size={14}/>
          </button>
          <button className={`round-btn play-btn${!sdkReady && token ? ' loading' : ''}`} id="btn-play"
            onClick={handleToggle} aria-label={isPaused ? 'Play' : 'Pause'}>
            {isPaused ? <Play size={15} fill="currentColor"/> : <Pause size={15} fill="currentColor"/>}
          </button>
          <button className="round-btn" id="btn-next" onClick={handleNext} aria-label="Next">
            <SkipForward size={14}/>
          </button>
        </div>

        {!isPaused && <div className="wave" aria-label="Playing"><b/><b/><b/><b/><b/><b/><b/></div>}

        <button className="round-btn" id="btn-search" onClick={() => setShowSearch(s => !s)} aria-label="Search songs">
          <Search size={15}/>
        </button>

        {/* Progress row with live timestamps */}
        <div className="np-progress-row">
          <span className="np-time">{fmt(progress)}</span>
          <div className="np-seek" id="seek-bar" role="slider" aria-label="Song progress" onClick={handleSeek}>
            <div className="np-fill" style={{ width: `${pct}%` }}/>
            <div className="np-thumb" style={{ left: `${pct}%` }}/>
          </div>
          <span className="np-time np-time-end">{fmt(duration)}</span>
        </div>

      </section>
    </div>
  )
}
