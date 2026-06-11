import { Peer, type DataConnection } from 'peerjs';
import jsQR from 'jsqr';
import QRCode from 'qrcode';

// Typings for file transfers
interface FileMetadata {
  name: string;
  size: number;
  type: string;
  fileIndex: number;
}

interface ControlMessage {
  type: 'meta' | 'start-file' | 'end-file' | 'complete' | 'error';
  metadata?: FileMetadata[];
  fileIndex?: number;
  errorMsg?: string;
}

// State variables
let myPeer: Peer | null = null;
let currentConn: DataConnection | null = null;
let selectedFiles: File[] = [];
let receivedFiles: { name: string; blob: Blob; size: number }[] = [];
let connectionTimeoutId: number | null = null; // Connection timeout tracker
let wakeLock: any = null; // Screen WakeLock reference
let smoothSpeed = 0; // Speed tracker smoothing variable

// History typing
interface HistoryItem {
  name: string;
  size: number;
  direction: 'sent' | 'received';
  timestamp: number;
}

// Map file type to SVG icon
function getFileIcon(type: string): string {
  if (type.startsWith('image/')) {
    return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  } else if (type.startsWith('video/')) {
    return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
  } else if (type.startsWith('audio/')) {
    return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  } else {
    return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }
}

// Speed tracking variables
let speedInterval: number | null = null;
let lastTransferredBytes = 0;
let transferredBytes = 0;
let totalBytesToTransfer = 0;

// Camera variables
let cameraStream: MediaStream | null = null;
let cameraTimer: number | null = null;

// Wake Lock Helper API
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await (navigator as any).wakeLock.request('screen');
    }
  } catch (err) {
    console.warn('Wake Lock request failed:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().then(() => {
      wakeLock = null;
    });
  }
}

// Screen management
function showScreen(screenId: string) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.classList.add('hidden');
  });
  const activeScreen = document.getElementById(screenId);
  if (activeScreen) {
    activeScreen.classList.remove('hidden');
    activeScreen.classList.add('flex');
  }
  
  // Clean up camera if moving away from receive code screen
  if (screenId !== 's-recv-offer') {
    stopCamera();
  } else {
    // Auto-focus first digit box immediately on transition
    setTimeout(() => {
      const d1 = document.getElementById('digit-1');
      if (d1) d1.focus();
    }, 150);
  }
}

// Utility: format bytes to human readable string
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Update Connection status UI
function updateConnectionStatus(status: 'disconnected' | 'connecting' | 'connected', label?: string) {
  const badge = document.getElementById('conn-badge');
  const dot = document.getElementById('conn-dot');
  const text = document.getElementById('conn-status-text');

  if (!badge || !dot || !text) return;

  badge.classList.remove('hidden');
  badge.classList.add('flex');

  dot.className = 'w-2.5 h-2.5 rounded-full';
  
  if (status === 'disconnected') {
    dot.classList.add('bg-red-500');
    text.textContent = label || 'Disconnected';
  } else if (status === 'connecting') {
    dot.classList.add('bg-yellow-500', 'animate-pulse');
    text.textContent = label || 'Connecting...';
  } else if (status === 'connected') {
    dot.classList.add('bg-success');
    text.textContent = label || 'Connected';
  }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  setupHomeListeners();
  setupFileSelectionListeners();
  setupCodeInputListeners();
  checkUrlParams();
  loadHistoryUI(); // Load recent transfers list on launch

  // Check initial network connection state
  if (!navigator.onLine) {
    updateConnectionStatus('disconnected', 'Offline (No Internet)');
  }

  // Network connection status change listeners
  window.addEventListener('online', () => {
    updateConnectionStatus('disconnected', 'Online (Ready)');
  });
  window.addEventListener('offline', () => {
    updateConnectionStatus('disconnected', 'Offline (No Internet)');
  });

  // Prevent default drag-and-drop navigation on window/body levels
  window.addEventListener('dragover', (e) => e.preventDefault(), false);
  window.addEventListener('drop', (e) => e.preventDefault(), false);
});

