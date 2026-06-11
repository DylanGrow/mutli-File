import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      manifest: {
        name: 'FileBeam - Secure Peer-to-Peer File Transfer',
        short_name: 'FileBeam',
        description: 'Send files directly between devices over a shared network or the internet. No server storage, no size limits, secure and private.',
        theme_color: '#0a0a0f',
        background_color: '#0a0a0f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            // Cache local WebRTC / PeerJS signaling connection code or library if imported.
            // Vite bundles PeerJS, so it will be in the asset cache automatically!
            urlPattern: /^https:\/\/fonts\.googleapis\.com/,
            handler: 'NetworkOnly' // Disallow external fonts
          }
        ]
      }
    })
  ]
});
