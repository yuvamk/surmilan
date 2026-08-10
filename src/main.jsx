import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { Send, Sparkles, X, ArrowUpRight, Flag, LogOut, Circle, CircleHelp } from 'lucide-react'
import { leaveRoom, reportRoom, reserveNextMatch, supabase, getOrCreateGuestUser } from './lib/supabase'
import { useMusicMatch } from './useMusicMatch'
import { YoutubePlayer } from './YoutubePlayer'
import './styles.css'

const SHAYARI = 'तेरे सुरों में कहीं, मेरा दिल भी मुस्कुराता है।'

function App() {
  const music = useMusicMatch()
  const [showSetup, setShowSetup] = useState(false)
  const [nextRoom, setNextRoom] = useState(null)

  const reserveNext = async (room) => {
    try {
      if (!music.track) return
      const next = await reserveNextMatch(room.id, music.track.id)
      if (next) setNextRoom(next)
    } catch { /* silently fall back to matching queue */ }
  }

  return (
    <main className="stage">
      <div className="wallpaper" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="Sur Milan home">
          <span className="brand-mark">स</span>
          <span>sur<span>milan</span></span>
        </a>
        <div className="top-actions">
          <span className="presence"><i /> {music.online || '—'} listening now</span>
          <button className="setup-link" onClick={() => setShowSetup(true)}><CircleHelp size={16}/> Setup</button>
          <button className="join-btn" onClick={music.match}>
            Find your song twin <ArrowUpRight size={15}/>
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow"><Sparkles size={14}/> a little magic in every melody</p>
        <h1>Meet in the<br/><em>same song.</em></h1>
        <p className="shayari">{SHAYARI}</p>
        <p className="translation">Somewhere in your music, my heart begins to smile.</p>
        <div className="connect-row">
          <button className="join-btn hero-match" onClick={music.match}>
            Find your song twin <ArrowUpRight size={15}/>
          </button>
        </div>
        <p className="hint">{music.error || 'Search for any song in the player below, play it, and find your twin.'}</p>
      </section>

      <YoutubePlayer onTrackChange={t => music.setTrack(t)} />

      <footer>
        <span>Made for the songs you cannot explain.</span>
        <span>© 2026 Sur Milan</span>
      </footer>

      {music.room && (
        <ChatOverlay
          room={music.room}
          track={music.track}
          reserveNext={reserveNext}
          nextReady={Boolean(nextRoom)}
          close={() => { music.setRoom(null); setNextRoom(null) }}
          end={() => { music.setRoom(nextRoom); setNextRoom(null) }}
        />
      )}
      {showSetup && <SetupOverlay close={() => setShowSetup(false)} />}
    </main>
  )
}

function SetupOverlay({ close }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="YouTube setup">
      <div className="setup-card">
        <button className="close-setup" onClick={close}><X size={20}/></button>
        <p className="eyebrow">HOW IT WORKS</p>
        <h2>Search, Play &<br/>Meet stragers</h2>
        <ol>
          <li>Type any track name or artist into the player's search bar.</li>
          <li>Click to play the song. Our player stream the full audio directly.</li>
          <li>Click the <b>Find your song twin</b> button to start matching.</li>
          <li>If another user on the site is listening to the same song, you'll be paired in a private 6-minute chat room.</li>
        </ol>
        <p className="setup-note">No Spotify account, YouTube login, or whitelist registration is required. Anyone can listen and chat instantly.</p>
        <button className="join-btn" onClick={close}>Let's go <ArrowUpRight size={15}/></button>
      </div>
    </div>
  )
}

function ChatOverlay({ room, track, reserveNext, nextReady, close, end }) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const [seconds, setSeconds] = useState(360)
  const [myId, setMyId] = useState('')
  const reserved = useState(false)

  useEffect(() => {
    const roomEnd = new Date(room.expires_at).getTime()
    const tick = () => {
      const left = Math.max(0, Math.ceil((roomEnd - Date.now()) / 1000))
      setSeconds(left)
      if (left <= 15 && !reserved[0]) { reserved[1](true); reserveNext(room) }
      if (!left) { leaveRoom(room.id); end() }
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [room.id])

  useEffect(() => {
    if (!supabase) return
    
    // Support guest user identification
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setMyId(data.user.id)
      } else {
        const guest = getOrCreateGuestUser()
        setMyId(guest.id)
      }
    })

    supabase.from('room_messages').select('*').eq('room_id', room.id).order('created_at')
      .then(({ data }) => setMessages(data || []))

    const channel = supabase.channel(`room:${room.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${room.id}` },
        payload => setMessages(m => [...m, payload.new]))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [room.id])

  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  const send = async e => {
    e.preventDefault()
    const body = message.trim()
    if (!body || !supabase) return
    setMessage('')
    await supabase.from('room_messages').insert({ room_id: room.id, author_id: myId, body })
  }

  const displayTrack = track || { title: 'Unknown', artist: 'Unknown', art: '' }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Song twin chat">
      <div className="chat-card">
        <div className="chat-head">
          <div><span className="live-dot"/> YOUR SONG TWIN <small>· matched now</small></div>
          <button onClick={close} aria-label="Close chat"><X size={20}/></button>
        </div>
        <div className="match-song">
          <img src={displayTrack.art} alt=""/>
          <div>
            <small>YOU BOTH ARE LISTENING TO</small>
            <b>{displayTrack.title}</b>
            <span>{displayTrack.artist}</span>
          </div>
          <div className="countdown">
            <span>{time}</span>
            <small>TIME TO CONNECT</small>
          </div>
        </div>
        <div className="notice">
          <Sparkles size={14}/> {nextReady
            ? 'Your next song twin is ready. The new room opens at 00:00.'
            : seconds <= 15 ? 'Finding your next song twin…'
            : 'This room is private and disappears when the song ends.'}
        </div>
        <div className="messages">
          {messages.map(m => (
            <div className={`bubble ${m.author_id === myId ? 'me' : 'them'}`} key={m.id}>{m.body}</div>
          ))}
        </div>
        <form className="composer" onSubmit={send}>
          <input value={message} onChange={e => setMessage(e.target.value)} placeholder="Say something real…" maxLength="500"/>
          <button aria-label="Send"><Send size={17}/></button>
        </form>
        <div className="chat-foot">
          <span><Circle size={8} fill="currentColor"/> Twin is here</span>
          <button onClick={() => reportRoom(room.id)}><Flag size={14}/> Report</button>
          <button onClick={() => { leaveRoom(room.id); close() }}><LogOut size={14}/> Leave room</button>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