// Check URL params for room code scan fallback
function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  if (room && /^\d{6}$/.test(room)) {
    // Fill room code inputs
    showScreen('s-recv-offer');
    for (let i = 0; i < 6; i++) {
      const el = document.getElementById(`digit-${i + 1}`) as HTMLInputElement;
      if (el) el.value = room[i];
    }
    // Connect
    connectToSender(room);
  }
}

// Setup Home screen listeners
function setupHomeListeners() {
  document.getElementById('header-logo')?.addEventListener('click', () => {
    resetState();
    showScreen('s-home');
  });

  document.getElementById('btn-send-init')?.addEventListener('click', () => {
    selectedFiles = [];
    updateSelectedFilesUI();
    showScreen('s-send-file');
  });

  document.getElementById('btn-recv-init')?.addEventListener('click', () => {
    showScreen('s-recv-offer');
    // Clear code fields
    for (let i = 1; i <= 6; i++) {
      const input = document.getElementById(`digit-${i}`) as HTMLInputElement;
      if (input) input.value = '';
    }
    document.getElementById('digit-1')?.focus();
  });

  document.querySelectorAll('.btn-back').forEach((btn) => {
    btn.addEventListener('click', () => {
      resetState();
      showScreen('s-home');
    });
  });

  // Cancel buttons click listeners
  document.getElementById('btn-cancel-send')?.addEventListener('click', () => {
    resetState();
    showScreen('s-home');
  });
  document.getElementById('btn-cancel-recv')?.addEventListener('click', () => {
    resetState();
    showScreen('s-home');
  });

  // Clear history button click listener
  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    localStorage.removeItem('fbeam_history');
    loadHistoryUI();
  });
}

// Reset state on disconnect/back
function resetState() {
  stopCamera();
  releaseWakeLock();
  
  // Hide cancel/done buttons
  document.getElementById('btn-cancel-send')?.classList.remove('hidden');
  document.getElementById('btn-cancel-recv')?.classList.remove('hidden');
  document.getElementById('btn-send-done')?.classList.add('hidden');
  document.getElementById('btn-recv-done')?.classList.add('hidden');

  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
  if (speedInterval) {
    clearInterval(speedInterval);
    speedInterval = null;
  }
  if (currentConn) {
    currentConn.close();
    currentConn = null;
  }
  if (myPeer) {
    myPeer.destroy();
    myPeer = null;
  }
  selectedFiles = [];
  receivedFiles = [];
  transferredBytes = 0;
  totalBytesToTransfer = 0;
  updateConnectionStatus('disconnected');
}

// Setup file selection listeners
function setupFileSelectionListeners() {
  const dropZone = document.getElementById('file-drop-zone');
  const fileInput = document.getElementById('file-input-el') as HTMLInputElement;
  const btnCreateRoom = document.getElementById('btn-create-room');

  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-accent', 'bg-accent/5');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-accent', 'bg-accent/5');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-accent', 'bg-accent/5');
    if (e.dataTransfer?.files) {
      handleFilesSelected(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files) {
      handleFilesSelected(Array.from(fileInput.files));
      fileInput.value = ''; // Reset input value so change fires on identical files selection
    }
  });

  btnCreateRoom?.addEventListener('click', () => {
    if (selectedFiles.length > 0) {
      initializeSenderRoom();
    }
  });
}

// Handle selected files
function handleFilesSelected(files: File[]) {
  if (files.length === 0) return;
  
  // Max file size limit: 2GB (prevent browser tab memory crashes)
  const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
  const validFiles = files.filter(f => {
    if (f.size > MAX_FILE_SIZE) {
      alert(`File "${f.name}" exceeds the 2GB browser limit and was removed to prevent memory crashes.`);
      return false;
    }
    return true;
  });

  if (validFiles.length === 0) return;

  selectedFiles = [...selectedFiles, ...validFiles];
  updateSelectedFilesUI();
}

