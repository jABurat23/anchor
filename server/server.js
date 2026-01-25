const fastify = require('fastify')({ logger: { level: 'error' } });
const path = require('path');
const mDNS = require('multicast-dns');
const os = require('os');
const { version: VERSION } = require('../package.json');

// Internal Log Store (Quiet containment)
const systemLogs = [];
function logSystemEvent(type, message, details = {}) {
    const entry = { timestamp: new Date(), type, message, details };
    systemLogs.unshift(entry);
    if (systemLogs.length > 100) systemLogs.pop(); // Keep last 100
    // Only console error critical things
    if (type === 'ERROR') console.error(`[Anchor System Error] ${message}`, details);
}

// Helper to get local IP
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4
            if (!iface.internal && iface.family === 'IPv4') {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const http = require('http'); // For cloud sync

const LOCAL_IP = getLocalIP();
const PORT = 3333; // Changed to avoid port 3000 conflict
const HOSTNAME = 'anchor-core.local';
const CLOUD_URL = 'http://localhost:4000/api/cloud/ingest';

// Cloud Sync State
const cloudQueue = [];
const MAX_HISTORY = 50;

// Plugin registration
fastify.register(require('@fastify/cors'));
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '../public'),
    prefix: '/',
});

// Device Store
// In Phase 2 this will be more complex. For now, just a list.
const devices = new Map();

// mDNS Setup
const mdns = mDNS();

mdns.on('response', (response) => {
    // Quietly update internal state if needed in future
});

mdns.on('query', (query) => {
    // Respond if they ask for our service
    if (query.questions.some(q => q.name === '_anchor._tcp.local')) {
        sendAnnouncement();
    }
});

function sendAnnouncement() {
    mdns.respond({
        answers: [{
            name: '_anchor._tcp.local',
            type: 'PTR',
            data: 'anchor-core._anchor._tcp.local'
        }, {
            name: 'anchor-core._anchor._tcp.local',
            type: 'SRV',
            data: {
                port: PORT,
                weight: 0,
                priority: 10,
                target: HOSTNAME
            }
        }, {
            name: HOSTNAME,
            type: 'A',
            ttl: 300,
            data: LOCAL_IP
        }]
    });
}

// Routes
fastify.get('/api/health', async () => {
    return { status: 'ok', version: VERSION };
});

fastify.get('/api/devices', async () => {
    return Array.from(devices.values());
});

fastify.get('/api/system/logs', async () => {
    return systemLogs;
});

fastify.post('/api/devices/heartbeat', async (req) => {
    const { id, name, status, stats } = req.body || {};
    if (id) {
        const event = {
            id,
            name,
            status,
            stats,
            timestamp: new Date()
        };
        updateDeviceState(event);
        return { success: true };
    }
    return { success: false, error: 'Missing ID' };
});

fastify.post('/api/devices/sync', async (req) => {
    const events = req.body || [];
    if (!Array.isArray(events)) return { success: false, error: 'Expected array' };

    let processed = 0;
    for (const event of events) {
        if (event.id) {
            updateDeviceState(event);
            processed++;
        }
    }
    return { success: true, processed };
});

function updateDeviceState(event) {
    const eventTime = new Date(event.timestamp || Date.now());
    let device = devices.get(event.id);

    if (!device) {
        device = {
            id: event.id,
            name: event.name || 'Unknown',
            history: [] // Init history
        };
        devices.set(event.id, device);
    }

    // Update current state if newer
    if (!device.lastSeen || eventTime > new Date(device.lastSeen)) {
        device.name = event.name || device.name;
        device.status = event.status || 'online';
        device.lastSeen = eventTime;
        // device.ip could remain from direct request reference if needed, 
        // but for sync events origin IP might not be device IP. 
        // We'll ignore IP updates from bulk sync for simplicity here.
    }

    // Add to history
    device.history.push(event);
    if (device.history.length > MAX_HISTORY) device.history.shift();

    // Queue for Cloud
    cloudQueue.push(event);
}

// Cloud Sync Loop
setInterval(syncToCloud, 5000); // Try every 5s

async function syncToCloud() {
    if (cloudQueue.length === 0) return;

    const batch = [...cloudQueue]; // Copy
    const payload = JSON.stringify(batch);

    console.log(`[CloudSync] Attempting to push ${batch.length} items...`);

    const req = http.request(CLOUD_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length
        }
    }, (res) => {
        if (res.statusCode === 200) {
            console.log('[CloudSync] Success');
            // Remove sent items from queue (simple version: assuming FIFO preserved)
            cloudQueue.splice(0, batch.length);
        } else {
            console.log(`[CloudSync] Failed: ${res.statusCode}`);
        }
    });

    req.on('error', (e) => {
        console.error(`[CloudSync] Error: ${e.message}`);
    });

    req.write(payload);
    req.end();
}

const start = async () => {
    try {
        await fastify.listen({ port: PORT, host: '0.0.0.0' });

        // --- Stylized Startup Banner ---
        const banner = `
   ⚓ ANCHOR CORE™ IS ACTIVE (v${VERSION})
   -----------------------------------------
   Local IP:    http://${LOCAL_IP}:${PORT}
   Hostname:    ${HOSTNAME} (mDNS)
   Status:      ONLINE & READY
   -----------------------------------------
   
   Available Endpoints:
   GET  /api/health       -> System Health
   GET  /api/devices      -> Known Devices
   GET  /api/system/logs  -> Internal Events
   POST /api/devices/hb   -> Device Heartbeats
        `;
        console.log(banner);

        // Initial announcement
        sendAnnouncement();
        // Periodic announcement (every 30s)
        setInterval(sendAnnouncement, 30000);

    } catch (err) {
        logSystemEvent('ERROR', 'Server failed to start', { error: err.message });
        process.exit(1);
    }
};

start();
