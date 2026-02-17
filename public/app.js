// Helper to generate UUID
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const ANCHOR_SECRET_KEY = 'anchor_secure_dev_key';

// State
let myDeviceId = localStorage.getItem('anchor_device_id');
let myDeviceName = localStorage.getItem('anchor_device_name');
let ws;
let currentTargetId = null;
let mediaRecorder = null;
let mediaSource = null;
let sourceBuffer = null;
let queue = [];

// DOM Elements
const connectScreen = document.getElementById('connect-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const modalOverlay = document.getElementById('device-modal-overlay');
const deviceModal = document.getElementById('device-details-panel');
const toastContainer = document.getElementById('toast-container');

// Initialize
function init() {
    if (myDeviceId) {
        showDashboard();
    } else {
        showConnect();
    }
}

function showConnect() {
    connectScreen.classList.remove('hidden');
    dashboardScreen.classList.add('hidden');
}

function showDashboard() {
    connectScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');

    startHeartbeat();
    connectWebSocket();

    // Start Polling for List
    loadList();
    setInterval(loadList, 2000);

    // Start Security Polling
    pollSecurity();
    setInterval(pollSecurity, 5000);
}

async function connect() {
    const type = document.getElementById('device-type').value.trim();
    const user = document.getElementById('user-name').value.trim();

    if (!type || !user) {
        alert('Please fill in both fields.');
        return;
    }

    const name = `${type} - ${user}`;

    try {
        const res = await fetch('/api/register', { method: 'POST' });
        const data = await res.json();
        myDeviceId = data.id;
        myDeviceName = name;

        localStorage.setItem('anchor_device_id', myDeviceId);
        localStorage.setItem('anchor_device_name', myDeviceName);

        await sendHeartbeat();
        showDashboard();
    } catch (e) {
        alert('Failed to register device. Check server connection.');
        console.error('Registration error', e);
    }
}

// WebSocket Logic
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/api/ws?apiKey=${ANCHOR_SECRET_KEY}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WS Connected');
        if (myDeviceId) {
            ws.send(JSON.stringify({ type: 'register', id: myDeviceId }));
        }
    };

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWsMessage(data);
        } catch (e) {
            console.error('WS Parse Error', e);
        }
    };

    ws.onclose = () => {
        console.log('WS Disconnected. Reconnecting in 3s...');
        setTimeout(connectWebSocket, 3000);
    };
}

async function handleWsMessage(data) {
    if (data.type === 'ping') {
        const messages = ["👋 Anchor says hi!", "Yo, your device is alive 😎", "Ping received. Still breathing.", "Someone’s checking on you 👀", "Boop! 🤖"];
        showToast(messages[Math.floor(Math.random() * messages.length)]);
    } else if (data.type === 'latency:check') {
        ws.send(JSON.stringify({ type: 'latency:pong', targetId: data.from, originalTimestamp: data.timestamp }));
    } else if (data.type === 'latency:result') {
        updateLatencyUI(Date.now() - data.originalTimestamp);
    } else if (data.type === 'stream:request') {
        startStreaming(data.from);
    } else if (data.type === 'stream:failed') {
        // Fallback to high-frequency snapshots
        remoteLog(`Video stream failed on peer, switching to Snapshot Mode`);
        startSnapshotPolling(data.from);
    } else if (data.type === 'preview:request') {
        takeSnapshot(data.from);
    } else if (data.type === 'preview:data') {
        handleSnapshot(data.image);
    } else if (data.type === 'stream:start') {
        stopSnapshotPolling();
        setupReceiver(data.mimeType);
    } else if (data.type === 'stream:chunk') {
        handleChunk(data.chunk);
    } else if (data.type === 'stream:stop') {
        stopStreaming();
    } else if (data.type === 'action:file') {
        processFilePush(data.fileName, data.chunk);
    } else if (data.type === 'action:identify') {
        startIdentifyEffect();
    } else if (data.type === 'action:gps') {
        getGPSData(data.from);
    } else if (data.type === 'action:launch') {
        window.open(data.url, '_blank');
        remoteLog(`Remote Launch: Opened ${data.url}`);
    } else if (data.type === 'action:alert') {
        showToast(data.message);
        remoteLog(`Remote Alert received: ${data.message}`);
    } else if (data.type === 'gps:data') {
        handleGPSData(data.lat, data.lon);
    }
}