// Update UI with selected files
function updateSelectedFilesUI() {
  const container = document.getElementById('file-list-container');
  const card = document.getElementById('file-list-card');
  const totalSizeEl = document.getElementById('total-selected-size');

  if (!container || !card || !totalSizeEl) return;

  if (selectedFiles.length === 0) {
    card.classList.add('hidden');
    card.classList.remove('flex');
    return;
  }

  card.classList.remove('hidden');
  card.classList.add('flex');

  // Prevent XSS: Clear and rebuild safely using DOM API rather than innerHTML
  container.innerHTML = '';
  let totalSize = 0;

  selectedFiles.forEach((file, index) => {
    totalSize += file.size;

    const fileRow = document.createElement('div');
    fileRow.className = 'flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-border/80';

    const fileInfo = document.createElement('div');
    fileInfo.className = 'flex items-center gap-2.5 min-w-0';

    // Safe type-specific icon svg
    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'w-7 h-7 rounded-lg bg-accent/15 border border-accent/20 flex items-center justify-center text-accent flex-shrink-0';
    iconWrapper.innerHTML = getFileIcon(file.type);
    fileInfo.appendChild(iconWrapper);

    const nameSizeWrapper = document.createElement('div');
    nameSizeWrapper.className = 'min-w-0';

    const nameText = document.createElement('p');
    nameText.className = 'text-xs font-bold text-text-primary truncate max-w-[180px]';
    nameText.textContent = file.name; // Secure: textContent is safe from XSS

    const sizeText = document.createElement('p');
    sizeText.className = 'text-[10px] text-text-secondary font-semibold';
    sizeText.textContent = formatBytes(file.size);

    nameSizeWrapper.appendChild(nameText);
    nameSizeWrapper.appendChild(sizeText);
    fileInfo.appendChild(nameSizeWrapper);
    fileRow.appendChild(fileInfo);

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'text-text-secondary hover:text-red-400 p-1 transition cursor-pointer';
    deleteBtn.ariaLabel = `Remove ${file.name}`;
    deleteBtn.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedFiles.splice(index, 1);
      updateSelectedFilesUI();
    });

    fileRow.appendChild(deleteBtn);
    container.appendChild(fileRow);
  });

  totalSizeEl.textContent = formatBytes(totalSize);
}

// Generate Room Code and initialize PeerJS room
function initializeSenderRoom() {
  resetState(); // Clean up previous connections and timeouts
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const displayEl = document.getElementById('room-code-display');
  if (displayEl) {
    displayEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  }

  updateConnectionStatus('connecting', 'Creating Room...');
  
  // Custom prefix to prevent ID collision in PeerJS public cloud
  const peerId = `fbeam-${code}`;
  
  // strict security configurations
  myPeer = new Peer(peerId, {
    debug: 1, // Only errors
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  });

  myPeer.on('open', () => {
    updateConnectionStatus('connecting', 'Waiting for Receiver');
    showScreen('s-send-offer');
    
    // Generate QR code safely. The URL redirects receiver directly.
    const receiverUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
    const qrContainer = document.getElementById('send-qr-container');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      const canvas = document.createElement('canvas');
      qrContainer.appendChild(canvas);
      try {
        QRCode.toCanvas(canvas, receiverUrl, {
          width: 160,
          margin: 1,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        }, (err) => {
          if (err) {
            console.error(err);
            qrContainer.textContent = 'QR failed. Use code above.';
          }
        });
      } catch (err) {
        console.error(err);
        qrContainer.textContent = 'QR failed. Use code above.';
      }
    }

    // Set copy button content
    const copyBtn = document.getElementById('btn-copy-code');
    if (copyBtn) {
      // Clear event listeners
      const newCopyBtn = copyBtn.cloneNode(true) as HTMLElement;
      copyBtn.parentNode?.replaceChild(newCopyBtn, copyBtn);
      newCopyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(`Room Code: ${code}\nLink: ${receiverUrl}`).then(() => {
          const originalHTML = newCopyBtn.innerHTML;
          // Clean checkmark SVG transition
          newCopyBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-success animate-scale" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Copied!</span>`;
          setTimeout(() => { newCopyBtn.innerHTML = originalHTML; }, 2000);
        });
      });
    }
  });

  myPeer.on('connection', (conn) => {
    currentConn = conn;
    setupSenderConnection();
  });

  myPeer.on('error', (err) => {
    console.error('Peer error:', err);
    alert('Failed to establish room. Adblocker or strict firewall blocking connection. Retrying...');
    resetState();
    showScreen('s-home');
  });
}

