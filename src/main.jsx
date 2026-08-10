import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState } from 'react'
import { Send, Sparkles, X, ArrowUpRight, Flag, LogOut, Circle, CircleHelp } from 'lucide-react'
import { getSpotifyTrack, leaveRoom, reportRoom, reserveNextMatch, supabase } from './lib/supabase'
import { useMusicMatch } from './useMusicMatch'
import { SpotifyPlayer } from './SpotifyPlayer'
import './styles.css'

const SHAYARI = 'तेरे सुरों में कहीं, मेरा दिल भी मुस्कुराता है।'

function App() {
  const music = useMusicMatch()
  const [showSetup, setShowSetup] = useState(false)
  const [nextRoom, setNextRoom] = useState(null)
  const reserveNext = async (room) => {
    try {
      const { data } = await supabase.auth.getSession()
      const track = await getSpotifyTrack(data.session?.provider_token)
      if (!track) return
      const next = await reserveNextMatch(room.id, track.id)
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
            {music.session ? 'Find your song twin' : 'Connect to match'} <ArrowUpRight size={15}/>
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow"><Sparkles size={14}/> a little magic in every melody</p>
        <h1>Meet in the<br/><em>same song.</em></h1>
        <p className="shayari">{SHAYARI}</p>
        <p className="translation">Somewhere in your music, my heart begins to smile.</p>
        <div className="connect-row">
          <button className="service" id="btn-connect-spotify" onClick={music.connect}>
            <span className="spotify-dot">●</span>
            {music.session ? 'Spotify connected ✓' : 'Connect Spotify'}
          </button>
        </div>
        <p className="hint">{music.error || 'We find someone listening to the very same feeling.'}</p>
      </section>

      <SpotifyPlayer session={music.session} onTrackChange={t => music.setTrack(t)} />

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
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Spotify setup">
      <div className="setup-card">
        <button className="close-setup" onClick={close}><X size={20}/></button>
        <p className="eyebrow">ONE-TIME SETUP</p>
        <h2>Connect Spotify<br/>to Sur Milan</h2>
        <ol>
          <li>Create an app at Spotify for Developers.</li>
          <li>In Spotify, add the Supabase callback URL shown under Supabase → Auth → Spotify.</li>
          <li>Copy its Client ID and Client Secret into Supabase → Authentication → Providers → Spotify.</li>
          <li>In Supabase URL settings, add this site URL. For local testing use <code>http://localhost:5173</code>.</li>
          <li>Run the database script in <code>supabase/schema.sql</code>, then press <b>Connect Spotify</b>.</li>
        </ol>
        <p className="setup-note">Your Spotify secret belongs only in Supabase. Never paste it into this website's code or .env file.</p>
        <button className="join-btn" onClick={close}>I've configured it <ArrowUpRight size={15}/></button>
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
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id || ''))
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