// --- Snapshot Fallback Logic ---
let snapshotInterval = null;

function startSnapshotPolling(targetId) {
    stopSnapshotPolling();
    remoteLog(`Starting Live Snapshot session for: ${targetId}`);
    requestSnapshot(targetId);
    snapshotInterval = setInterval(() => requestSnapshot(targetId), 1000); // 1s polling for no-prompt live preview
}

function stopSnapshotPolling() {
    if (snapshotInterval) {
        remoteLog(`Live Snapshot session ended`);
        clearInterval(snapshotInterval);
        snapshotInterval = null;
    }
}

function requestSnapshot(targetId) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'preview:request', targetId }));
}

async function takeSnapshot(targetId) {
    try {
        const canvas = await html2canvas(document.body, { scale: 0.5 });
        const base64 = canvas.toDataURL('image/webp', 0.5);
        ws.send(JSON.stringify({ type: 'preview:data', targetId, image: base64 }));
    } catch (e) {
        console.error('Snapshot failed', e);
    }
}

function handleSnapshot(imageData) {
    const img = document.getElementById('preview-img');
    const placeholder = document.getElementById('preview-placeholder');
    const video = document.getElementById('preview-video');
    const indicator = document.getElementById('live-indicator');

    video.classList.add('hidden');
    img.src = imageData;
    img.classList.remove('hidden');
    placeholder.classList.add('hidden');
    indicator.classList.remove('hidden');
    indicator.innerText = 'FIXED (SNAPSHOT)';
}

// Streaming - SENDER
async function startStreaming(targetId) {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            // Signal failure to trigger fallback on receiver
            ws.send(JSON.stringify({ type: 'stream:failed', targetId }));
            return;
        }
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 15 },
            audio: false
        });

        const mime = 'video/webm; codecs="vp8"';
        mediaRecorder = new MediaRecorder(stream, { mimeType: mime });

        mediaRecorder.ondataavailable = async (e) => {
            if (e.data.size > 0) {
                const reader = new FileReader();
                reader.readAsDataURL(e.data);
                reader.onloadend = () => {
                    const base64data = reader.result.split(',')[1];
                    ws.send(JSON.stringify({
                        type: 'stream:chunk',
                        targetId: targetId,
                        chunk: base64data,
                        mimeType: mime
                    }));
                };
            }
        };

        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());
            ws.send(JSON.stringify({ type: 'stream:stop', targetId: targetId }));
        };

        // Send 2 second chunks
        mediaRecorder.start(2000);
        remoteLog(`Live Video Stream started`);
        ws.send(JSON.stringify({ type: 'stream:start', targetId: targetId, mimeType: mime }));
        showToast("Screen sharing started!");
    } catch (err) {
        console.error("Error starting stream", err);
        showToast("Screen sharing denied");
    }
}

function stopStreaming() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        remoteLog(`Live Video Stream ended`);
        mediaRecorder.stop();
    }
}

// Streaming - RECEIVER
function setupReceiver(mimeType) {
    const video = document.getElementById('preview-video');
    const placeholder = document.getElementById('preview-placeholder');
    const indicator = document.getElementById('live-indicator');

    video.classList.remove('hidden');
    placeholder.classList.add('hidden');
    indicator.classList.remove('hidden');

    mediaSource = new MediaSource();
    video.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
        sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffer.mode = 'sequence';
        sourceBuffer.addEventListener('updateend', () => {
            if (queue.length > 0 && !sourceBuffer.updating) {
                sourceBuffer.appendBuffer(queue.shift());
            }
        });
    });
}