// Setup connection handlers on sender side
function setupSenderConnection() {
  if (!currentConn) return;

  currentConn.on('open', () => {
    updateConnectionStatus('connected', 'Receiver Connected');
    startSendingPayload();
  });

  currentConn.on('close', () => {
    updateConnectionStatus('disconnected', 'Receiver Disconnected');
    alert('Connection closed by receiver.');
    resetState();
    showScreen('s-home');
  });

  currentConn.on('error', (err) => {
    console.error('Connection error:', err);
    resetState();
    showScreen('s-home');
  });
}

// Start sending payload data (file-by-file)
async function startSendingPayload() {
  if (!currentConn || selectedFiles.length === 0) return;

  showScreen('s-send-xfer');
  buildSendQueueUI();
  await requestWakeLock(); // Request Wake Lock during transmission

  totalBytesToTransfer = selectedFiles.reduce((acc, f) => acc + f.size, 0);
  transferredBytes = 0;
  lastTransferredBytes = 0;


  startSpeedTracker(true);

  // Send metadata about the payload
  const metadata: FileMetadata[] = selectedFiles.map((file, idx) => ({
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    fileIndex: idx
  }));

  currentConn.send({
    type: 'meta',
    metadata
  } as ControlMessage);

  // Send files one by one
  for (let i = 0; i < selectedFiles.length; i++) {
    await sendSingleFile(selectedFiles[i], i);
  }

  // Finalize
  currentConn.send({ type: 'complete' } as ControlMessage);
  
  if (speedInterval) {
    clearInterval(speedInterval);
    speedInterval = null;
  }

  const titleEl = document.getElementById('send-status-title');
  if (titleEl) titleEl.textContent = 'Payload Transmitted!';

  // Hide cancel, show done button
  document.getElementById('btn-cancel-send')?.classList.add('hidden');
  const doneBtn = document.getElementById('btn-send-done');
  if (doneBtn) {
    doneBtn.classList.remove('hidden');
    doneBtn.addEventListener('click', () => {
      resetState();
      showScreen('s-home');
    });
  }

  // Save to history
  saveToHistory(selectedFiles.map(f => ({ name: f.name, size: f.size })), 'sent');
}

// Build send queue UI
function buildSendQueueUI() {
  const container = document.getElementById('send-queue-container');
  if (!container) return;

  container.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const row = document.createElement('div');
    row.id = `send-item-${index}`;
    row.className = 'flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-border/80 text-xs text-text-secondary';
    
    const nameEl = document.createElement('span');
    nameEl.className = 'font-bold text-text-primary truncate max-w-[200px]';
    nameEl.textContent = file.name;

    const statusEl = document.createElement('span');
    statusEl.id = `send-status-${index}`;
    statusEl.className = 'font-semibold text-[10px] uppercase tracking-wider text-slate-500';
    statusEl.textContent = 'Queued';

    row.appendChild(nameEl);
    row.appendChild(statusEl);
    container.appendChild(row);
  });
}

// Sleep utility to handle transmission backpressure
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Send a single file chunk by chunk
async function sendSingleFile(file: File, fileIndex: number) {
  if (!currentConn) return;

  // Update file queue UI to Active
  const statusEl = document.getElementById(`send-status-${fileIndex}`);
  const rowEl = document.getElementById(`send-item-${fileIndex}`);
  if (statusEl && rowEl) {
    statusEl.textContent = 'Transmitting';
    statusEl.className = 'font-bold text-[10px] uppercase tracking-wider text-accent animate-pulse';
    rowEl.classList.add('border-accent/40', 'bg-accent/5');
  }

  // Signal starting file
  currentConn.send({
    type: 'start-file',
    fileIndex
  } as ControlMessage);

  const CHUNK_SIZE = 1024 * 16; // 16KB chunks (iOS Safari caps compatible)
  let offset = 0;

  while (offset < file.size) {
    // Check backpressure (bufferedAmount)
    // Safe guard: wait if buffer has more than 1MB to prevent memory bloat or crash
    while ((currentConn.dataChannel?.bufferedAmount ?? 0) > 1024 * 1024) {
      await sleep(35);
    }

    const chunkSlice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await chunkSlice.arrayBuffer();
    currentConn.send(buffer);

    offset += buffer.byteLength;
    transferredBytes += buffer.byteLength;

    // Update overall UI
    updateProgressUI(true);
  }

  // Signal ending file
  currentConn.send({
    type: 'end-file',
    fileIndex
  } as ControlMessage);

  // Update file status UI to complete
  if (statusEl && rowEl) {
    statusEl.textContent = 'Transmitted';
    statusEl.className = 'font-bold text-[10px] uppercase tracking-wider text-success';
    rowEl.classList.remove('border-accent/40', 'bg-accent/5');
    rowEl.classList.add('border-success/30', 'bg-success/5');
  }
}

