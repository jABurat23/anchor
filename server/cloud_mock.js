const fastify = require('fastify')({ logger: { level: 'error' } }); // Quiet logger

const CLOUD_PORT = 4000;
const cloudDB = []; // In-memory "Cloud Database"

fastify.register(require('@fastify/cors'));

// Ingest endpoint
fastify.post('/api/cloud/ingest', async (req) => {
    const batch = req.body || [];
    if (!Array.isArray(batch)) return { success: false, error: 'Expected array' };

    console.log(`[Cloud] Received batch of ${batch.length} events`);

    // Store events
    batch.forEach(e => {
        cloudDB.push({
            ...e,
            cloudIngestedAt: new Date()
        });
    });

    return { success: true, cloudCount: cloudDB.length };
});

// View Data endpoint (Raw)
fastify.get('/api/cloud/data', async () => {
    return cloudDB;
});

// View Devices endpoint (Aggregated State)
fastify.get('/api/devices', async () => {
    const devices = new Map();

    // Replay history to build state
    // In a real DB we'd have a 'devices' table and an 'events' table
    for (const event of cloudDB) {
        if (!event.id) continue;

        const existing = devices.get(event.id);
        const eventTime = new Date(event.timestamp || Date.now());

        if (!existing) {
            devices.set(event.id, {
                id: event.id,
                name: event.name || 'Unknown',
                status: event.status || 'online',
                lastSeen: eventTime,
                source: 'cloud'
            });
        } else if (eventTime > new Date(existing.lastSeen)) {
            existing.name = event.name || existing.name;
            existing.status = event.status || existing.status;
            existing.lastSeen = eventTime;
        }
    }

    return Array.from(devices.values());
});

const start = async () => {
    try {
        await fastify.listen({ port: CLOUD_PORT, host: '0.0.0.0' });
        console.log(`[Cloud] Mock Cloud Server running at http://localhost:${CLOUD_PORT}`);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

start();
