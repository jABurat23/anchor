const mDNS = require('multicast-dns');
const http = require('http');

console.log('Simulating Intelligent Device...');

const mdns = mDNS();
const DEVICE_ID = 'dev-' + Math.floor(Math.random() * 10000);
const DEVICE_NAME = 'Smart Device ' + DEVICE_ID.split('-')[1];

// Configuration
const CONFIG = {
    heartbeatInterval: 5000,
    maxBuffer: 100
};

// State
let state = {
    mode: 'BOOT', // BOOT, SCANNING, CONNECTED, OFFLINE_BUFFERING, SYNCING
    serverIP: null,
    serverPort: 3333,
    buffer: [],
    lastSuccess: null,
    consecutiveFailures: 0
};

function setState(newMode) {
    if (state.mode !== newMode) {
        console.log(`[Device] State Change: ${state.mode} -> ${newMode}`);
        state.mode = newMode;

        if (newMode === 'SCANNING') {
            startScanning();
        } else if (newMode === 'SYNCING') {
            performSync();
        }
    }
}

// mDNS Discovery
mdns.on('response', (response) => {
    response.answers.forEach(answer => {
        if (answer.name === 'anchor-core.local' && answer.type === 'A') {
            if (state.serverIP !== answer.data) {
                console.log(`[Discovery] Found Anchor Core at ${answer.data}`);
                state.serverIP = answer.data;

                // If we were offline, we can now try to connect/sync
                if (state.mode === 'SCANNING' || state.mode === 'OFFLINE_BUFFERING') {
                    if (state.buffer.length > 0) {
                        setState('SYNCING');
                    } else {
                        setState('CONNECTED');
                    }
                }
            }
        }
    });
});

function startScanning() {
    // Query immediately and then periodically
    const query = () => {
        if (state.mode !== 'SCANNING' && state.mode !== 'BOOT') return;
        mdns.query({ questions: [{ name: '_anchor._tcp.local', type: 'PTR' }] });
    };
    query();
    // Scan every 5s if we are lost
    setInterval(() => {
        if (state.mode === 'SCANNING') query();
    }, 5000);
}

// Data Handling
function generateHeartbeat() {
    return {
        id: DEVICE_ID,
        name: DEVICE_NAME,
        status: 'online',
        timestamp: new Date().toISOString(),
        // Add some random "sensor data"
        stats: {
            cpu: Math.floor(Math.random() * 100),
            temp: 40 + Math.random() * 20
        }
    };
}

// Main Loop
setInterval(() => {
    const heartbeat = generateHeartbeat();

    if (state.mode === 'CONNECTED') {
        sendHeartbeat(heartbeat);
    } else if (state.mode === 'OFFLINE_BUFFERING') {
        console.log(`[Buffer] Server unreachable. Buffering data... (Buffer size: ${state.buffer.length + 1})`);
        state.buffer.push(heartbeat);
        if (state.buffer.length > CONFIG.maxBuffer) state.buffer.shift(); // Drop old

        // Retry every 3rd tick (approx 15s)
        if (state.buffer.length % 3 === 0) {
            console.log('[Buffer] Attempting reconnection probe...');
            mdns.query({ questions: [{ name: '_anchor._tcp.local', type: 'PTR' }] });
            sendHeartbeat(heartbeat, true);
        }
    } else if (state.mode === 'BOOT') {
        setState('SCANNING');
    }
}, CONFIG.heartbeatInterval);

async function sendHeartbeat(data, isProbe = false) {
    if (!state.serverIP) {
        if (!isProbe) {
            state.buffer.push(data);
            setState('OFFLINE_BUFFERING');
        }
        return;
    }

    const payload = JSON.stringify(data);

    const req = http.request({
        hostname: state.serverIP,
        port: state.serverPort,
        path: '/api/devices/heartbeat',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length
        },
        timeout: 2000
    }, (res) => {
        if (res.statusCode === 200) {
            state.lastSuccess = new Date();
            state.consecutiveFailures = 0;
            if (state.mode === 'OFFLINE_BUFFERING' || state.mode === 'SCANNING') {
                // If we succeeded and have buffer, sync next
                if (state.buffer.length > 0) setState('SYNCING');
                else setState('CONNECTED');
            } else if (isProbe) {
                // Probe succeeded
                if (state.buffer.length > 0) setState('SYNCING');
                else setState('CONNECTED');
            }
        }
    });

    req.on('error', () => {
        if (!isProbe) {
            handleConnectionFailure(data);
        }
    });

    req.on('timeout', () => {
        req.destroy();
        if (!isProbe) {
            handleConnectionFailure(data);
        }
    });

    req.write(payload);
    req.end();
}

function handleConnectionFailure(data) {
    state.consecutiveFailures++;
    // Push the failed data to buffer
    if (data) state.buffer.push(data);

    // If we fail too many times, go into buffering mode
    if (state.consecutiveFailures >= 2 && state.mode !== 'OFFLINE_BUFFERING') {
        setState('OFFLINE_BUFFERING');
    }
}

async function performSync() {
    console.log(`[Sync] Attempting to sync ${state.buffer.length} items...`);

    const payload = JSON.stringify(state.buffer);

    const req = http.request({
        hostname: state.serverIP,
        port: state.serverPort,
        path: '/api/devices/sync',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length
        }
    }, (res) => {
        if (res.statusCode === 200) {
            console.log('[Sync] Success! Buffer cleared.');
            state.buffer = []; // Clear buffer
            setState('CONNECTED');
        } else {
            console.log(`[Sync] Failed with ${res.statusCode}. Will retry.`);
            setState('OFFLINE_BUFFERING'); // Go back to buffering
        }
    });

    req.on('error', (e) => {
        console.error(`[Sync] Error: ${e.message}`);
        setState('OFFLINE_BUFFERING');
    });

    req.write(payload);
    req.end();
}
