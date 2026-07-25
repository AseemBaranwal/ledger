import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
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
