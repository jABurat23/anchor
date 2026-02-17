const fastify = require('fastify')({ logger: { level: 'error' } });
const path = require('path');
const mDNS = require('multicast-dns');
const os = require('os');
const chalk = require('chalk');
const { version: VERSION } = require('../package.json');
const he = require('he');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { log } = require('./logger');
const sentinel = require('../security/sentinel');

const LOCAL_IP = config.getLocalIP();

// Device Store
const devices = new Map();
const activeSockets = new Map();

// Register Main Plugins
// Register Main Plugins
fastify.register(require('@fastify/cors'), {
    origin: [/localhost/, /127\.0\.0\.1/, /anchor-core\.local/],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-API-Key']
});
fastify.register(require('@fastify/websocket'));
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '../public'),
    prefix: '/',
});

// App Logic Registration
fastify.register(async function (app) {

    // WebSocket Route
    app.get('/api/ws', { websocket: true }, (connection, req) => {
        // Most resilient way to get the socket
        const socket = connection.socket || connection;

        // AUTHENTICATION CHECK
        const apiKey = req.query.apiKey;
        if (apiKey !== config.API_KEY) {
            log('SECURITY', 'Unauthorized WS connection blocked', `IP: ${req.ip}`);
            sentinel.log('AUTH_FAIL', req.ip, 'Invalid WS Key');
            socket.close(1008, 'Unauthorized');
            return;
        }

        if (!socket || typeof socket.on !== 'function') {
            log('ERROR', 'WebSocket connection failed: Invalid socket object');
            return;
        }

        let currentDeviceId = null;

        socket.on('message', message => {
            try {
                const data = JSON.parse(message);

                if (data.type === 'register') {
                    currentDeviceId = data.id;
                    activeSockets.set(currentDeviceId, socket);

                    const deviceName = devices.has(currentDeviceId) ? devices.get(currentDeviceId).name : 'New Device';
                    log('WS', `Device Registered: ${chalk.bold(deviceName)}`, `(ID: ${currentDeviceId.slice(0, 8)}...)`);

                    // Capture IP from WS request
                    const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

                    updateDeviceState({
                        id: currentDeviceId,
                        name: deviceName,
                        status: 'online',
                        ip: clientIp,
                        timestamp: new Date()
                    });
                } else if (data.type === 'ping') {
                    const targetName = devices.has(data.targetId) ? devices.get(data.targetId).name : data.targetId;
                    log('WS', `Routing Ping to ${chalk.bold(targetName)}`);

                    const targetSocket = activeSockets.get(data.targetId);
                    if (targetSocket && targetSocket.readyState === 1) {
                        targetSocket.send(JSON.stringify({ type: 'ping', from: currentDeviceId }));
                    }
                } else if (data.type === 'latency:start') {
                    const targetSocket = activeSockets.get(data.targetId);
                    if (targetSocket && targetSocket.readyState === 1) {
                        targetSocket.send(JSON.stringify({
                            type: 'latency:check',
                            from: currentDeviceId,
                            timestamp: data.timestamp || Date.now()
                        }));
                    }
                } else if (data.type === 'latency:pong') {
                    const targetSocket = activeSockets.get(data.targetId);
                    if (targetSocket && targetSocket.readyState === 1) {
                        targetSocket.send(JSON.stringify({
                            type: 'latency:result',
                            from: currentDeviceId,
                            originalTimestamp: data.originalTimestamp
                        }));
                    }
                } else if (data.type === 'log:event') {
                    const devName = devices.get(currentDeviceId)?.name || 'Unknown';
                    log('EVENT', `[${devName}] ${data.message}`);
                } else if (data.type === 'stream:request' || data.type === 'stream:start' || data.type === 'stream:stop' || data.type === 'stream:failed' || data.type === 'preview:request' || data.type.startsWith('action:') || data.type === 'gps:data') {
                    const targetSocket = activeSockets.get(data.targetId);

                    // Only log session starts/ends to reduce noise
                    if (data.type !== 'preview:request' && data.type !== 'action:file') {
                        const devName = devices.get(currentDeviceId)?.name || 'Unknown';
                        log('ADMIN', `${data.type} from ${devName}`);
                    }

                    if (targetSocket && targetSocket.readyState === 1) {
                        targetSocket.send(JSON.stringify({ ...data, from: currentDeviceId }));
                    }
                } else if (data.type === 'stream:chunk' || data.type === 'preview:data') {
                    const targetSocket = activeSockets.get(data.targetId);
                    if (targetSocket && targetSocket.readyState === 1) {
                        targetSocket.send(JSON.stringify({
                            type: data.type === 'preview:data' ? 'preview:data' : 'stream:chunk',
                            from: currentDeviceId,
                            chunk: data.type === 'preview:data' ? null : data.chunk,
                            image: data.image || null,
                            mimeType: data.mimeType || null
                        }));
                    }
                }
            } catch (e) {
                log('ERROR', 'WS Message Parse Error', e.message);
            }
        });

        socket.on('close', () => {
            if (currentDeviceId) {
                activeSockets.delete(currentDeviceId);
                const deviceName = devices.has(currentDeviceId) ? devices.get(currentDeviceId).name : 'Unknown';
                log('WS', `Device Disconnected: ${deviceName}`);
            }
        });
    });

    // API Routes
    app.get('/api/health', async () => ({
        status: 'ok',
        version: VERSION,
        uptime: process.uptime(),
        timestamp: new Date()
    }));

    app.get('/api/metrics', async () => {
        const memory = process.memoryUsage();
        return {
            connections: activeSockets.size,
            devices: devices.size,
            memory: {
                heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
                rss: Math.round(memory.rss / 1024 / 1024) + 'MB'
            },
            uptime: Math.round(process.uptime()) + 's'
        };
    });


    app.get('/api/security/alerts', async () => sentinel.getAlerts());

    app.get('/api/devices', async () => Array.from(devices.values()));

    app.post('/api/devices/heartbeat', async (req, reply) => {
        // API Key Validation
        const apiKey = req.headers['x-api-key'];
        if (apiKey !== config.API_KEY) {
            log('SECURITY', 'Unauthorized heartbeat blocked', `IP: ${req.ip}`);
            sentinel.log('AUTH_FAIL', req.ip, 'Invalid Heartbeat Key');
            return reply.status(401).send({ success: false, error: 'Unauthorized' });
        }

        const { id, name, status, stats, activity } = req.body || {};
        if (id) {
            const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
            updateDeviceState({ id, name, status, stats, activity, ip: clientIp, timestamp: new Date() });
            return { success: true };
        }
        return reply.status(400).send({ success: false, error: 'Missing ID' });
    });

    // Batch Ingestion (Offline Sync)
    app.post('/api/devices/heartbeat/batch', async (req, reply) => {
        const apiKey = req.headers['x-api-key'];
        if (apiKey !== config.API_KEY) {
            log('SECURITY', 'Unauthorized batch sync blocked', `IP: ${req.ip}`);
            sentinel.log('AUTH_FAIL', req.ip, 'Invalid Batch Key');
            return reply.status(401).send({ success: false, error: 'Unauthorized' });
        }

        const { id, events } = req.body || {};
        const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

        if (Array.isArray(events)) {
            let processed = 0;
            for (const event of events) {
                // Allow event to carry its own ID, but default to batch ID
                const eventId = event.id || id;
                if (eventId) {
                    updateDeviceState({ ...event, id: eventId, ip: clientIp, timestamp: event.timestamp || new Date() });
                    processed++;
                }
            }
            log('INFO', `Batch sync processed ${processed} events`, `(Device: ${id})`);
            return { success: true, count: processed };
        }
        return reply.status(400).send({ success: false, error: 'Invalid batch format' });
    });

    // Identity Registration Endpoint
    app.post('/api/register', async (req) => {
        const newId = uuidv4();
        log('INFO', 'New Identity Issued', `(ID: ${newId.slice(0, 8)}...)`);
        return { id: newId };
    });
});

