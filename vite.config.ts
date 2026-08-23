import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  // `vercel dev` assigns a random port via $PORT for our vercel.json
  // devCommand ("npm run dev") and reverse-proxies its own port 3000
  // to whatever Vite actually binds to. Without reading $PORT here, Vite
  // always falls back to its hardcoded default (5173) regardless of what
  // vercel dev asked for, so the proxy forwards to a port nothing is
  // listening on and every request to localhost:3000 hangs/times out —
  // /api/* becomes completely unreachable locally. `npm run dev` on its
  // own (no vercel dev) is unaffected since $PORT is simply unset then.
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    // Lets `npm run dev` alone (plain Vite, no `vercel dev`) still reach
    // `/api/*` by forwarding to a `vercel dev` instance running separately
    // on 3000 — vercel.json's SPA rewrite (needed for production routing)
    // also mangles vercel dev's own dev-command asset serving for paths
    // like /src/main.tsx, so running the frontend through vercel dev's
    // proxy directly isn't reliable locally. This proxy only matters for
    // plain Vite; under vercel dev itself, /api/* never reaches Vite at
    // all since vercel dev intercepts it before proxying anything here.
    proxy: {
      // '/api/_lib/*' isn't a real endpoint — src/services/exerciseCatalog.ts
      // cross-imports api/_lib/stravaExerciseCatalog.ts and stravaMapping.ts
      // directly as plain source files (see CLAUDE.md). Without excluding
      // it, this rule forwards those imports to vercel dev too, which 503s
      // since no function lives at that path — silently breaking the whole
      // module graph (main.tsx fails to fetch since one of its transitive
      // imports 503s, with no console error to point at why).
      '/api': {
        target: 'http://localhost:3000',
        bypass(req) {
          if (req.url?.startsWith('/api/_lib/')) return req.url
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Ledger — Training Log',
        short_name: 'Ledger',
        description: 'One-handed training log for the gym',
        theme_color: '#14181D',
        background_color: '#14181D',
        display: 'standalone',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // CoachTab is lazy-loaded specifically so non-owner users never pay
        // for react-markdown — but without this, workbox precaches it into
        // every install regardless, silently defeating that split for
        // everyone but the owner. Excluded from precache; still fetched
        // normally (on-demand) for the owner when they open the Coach tab.
        globIgnores: ['**/CoachTab-*.js'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    rollupOptions: {
      output: {
        // react/react-dom/supabase-js make up the bulk of the main chunk
        // but change far less often than app code — without this they
        // shared one content hash with everything else, so every deploy
        // forced returning PWA users to re-fetch the whole chunk via the
        // service worker's precache diff, when only the app-code slice
        // had actually changed.
        manualChunks: {
          vendor: ['react', 'react-dom', '@supabase/supabase-js'],
        },
      },
    },
  }
})