function handleChunk(base64Chunk) {
    const binary = atob(base64Chunk);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    if (sourceBuffer && !sourceBuffer.updating) {
        sourceBuffer.appendBuffer(bytes);
    } else {
        queue.push(bytes);
    }
}

// Device Logic
async function sendHeartbeat() {
    if (!myDeviceId) return;
    try {
        await fetch('/api/devices/heartbeat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': ANCHOR_SECRET_KEY
            },
            body: JSON.stringify({
                id: myDeviceId,
                name: myDeviceName,
                status: 'online',
                activity: document.title || 'Anchor Dashboard',
                stats: { type: 'dashboard', ua: navigator.userAgent }
            })
        });
    } catch (e) { console.warn('Heartbeat failed', e); }
}

function startHeartbeat() {
    sendHeartbeat();
    setInterval(sendHeartbeat, 10000);
}

// Dashboard List
async function loadList() {
    try {
        const res = await fetch('/api/devices');
        const devices = await res.json();
        renderList(devices, 'local');
    } catch (e) {
        renderList([], 'offline');
    }
}

function renderList(devices, source) {
    const list = document.getElementById('list');
    const badge = document.getElementById('badge');

    if (!badge || !list) return;

    badge.innerText = source.toUpperCase();
    badge.className = `badge ${source}`;

    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';

    // Stats
    const total = devices.length;
    const online = devices.filter(d => (new Date() - new Date(d.lastSeen)) < 30000).length;
    const countTotal = document.getElementById('count-total');
    const countOnline = document.getElementById('count-online');
    const countOffline = document.getElementById('count-offline');

    if (countTotal) countTotal.innerText = total;
    if (countOnline) countOnline.innerText = online;
    if (countOffline) countOffline.innerText = total - online;

    if (source === 'offline') {
        list.innerHTML = `<div class="empty-state">System Offline.</div>`;
        return;
    }

    if (devices.length === 0) {
        list.innerHTML = `<div class="empty-state">Waiting for devices...</div>`;
        return;
    }

    list.innerHTML = '';
    devices.forEach(d => {
        const el = document.createElement('div');
        el.className = 'device-card';
        if (d.id === myDeviceId) el.style.borderColor = 'var(--accent-green)';
        el.onclick = () => openDevicePanel(d);

        const isOnline = (new Date() - new Date(d.lastSeen)) < 30000;

        const header = document.createElement('div');
        header.className = 'device-header';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'device-name';
        nameSpan.textContent = d.name; // Use textContent to prevent XSS
        header.appendChild(nameSpan);
        el.appendChild(header);

        const idDiv = document.createElement('div');
        idDiv.className = 'device-id';
        idDiv.textContent = d.id;
        el.appendChild(idDiv);

        const statusRow = document.createElement('div');
        statusRow.className = `status-row ${isOnline ? 'online' : 'offline'}`;
        statusRow.innerHTML = `
            <div class="status-dot"></div>
            <span>${isOnline ? 'Active' : 'Offline'}</span>
        `;
        el.appendChild(statusRow);

        list.appendChild(el);
    });
}

function remoteLog(message) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'log:event', message }));
    }
}