function updateDeviceState(event) {
    const eventTime = new Date(event.timestamp || Date.now());
    let device = devices.get(event.id);

    if (!device) {
        const sanitizedName = he.encode(event.name || 'Unknown');
        device = {
            id: event.id,
            name: sanitizedName,
            history: [],
            type: event.stats?.type || 'Unknown',
            user: 'Unknown',
            browser: event.stats?.ua || 'Unknown',
            os: 'Unknown',
            ip: event.ip || 'Unknown',
            activity: event.activity || 'Idle'
        };
        if (device.name.includes(' - ')) {
            const parts = device.name.split(' - ');
            device.type = parts[0];
            device.user = parts[1];
        }
        devices.set(event.id, device);
        log('DEVICE', `New Device Discovered: ${chalk.green.bold(device.name)}`);
    }

    if (!device.lastSeen || eventTime > new Date(device.lastSeen)) {
        if (device.status !== event.status && event.status) {
            const statusStr = event.status === 'online' ? chalk.green('ONLINE') : chalk.red('OFFLINE');
            log('DEVICE', `${device.name} is now ${statusStr}`);
        }
        device.name = event.name ? he.encode(event.name) : device.name;
        device.status = event.status || 'online';
        device.lastSeen = eventTime;
        device.ip = event.ip || device.ip;
        device.activity = event.activity || device.activity;

        // Re-parse name to update Type and User
        if (device.name.includes(' - ')) {
            const parts = device.name.split(' - ');
            device.type = parts[0];
            device.user = parts[1];
        }

        if (event.stats) device.browser = event.stats.ua || device.browser;
    }

    device.history.push(event);
    if (device.history.length > config.MAX_HISTORY) device.history.shift();
}

// mDNS Setup
const mdns = mDNS();
mdns.on('query', (query) => {
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
            data: { port: config.PORT, weight: 0, priority: 10, target: config.MDNS_HOST }
        }, {
            name: config.MDNS_HOST,
            type: 'A',
            ttl: 300,
            data: LOCAL_IP
        }]
    });
}

const start = async () => {
    try {
        await fastify.listen({ port: config.PORT, host: config.HOST });

        const chalk = require('chalk'); // Re-require for the startup banner only
        console.log('\n' + chalk.bgBlue.white.bold('   ⚓ ANCHOR CORE™ v' + VERSION + '   '));
        console.log(chalk.gray('-----------------------------------------'));
        console.log(`   ${chalk.cyan('Local IP:')}    http://${LOCAL_IP}:${config.PORT}`);
        console.log(`   ${chalk.cyan('Hostname:')}    ${config.MDNS_HOST} (mDNS)`);
        console.log(`   ${chalk.cyan('Status:')}      ${chalk.green.bold('ONLINE & READY')}`);
        console.log(`   ${chalk.cyan('Metrics:')}     http://${LOCAL_IP}:${config.PORT}/api/metrics`);
        console.log(chalk.gray('-----------------------------------------'));
        console.log('');

        log('INFO', 'System started. Listening for connections...');

        sendAnnouncement();
        setInterval(sendAnnouncement, 30000);

    } catch (err) {
        log('ERROR', 'Server failed to start', err.message);
        process.exit(1);
    }
};

start();
