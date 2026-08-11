import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handler as resolveHandler } from './api/resolve.js'
import { handler as recommendHandler } from './api/recommend.js'

function localApiPlugin() {
  return {
    name: 'local-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url.startsWith('/api/resolve')) {
          res.status = (code) => { res.statusCode = code; return res }
          res.json = (data) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          }
          
          let body = ''
          await new Promise((resolve) => {
            req.on('data', chunk => body += chunk)
            req.on('end', resolve)
          })
          
          req.body = body ? JSON.parse(body) : {}
          
          try {
            await resolveHandler(req, res)
          } catch (err) {
            console.error('[Local API Resolve] Error:', err)
            res.status(500).json({ error: err.message })
          }
        } else if (req.url.startsWith('/api/recommend')) {
          res.status = (code) => { res.statusCode = code; return res }
          res.json = (data) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          }
          
          const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
          req.query = Object.fromEntries(url.searchParams.entries())
          
          try {
            await recommendHandler(req, res)
          } catch (err) {
            console.error('[Local API Recommend] Error:', err)
            res.status(500).json({ error: err.message })
          }
        } else {
          next()
        }
      })
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL
  process.env.VITE_SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY
  process.env.VITE_YOUTUBE_API_KEY = env.VITE_YOUTUBE_API_KEY || env.YOUTUBE_API_KEY
  process.env.YOUTUBE_API_KEY = env.VITE_YOUTUBE_API_KEY || env.YOUTUBE_API_KEY

  return {
    plugins: [react(), localApiPlugin()],
    server: {
      host: true,
      port: 5173,
    },
  }
})