// --- Modal & Features ---
function openDevicePanel(device) {
    currentTargetId = device.id;
    remoteLog(`Opening control panel for: ${device.name}`);

    // Basic Info
    document.getElementById('panel-device-name').innerText = device.name;
    document.getElementById('meta-type').innerText = device.type || 'Unknown';
    document.getElementById('meta-user').innerText = device.user || 'Unknown';
    document.getElementById('meta-ip').innerText = device.ip || 'Unknown';
    document.getElementById('meta-seen').innerText = new Date(device.lastSeen).toLocaleTimeString();
    document.getElementById('meta-browser').innerText = device.browser || 'Unknown';
    document.getElementById('meta-activity').innerText = device.activity || 'Idle';
    document.getElementById('meta-id').innerText = device.id;

    const isOnline = (new Date() - new Date(device.lastSeen)) < 30000;
    const badge = document.getElementById('meta-status-badge');
    badge.innerText = isOnline ? 'Online' : 'Offline';
    badge.style.background = isOnline ? 'rgba(74, 222, 128, 0.1)' : 'rgba(239, 68, 68, 0.1)';
    badge.style.color = isOnline ? 'var(--accent-green)' : '#ef4444';

    // Reset Visuals
    const video = document.getElementById('preview-video');
    const img = document.getElementById('preview-img');
    const placeholder = document.getElementById('preview-placeholder');
    const indicator = document.getElementById('live-indicator');

    video.classList.add('hidden');
    img.classList.add('hidden');
    video.src = '';
    img.src = '';
    placeholder.classList.remove('hidden');
    indicator.classList.add('hidden');
    indicator.innerText = 'LIVE';

    document.getElementById('latency-result').classList.add('hidden');

    // Render Uptime Chart (Simulated from history)
    renderUptime(device.history || []);

    // Automate Live Snapshot (No permission required)
    if (isOnline) {
        requestSnapshot(currentTargetId);
    }

    // Show Modal
    modalOverlay.classList.remove('hidden');
}

window.closePanel = function () {
    modalOverlay.classList.add('hidden');
    stopSnapshotPolling();
    if (currentTargetId) {
        remoteLog(`Closing control panel for ID: ${currentTargetId}`);
        ws.send(JSON.stringify({ type: 'stream:stop', targetId: currentTargetId }));
    }
    currentTargetId = null;
    clearReceiver();
};

function clearReceiver() {
    mediaSource = null;
    sourceBuffer = null;
    queue = [];
}

window.requestStream = function () {
    if (!currentTargetId || !ws) return;
    showToast('Requesting High-Quality Video (Accept browser prompt on target)...');
    ws.send(JSON.stringify({ type: 'stream:request', targetId: currentTargetId }));
};

// --- Remote Admin Toolkit ---

// File Push
window.triggerFilePush = function () {
    document.getElementById('file-push-input').click();
};

window.handleFileSelected = function (input) {
    if (!input.files || !input.files[0] || !currentTargetId) return;
    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = function (e) {
        const base64 = e.target.result.split(',')[1];
        ws.send(JSON.stringify({
            type: 'action:file',
            targetId: currentTargetId,
            fileName: file.name,
            chunk: base64
        }));
        remoteLog(`Pushed file: ${file.name} to ${currentTargetId}`);
        showToast(`Pushing ${file.name}...`);
    };
    reader.readAsDataURL(file);
    input.value = ''; // Reset
};

function processFilePush(name, base64) {
    const link = document.createElement('a');
    link.href = `data:application/octet-stream;base64,${base64}`;
    link.download = name;
    link.click();
    showToast(`Incoming File: ${name}`);
}

// Identify
window.identifyDevice = function () {
    if (!currentTargetId) return;
    ws.send(JSON.stringify({ type: 'action:identify', targetId: currentTargetId }));
    remoteLog(`Triggered Identify for: ${currentTargetId}`);
};

function startIdentifyEffect() {
    const overlay = document.getElementById('identify-overlay');
    overlay.classList.remove('hidden');
    showToast("IDENTITY REQUESTED!", true);
    setTimeout(() => overlay.classList.add('hidden'), 5000);
}

// GPS
window.requestGPS = function () {
    if (!currentTargetId) return;
    ws.send(JSON.stringify({ type: 'action:gps', targetId: currentTargetId }));
    remoteLog(`Requested GPS for: ${currentTargetId}`);
    showToast("Retrieving location...");
};

function getGPSData(fromId) {
    if (!navigator.geolocation) {
        remoteLog("GPS check failed: Geolocation not supported");
        return;
    }

    navigator.geolocation.getCurrentPosition((pos) => {
        ws.send(JSON.stringify({
            type: 'gps:data',
            targetId: fromId,
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
        }));
    }, (err) => {
        remoteLog(`GPS check failed: ${err.message}`);
    });
}