// Start tracking transfer speed & ETA
function startSpeedTracker(isSending: boolean) {
  const speedEl = document.getElementById(isSending ? 'send-transfer-speed' : 'recv-transfer-speed');
  const etaEl = document.getElementById(isSending ? 'send-transfer-eta' : 'recv-transfer-eta');

  if (speedInterval) clearInterval(speedInterval);
  smoothSpeed = 0;

  speedInterval = setInterval(() => {
    const bytesThisSecond = transferredBytes - lastTransferredBytes;
    lastTransferredBytes = transferredBytes;

    // Smoothed Exponential Moving Average speed
    smoothSpeed = smoothSpeed === 0 ? bytesThisSecond : smoothSpeed * 0.7 + bytesThisSecond * 0.3;

    if (speedEl) {
      speedEl.textContent = `${formatBytes(smoothSpeed)}/s`;
    }

    if (etaEl && smoothSpeed > 100) {
      const remainingBytes = totalBytesToTransfer - transferredBytes;
      const secondsLeft = Math.ceil(remainingBytes / smoothSpeed);
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = secondsLeft % 60;
      etaEl.textContent = `ETA: ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    } else if (etaEl) {
      etaEl.textContent = 'ETA: --:--';
    }
  }, 1000) as unknown as number;
}

// Update UI progress details
function updateProgressUI(isSending: boolean) {
  const percentEl = document.getElementById(isSending ? 'send-progress-percent' : 'recv-progress-percent');
  const barEl = document.getElementById(isSending ? 'send-progress-bar' : 'recv-progress-bar');
  const ratioEl = document.getElementById(isSending ? 'send-transfer-ratio' : 'recv-transfer-ratio');

  if (totalBytesToTransfer === 0) return;

  const pct = Math.min(100, Math.round((transferredBytes / totalBytesToTransfer) * 100));

  if (percentEl) percentEl.textContent = `${pct}%`;
  if (barEl) barEl.style.width = `${pct}%`;
  if (ratioEl) {
    ratioEl.textContent = `${formatBytes(transferredBytes)} / ${formatBytes(totalBytesToTransfer)}`;
  }
}

// Setup Room Code digit fields actions (focus shifting)
function setupCodeInputListeners() {
  const inputs = Array.from(document.querySelectorAll('.digit-input')) as HTMLInputElement[];
  const btnSubmit = document.getElementById('btn-submit-code');

  inputs.forEach((input, idx) => {
    // On keyup focus shift & sanitize non-numeric
    input.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      target.value = target.value.replace(/\D/g, ''); // Digits only!
      const val = target.value;
      if (val && idx < 5) {
        inputs[idx + 1].focus();
      }
      checkEnableSubmit();
    });

    // Handle backspaces & arrow keys navigation
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        const target = e.target as HTMLInputElement;
        if (!target.value && idx > 0) {
          inputs[idx - 1].focus();
          inputs[idx - 1].value = '';
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        inputs[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < 5) {
        inputs[idx + 1].focus();
      }
    });

    // Handle copy-pastes
    input.addEventListener('paste', (e) => {
      let data = e.clipboardData?.getData('text') || '';
      
      // Extract code if pasting full URL
      if (data.includes('room=')) {
        try {
          const parsed = new URL(data).searchParams.get('room');
          if (parsed) data = parsed;
        } catch (err) {}
      }
      data = data.trim();
      
      if (data && /^\d{6}$/.test(data)) {
        e.preventDefault();
        for (let i = 0; i < 6; i++) {
          inputs[i].value = data[i];
        }
        inputs[5].focus();
        checkEnableSubmit();
      }
    });
  });

  function checkEnableSubmit() {
    const isFilled = inputs.every((input) => input.value !== '');
    if (isFilled && btnSubmit) {
      btnSubmit.removeAttribute('disabled');
    }
  }

  btnSubmit?.addEventListener('click', () => {
    const code = inputs.map((i) => i.value).join('');
    if (/^\d{6}$/.test(code)) {
      connectToSender(code);
    }
  });

  // Setup camera scanner listener
  document.getElementById('btn-toggle-camera')?.addEventListener('click', () => {
    const camBox = document.getElementById('camera-scan-container');
    if (camBox) {
      if (camBox.classList.contains('hidden')) {
        camBox.classList.remove('hidden');
        camBox.classList.add('flex');
        startCamera();
      } else {
        camBox.classList.add('hidden');
        camBox.classList.remove('flex');
        stopCamera();
      }
    }
  });
}

// Connect to the sender peer room
function connectToSender(code: string) {
  resetState(); // Clear peer and timeouts first
  updateConnectionStatus('connecting', 'Locating Sender...');
  const peerId = `fbeam-${code}`;

  // Start 15-second connection timeout
  connectionTimeoutId = setTimeout(() => {
    if (!currentConn || !currentConn.open) {
      alert('Connection timed out. Ensure both devices are on the same network and the code matches.');
      resetState();
      showScreen('s-home');
    }
  }, 15000) as unknown as number;

  myPeer = new Peer({
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  });

  myPeer.on('open', () => {
    const conn = myPeer!.connect(peerId, {
      reliable: true
    });
    currentConn = conn;
    setupReceiverConnection();
  });

  myPeer.on('error', (err) => {
    if (connectionTimeoutId) {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
    }
    console.error('Peer error:', err);
    alert('Connecting failed. Ensure you are on the same local network or try again.');
    resetState();
    showScreen('s-home');
  });
}

// Setup connection handlers on receiver side
function setupReceiverConnection() {
  if (!currentConn) return;

  let fileMeta: FileMetadata[] = [];
  let currentFileChunks: ArrayBuffer[] = [];
  let receivingIdx = -1;

  currentConn.on('open', () => {
    if (connectionTimeoutId) {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
    }
    updateConnectionStatus('connected', 'Connected to Sender');
    showScreen('s-recv-xfer');
  });

  currentConn.on('data', (data: unknown) => {
    // Handle incoming data slices and control signals
    if (data instanceof ArrayBuffer) {
      // Chunk payload data
      currentFileChunks.push(data);
      transferredBytes += data.byteLength;
      updateProgressUI(false);
    } else {
      // Control messages (JSON strings/objects)
      const msg = data as ControlMessage;
      if (msg.type === 'meta' && msg.metadata) {
        requestWakeLock();
        fileMeta = msg.metadata;
        totalBytesToTransfer = fileMeta.reduce((acc, f) => acc + f.size, 0);
        transferredBytes = 0;
        lastTransferredBytes = 0;

        buildReceiveQueueUI(fileMeta);
        startSpeedTracker(false);
      } else if (msg.type === 'start-file' && typeof msg.fileIndex === 'number') {
        receivingIdx = msg.fileIndex;
        currentFileChunks = [];
        updateFileStatusUI(receivingIdx, 'Receiving', 'text-accent animate-pulse');
      } else if (msg.type === 'end-file' && typeof msg.fileIndex === 'number') {
        const meta = fileMeta[msg.fileIndex];
        const blob = new Blob(currentFileChunks, { type: meta.type });
        
        // Add to received list
        receivedFiles.push({
          name: meta.name,
          blob,
          size: meta.size
        });

        // Update UI status to completed and render local download button
        updateFileStatusUI(msg.fileIndex, 'Ready to Save', 'text-success font-bold');
        enableDownloadBtn(msg.fileIndex, blob, meta.name);
        
        // Auto trigger download for government level UX
        triggerLocalDownload(blob, meta.name);
      } else if (msg.type === 'complete') {
        if (speedInterval) {
          clearInterval(speedInterval);
          speedInterval = null;
        }

        const titleEl = document.getElementById('recv-status-title');
        if (titleEl) titleEl.textContent = 'Payload Received!';

        // Hide cancel and show done button
        document.getElementById('btn-cancel-recv')?.classList.add('hidden');
        const doneBtn = document.getElementById('btn-recv-done');
        if (doneBtn) {
          doneBtn.classList.remove('hidden');
          doneBtn.addEventListener('click', () => {
            resetState();
            showScreen('s-home');
          });
        }

        // Save to history
        saveToHistory(receivedFiles.map(f => ({ name: f.name, size: f.size })), 'received');
      }
    }
  });

  currentConn.on('close', () => {
    updateConnectionStatus('disconnected');
    alert('Connection closed by sender.');
    resetState();
    showScreen('s-home');
  });

  currentConn.on('error', (err) => {
    console.error('Connection error:', err);
    resetState();
    showScreen('s-home');
  });
}

// Build receive queue UI
function buildReceiveQueueUI(metaList: FileMetadata[]) {
  const container = document.getElementById('recv-queue-container');
  if (!container) return;

  container.innerHTML = '';
  metaList.forEach((file, index) => {
    const row = document.createElement('div');
    row.id = `recv-item-${index}`;
    row.className = 'flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-border/80 text-xs text-text-secondary';

    const infoWrapper = document.createElement('div');
    infoWrapper.className = 'flex items-center gap-2.5 min-w-0';

    // Safe type-specific icon svg
    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'w-7 h-7 rounded-lg bg-accent/15 border border-accent/20 flex items-center justify-center text-accent flex-shrink-0';
    iconWrapper.innerHTML = getFileIcon(file.type);
    infoWrapper.appendChild(iconWrapper);

    const textWrapper = document.createElement('div');
    textWrapper.className = 'min-w-0';

    const nameEl = document.createElement('p');
    nameEl.className = 'font-bold text-text-primary truncate max-w-[150px]';
    nameEl.textContent = file.name;

    const sizeEl = document.createElement('p');
    sizeEl.className = 'text-[9px] text-text-secondary font-semibold';
    sizeEl.textContent = formatBytes(file.size);

    textWrapper.appendChild(nameEl);
    textWrapper.appendChild(sizeEl);
    infoWrapper.appendChild(textWrapper);

    const actionWrapper = document.createElement('div');
    actionWrapper.id = `recv-action-${index}`;
    actionWrapper.className = 'flex items-center justify-end';

    const statusEl = document.createElement('span');
    statusEl.id = `recv-status-${index}`;
    statusEl.className = 'font-semibold text-[10px] uppercase tracking-wider text-slate-500';
    statusEl.textContent = 'Queued';

    actionWrapper.appendChild(statusEl);
    row.appendChild(infoWrapper);
    row.appendChild(actionWrapper);
    container.appendChild(row);
  });
}

// Update file status UI (Receiver)
function updateFileStatusUI(index: number, label: string, className: string) {
  const statusEl = document.getElementById(`recv-status-${index}`);
  if (statusEl) {
    statusEl.textContent = label;
    statusEl.className = `font-semibold text-[10px] uppercase tracking-wider ${className}`;
  }
}

// Enable save/download action in file UI row
function enableDownloadBtn(index: number, blob: Blob, filename: string) {
  const actionWrapper = document.getElementById(`recv-action-${index}`);
  const rowEl = document.getElementById(`recv-item-${index}`);
  if (!actionWrapper) return;

  actionWrapper.innerHTML = ''; // Replaces status label with download button
  
  if (rowEl) {
    rowEl.classList.remove('border-border/80');
    rowEl.classList.add('border-success/30', 'bg-success/5');
  }

  const saveBtn = document.createElement('button');
  saveBtn.className = 'py-1 px-3 bg-success hover:bg-success/90 text-bg text-[10px] font-bold rounded-lg transition cursor-pointer';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    triggerLocalDownload(blob, filename);
  });

  actionWrapper.appendChild(saveBtn);
}

// Trigger browser download safely
function triggerLocalDownload(blob: Blob, filename: string) {
  // Sanitize filename: strip dangerous symbols, cap length to 100 characters to prevent system issues
  const sanitizedFilename = filename.replace(/[/\\?%*:|"<>\s]/g, '_').substring(0, 100);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizedFilename || 'downloaded_file';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// Camera control logic
async function startCamera() {
  const video = document.getElementById('scan-camera-el') as HTMLVideoElement;
  const statusEl = document.getElementById('scan-camera-status');
  if (!video) return;

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { 
        facingMode: 'environment',
        width: { ideal: 640 },
        height: { ideal: 640 }
      }
    });
    video.srcObject = cameraStream;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    cameraTimer = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        
        if (code && code.data) {
          if (statusEl) statusEl.textContent = 'QR Code Scanned!';
          
          // Parse code (check if complete url or just digit code)
          let roomCode = code.data.trim();
          if (roomCode.includes('room=')) {
            const parsed = new URL(roomCode).searchParams.get('room');
            if (parsed) roomCode = parsed;
          }
          
          if (/^\d{6}$/.test(roomCode)) {
            // Fill inputs and connect
            for (let i = 0; i < 6; i++) {
              const el = document.getElementById(`digit-${i + 1}`) as HTMLInputElement;
              if (el) el.value = roomCode[i];
            }
            stopCamera();
            const camBox = document.getElementById('camera-scan-container');
            if (camBox) camBox.classList.add('hidden');
            connectToSender(roomCode);
          }
        }
      }
    }, 300) as unknown as number;

  } catch (e) {
    console.error('Camera access error:', e);
    stopCamera();
    if (statusEl) statusEl.textContent = 'Camera blocked. Type code manually.';
    alert('Failed to access camera. Please allow camera permissions or type the 6-digit room code manually.');
  }
}

// Local History Storage functions
function saveToHistory(files: { name: string; size: number }[], direction: 'sent' | 'received') {
  try {
    const raw = localStorage.getItem('fbeam_history') || '[]';
    const list: HistoryItem[] = JSON.parse(raw);
    files.forEach(f => {
      list.unshift({
        name: f.name,
        size: f.size,
        direction,
        timestamp: Date.now()
      });
    });
    if (list.length > 20) list.length = 20; // Keep history compact
    localStorage.setItem('fbeam_history', JSON.stringify(list));
    loadHistoryUI();
  } catch (err) {
    console.error('History save error:', err);
  }
}

function loadHistoryUI() {
  const container = document.getElementById('recent-transfers-container');
  const card = document.getElementById('recent-transfers-card');
  if (!container || !card) return;

  try {
    const raw = localStorage.getItem('fbeam_history') || '[]';
    const list: HistoryItem[] = JSON.parse(raw);

    if (list.length === 0) {
      card.classList.add('hidden');
      card.classList.remove('flex');
      return;
    }

    card.classList.remove('hidden');
    card.classList.add('flex');
    container.innerHTML = '';

    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2 rounded-lg bg-slate-950/40 border border-border/60 text-[11px] text-text-secondary';

      const fileInfo = document.createElement('div');
      fileInfo.className = 'flex items-center gap-2 min-w-0';

      const dirBadge = document.createElement('span');
      dirBadge.className = `px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
        item.direction === 'sent' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
      }`;
      dirBadge.textContent = item.direction;

      const nameEl = document.createElement('span');
      nameEl.className = 'font-bold text-text-primary truncate max-w-[150px]';
      nameEl.textContent = item.name;

      fileInfo.appendChild(dirBadge);
      fileInfo.appendChild(nameEl);

      const sizeEl = document.createElement('span');
      sizeEl.className = 'font-mono text-slate-500';
      sizeEl.textContent = formatBytes(item.size);

      row.appendChild(fileInfo);
      row.appendChild(sizeEl);
      container.appendChild(row);
    });
  } catch (err) {
    console.error('History load error:', err);
  }
}

// Stop camera and release media tracks
function stopCamera() {
  if (cameraTimer) {
    clearInterval(cameraTimer);
    cameraTimer = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}



// Handle PWA Install banner state
let deferredPrompt: any = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('pwa-install-banner');
  if (banner) {
    banner.classList.remove('hidden');
    banner.classList.add('flex');
  }
});

document.getElementById('btn-pwa-install')?.addEventListener('click', () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult: { outcome: string }) => {
      if (choiceResult.outcome === 'accepted') {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.classList.add('hidden');
      }
      deferredPrompt = null;
    });
  }
});
