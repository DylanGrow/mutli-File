# ⚡ FileBeam

**Send files directly between Android and iOS — no internet, no cables, no accounts.**

FileBeam uses WebRTC to transfer files peer-to-peer over a shared local network. Nothing touches a server. Works as a PWA, installs to your home screen, and runs fully offline after the first visit.

---

## How it works

1. One phone creates a **WiFi hotspot**
2. The other phone connects to it
3. Both open the FileBeam URL in their browser
4. The sender picks a file and shows a **QR code**
5. The receiver scans it, shows their own QR code back
6. The sender scans that — connection established
7. File transfers **directly between devices**, no server involved

The pairing handshake is a standard WebRTC offer/answer exchange. Once both sides have scanned each other's QR codes, a direct data channel opens and the file flows over the local network at full WiFi speed.

---

## Features

- **Truly offline** — works with zero internet after first load
- **Cross-platform** — Android Chrome ↔ iOS Safari, any combination
- **No app install required** — runs in the browser; optionally installs as a PWA
- **No size limits** — files are streamed in chunks, not loaded into memory at once
- **Nothing stored** — files never leave your devices; no server, no logs
- **QR + text fallback** — if camera scanning fails, codes can be copied and pasted

---

## Setup

### Option 1 — Use the hosted version

Visit the GitHub Pages URL on both devices while you still have internet. The service worker caches everything. Then switch to hotspot — it works offline from there.

### Option 2 — Self-host

Clone the repo and drop the two files on any static host (including GitHub Pages):

```
index.html
sw.js
```

No build step. No dependencies to install. It's just HTML.

```bash
git clone https://github.com/your-username/filebeam
cd filebeam
# push to your GitHub Pages branch, or open index.html directly
```

---

## Install as an app

**Android (Chrome):** An "Install" banner appears automatically on the first visit. Tap it to add FileBeam to your home screen. It will open as a standalone app with no browser chrome.

**iOS (Safari):** Tap the Share button → **Add to Home Screen**. Once installed, it loads instantly and works offline.

After installing, you don't need to visit the URL again — the installed version is fully self-contained.

---

## Technical details

| | |
|---|---|
| Transfer protocol | WebRTC DataChannel (ordered, reliable) |
| Chunk size | 16 KB |
| Signaling | Manual QR code / copy-paste (no signaling server) |
| ICE | Host candidates only — works on local subnet without STUN |
| Offline support | Service worker, cache-first strategy |
| QR generation | [qrcodejs](https://github.com/davidshimjs/qrcodejs) |
| QR scanning | [jsQR](https://github.com/cozmo/jsQR) via device camera |

Because there's no signaling server, the WebRTC offer and answer are exchanged manually as QR codes. STUN servers are included as a config fallback but aren't required — on a local hotspot network both devices share the same subnet, so host ICE candidates connect directly.

---

## Browser support

| Browser | Send | Receive | QR scan |
|---|---|---|---|
| Android Chrome | ✅ | ✅ | ✅ |
| iOS Safari 16+ | ✅ | ✅ | ✅ |
| Desktop Chrome/Edge | ✅ | ✅ | ✅ (webcam) |
| Firefox | ✅ | ✅ | ✅ |

Camera-based QR scanning requires HTTPS, which GitHub Pages provides automatically. The text code fallback works on any connection.

---

## Limitations

- **Both devices must open the page before going offline.** The service worker only caches on first load. If someone's never visited the URL, they'll need internet to load it — plan accordingly.
- **iOS Safari caps WebRTC buffer size** — very large files (multi-GB) may transfer more slowly on iOS due to tighter buffering constraints.
- **No resume** — if the connection drops mid-transfer, the transfer starts over.

---

## License

MIT
