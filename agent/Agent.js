const EventEmitter = require('events');
const mDNS = require('multicast-dns');
const http = require('http');

class DeviceAgent extends EventEmitter {
    constructor(config) {
        super();
        this.id = config.id || 'dev-' + Math.floor(Math.random() * 100000);
        this.name = config.name || 'Unknown Device';
        this.serverUrl = null;
        this.serverIP = null;
        this.serverPort = 3000;

        this.buffer = [];
        this.isOnline = false;
        this.isConnected = false;

        // Discovery
        this.mdns = mDNS();
        this.setupDiscovery();

        // Loop
        this.checkInterval = null;
        this.retryDelay = 1000;
    }

    setupDiscovery() {
        this.mdns.on('response', (response) => {
            response.answers.forEach(answer => {
                if (answer.name === 'anchor-core.local' && answer.type === 'A') {
                    if (this.serverIP !== answer.data) {
                        this.log(`Discovered Anchor Core at ${answer.data}`);
                        this.serverIP = answer.data;
                        this.serverUrl = `http://${this.serverIP}:${this.serverPort}`;
                        this.emit('discovered', this.serverIP);
                        this.connect();
                    }
                }
            });
        });
    }

    start() {
        this.log('Agent started. Scanning for Anchor...');
        this.query();
        setInterval(() => this.query(), 5000);

        // Start Heartbeat Loop
        this.checkInterval = setInterval(() => this.tick(), 5000);
    }

    query() {
        if (this.isConnected) return;
        this.mdns.query({ questions: [{ name: '_anchor._tcp.local', type: 'PTR' }] });
    }

    connect() {
        this.isConnected = true;
        this.flushBuffer();
    }

    async tick() {
        if (!this.serverUrl) {
            this.bufferRequest({ status: 'offline', timestamp: new Date() });
            return;
        }

        try {
            await this.sendHeartbeat();
            this.isOnline = true;
            this.retryDelay = 1000; // Reset backoff
            if (this.buffer.length > 0) this.flushBuffer();
        } catch (error) {
            this.isOnline = false;
            this.log(`Heartbeat failed: ${error.message}`);
            this.bufferRequest({ status: 'offline', timestamp: new Date() });
        }
    }

    bufferRequest(data) {
        if (this.buffer.length < 100) { // Max buffer size
            this.buffer.push(data);
            this.emit('buffering', this.buffer.length);
        }
    }

    async flushBuffer() {
        if (this.buffer.length === 0) return;

        this.log(`Flushing ${this.buffer.length} buffered events...`);
        const batch = [...this.buffer]; // Copy

        try {
            await this.post('/api/devices/heartbeat/batch', {
                id: this.id,
                name: this.name,
                events: batch
            });
            this.buffer = []; // Clear on success
            this.log('Buffer flushed.');
        } catch (e) {
            this.log('Flush failed, keeping buffer.');
        }
    }

    async sendHeartbeat() {
        await this.post('/api/devices/heartbeat', {
            id: this.id,
            name: this.name,
            status: 'online',
            bufferSize: this.buffer.length
        });
    }

    post(path, body) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const req = http.request({
                hostname: this.serverIP,
                port: this.serverPort,
                path: path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                },
                timeout: 2000
            }, (res) => {
                if (res.statusCode === 200) resolve();
                else reject(new Error(`Status ${res.statusCode}`));
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });

            req.write(data);
            req.end();
        });
    }

    log(msg) {
        console.log(`[${this.name}] ${msg}`);
    }
}

module.exports = DeviceAgent;