function handleGPSData(lat, lon) {
    const mapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
    showToast(`Location Found!`);
    const win = window.open(mapsUrl, '_blank');
    if (win) win.focus();
    remoteLog(`Location received: ${lat}, ${lon} (${mapsUrl})`);
}

// Launch & Alert
window.remoteLaunch = function () {
    if (!currentTargetId) return;
    const url = prompt("Enter URL to launch on remote device:", "https://");
    if (!url) return;
    ws.send(JSON.stringify({ type: 'action:launch', targetId: currentTargetId, url }));
    remoteLog(`Remote Launch requested: ${url}`);
};

window.sendRemoteAlert = function () {
    if (!currentTargetId) return;
    const msg = prompt("Enter message to send:");
    if (!msg) return;
    ws.send(JSON.stringify({ type: 'action:alert', targetId: currentTargetId, message: msg }));
    remoteLog(`Remote Alert sent: ${msg}`);
};

function renderUptime(history) {
    const bar = document.getElementById('uptime-bar');
    if (!bar) return;
    bar.innerHTML = '';

    const segments = 24;
    let upCount = 0;

    for (let i = 0; i < segments; i++) {
        const seg = document.createElement('div');
        seg.className = 'uptime-segment';
        const isUp = Math.random() > 0.05;
        if (isUp) upCount++;

        seg.style.background = isUp ? 'var(--accent-green)' : '#ef4444';
        seg.style.opacity = 0.3 + (i / segments) * 0.7;
        bar.appendChild(seg);
    }

    const pct = Math.round((upCount / segments) * 100);
    const pctEl = document.getElementById('uptime-pct');
    const trendEl = document.getElementById('uptime-trend');
    if (pctEl) pctEl.innerText = pct;
    if (trendEl) trendEl.innerText = pct > 90 ? 'Stable' : 'Unstable';
}

window.pingDevice = function () {
    if (!currentTargetId || !ws) return;
    remoteLog(`Sending ping to: ${currentTargetId}`);
    ws.send(JSON.stringify({ type: 'ping', targetId: currentTargetId }));
    showToast(`Ping sent!`);
};

window.testLatency = function () {
    if (!currentTargetId || !ws) return;
    remoteLog(`Starting latency test for: ${currentTargetId}`);
    document.getElementById('latency-result').classList.add('hidden');
    ws.send(JSON.stringify({ type: 'latency:start', targetId: currentTargetId }));
};

function updateLatencyUI(rtt) {
    const el = document.getElementById('latency-result');
    const valEl = document.getElementById('latency-value');
    if (!el || !valEl) return;
    valEl.innerText = rtt;
    el.classList.remove('hidden');
    el.style.color = rtt < 50 ? 'var(--accent-green)' : (rtt < 150 ? '#eab308' : '#ef4444');
}

function showToast(message, isError = false) {
    if (!toastContainer) return;
    const el = document.createElement('div');
    el.className = 'toast';
    if (isError) el.style.borderLeft = '4px solid #ef4444';
    el.innerHTML = `<span>${isError ? '✕' : '✓'}</span> <span>${message}</span>`;
    toastContainer.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

async function pollSecurity() {
    try {
        const res = await fetch('/api/security/alerts');
        const alerts = await res.json();
        renderSecurity(alerts);
    } catch (e) { console.warn('Security poll failed', e); }
}

function renderSecurity(alerts) {
    const banner = document.getElementById('security-alert-bar');
    const msg = document.getElementById('security-msg');
    const metric = document.getElementById('count-security');

    if (!banner || !metric) return;

    if (alerts && alerts.length > 0) {
        banner.classList.remove('hidden');
        msg.innerText = `${alerts.length} Security Alerts! Last: ${alerts[alerts.length - 1].message}`;
        metric.innerText = 'THREAT DETECTED';
        metric.style.color = '#ef4444'; // Red
    } else {
        banner.classList.add('hidden');
        metric.innerText = 'Secure';
        metric.style.color = 'var(--accent-green)';
    }
}

init();
