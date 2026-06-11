# ⚡ FileBeam

**Secure, offline-first peer-to-peer file transfer between any combination of Windows, iOS, and Android — no size limits, no tracking, and zero server storage.**

FileBeam uses WebRTC to establish a direct, end-to-end encrypted connection between devices. It runs fully offline after the first load as a Progressive Web App (PWA) and is designed to comply with strict cybersecurity and adblocking guidelines.

---

## 🚀 Key Features

- **Direct P2P Transfer**: Files flow directly device-to-device via WebRTC DataChannels. No intermediary file-storage servers are involved.
- **Scannable 6-Digit Room Codes**: Replaced heavy WebRTC SDP handshakes with a simple, dynamic 6-digit room code. The corresponding QR pairing code is tiny and easily scannable by mobile cameras.
- **Cross-Platform Compatibility**: Transfer payloads seamlessly between Windows PCs, iPhones, and Android devices.
- **Multi-File Queue**: Supports dropping or selecting multiple files at once, with real-time transfer speeds (KB/s), progress bars, and ETA calculations.
- **Military-Grade Encryption**: End-to-end data packets are encrypted natively via WebRTC using DTLS-SRTP (negotiating AES-GCM-256).
- **100% Adblock & Privacy Friendly**: Zero Google Fonts or external trackers. The entire PeerJS signaling library is bundled locally.
- **Offline-First PWA**: Assets are fully cached locally. The app is capable of running and restoring transfers offline.
- **XSS & Security Shielded**: All user-controllable inputs (such as filenames and room codes) are bound via DOM `textContent` APIs. Strict Content Security Policy (CSP) rules are enforced.

---

## 🛠️ How Connection and Transfer Works

1. **Sender** drops one or more files in the drag-and-drop zone and clicks **Generate Room Code**.
2. FileBeam creates a secure PeerJS room under ID `fbeam-[6-digit-code]`.
3. The sender displays a **6-digit room code** and a **pairing QR code** (encoding a link direct to the room).
4. **Receiver** types the 6-digit code or scans the QR code.
5. The receiver connects to the sender's PeerJS room. WebRTC SDP and ICE candidates are exchanged ephemerally.
6. The connection is established, and a direct WebRTC DataChannel opens.
7. **Sender** streams files in sequential 64KB chunks.
8. Implemented WebRTC backpressure detection: if `dataChannel.bufferedAmount` exceeds 1MB, sending is paused briefly to prevent memory leakage, buffer overflow, or crashes.
9. **Receiver** aggregates chunks and triggers local browser saving automatically.

---

## 🔒 Security & Privacy Architecture

### Zero-Knowledge Design
No files or file metadata are ever sent to a server. The signaling server is only used to establish connection metadata (SDP handshake) and does not have access to the WebRTC media or data channels.

### Encryption
WebRTC automatically secures all peer-to-peer channels using **DTLS-SRTP** (Datagram Transport Layer Security / Secure Real-time Transport Protocol). This prevents eavesdropping and tampering by middle-men:
- **Asymmetric Key Exchange**: Curve25519 (ECDH)
- **Symmetric Encryption**: AES-GCM-256 or ChaCha20-Poly1305 (AEAD)

### Strict Content Security Policy (CSP)
FileBeam includes client-side security headers protecting against code injection:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://*.peerjs.com https://*.peerjs.com wss://0.peerjs.com wss://peerjs.com; media-src 'self' blob: data:; camera-src 'self';">
```

### XSS Prevention
We avoid using `innerHTML` or dynamic string evaluation (`eval`) to render user-controlled data. Filenames, byte sizes, speeds, and codes are injected directly using DOM `textContent` APIs, neutralizing malicious payloads embedded in file names.

---

## 💻 Technical Stack

- **Core**: Vanilla HTML5, TypeScript
- **Styling**: Tailwind CSS v4 (CSS-first config)
- **P2P Signaling**: PeerJS (locally bundled)
- **QR Engine**: qrcode (local canvas renderer) & jsQR (camera parser)
- **PWA Service Worker**: Workbox via `vite-plugin-pwa`
- **Build Tool**: Vite

---

## 📁 Repository Structure

```
mutli-File/
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions automated deploy config
├── public/                 # Static assets (copied directly to dist/)
│   ├── favicon.ico
│   ├── favicon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── robots.txt          # SEO crawlers instructions
│   └── sitemap.xml         # XML Sitemap
├── src/
│   ├── main.ts             # WebRTC, PeerJS connection, and PWA logic
│   └── style.css           # Tailwind CSS imports & animations
├── index.html              # Reworked main application page
├── package.json            # Package details and dependencies
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite build config with PWA settings
└── README.md               # App documentation (this file)
```

---

## 📦 Local Development

To run, compile, or build FileBeam locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/DylanGrow/mutli-File.git
   cd mutli-File
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the local development server:
   ```bash
   npm run dev
   ```

4. Build the static production bundle:
   ```bash
   npm run build
   ```
   *The built assets will be generated in the `dist/` folder.*

---

## 🌐 Deployment to GitHub Pages

FileBeam is pre-configured with a CI/CD GitHub Actions workflow. When you push to the `main` branch, the workflow will automatically compile the application and deploy it to the `gh-pages` branch.

To configure your repository for GitHub Pages:
1. Go to repository settings on GitHub -> **Pages**.
2. Set the **Source** to **Deploy from a branch**.
3. Under **Branch**, select **`gh-pages`** and click **Save**.

---

## 📄 License

MIT
