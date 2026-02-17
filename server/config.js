const os = require('os');

const config = {
    PORT: process.env.PORT || 3333,
    HOST: process.env.HOST || '0.0.0.0',
    API_KEY: process.env.ANCHOR_SECRET_KEY || 'anchor_secure_dev_key',
    ENV: process.env.NODE_ENV || 'development',
    MDNS_HOST: 'anchor-core.local',
    MAX_HISTORY: 50,

    // Helper to get local IP
    getLocalIP: function () {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (!iface.internal && iface.family === 'IPv4') {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    }
};

module.exports = config;
