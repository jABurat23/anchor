const fetch = require('node-fetch');

async function triggerSecurityAlert() {
    console.log('--- Triggering Security Alert (Brute Force Simulation) ---');

    const targetUrl = 'http://127.0.0.1:3333/api/devices/heartbeat';
    const badHeaders = {
        'Content-Type': 'application/json',
        'X-API-Key': 'wrong_key_123'
    };

    // Send 6 bad requests to exceed the threshold of 5
    for (let i = 1; i <= 6; i++) {
        process.stdout.write(`Attempt ${i}... `);
        try {
            const res = await fetch(targetUrl, {
                method: 'POST',
                headers: badHeaders,
                body: JSON.stringify({ id: 'attacker', status: 'online' })
            });
            if (res.status === 401) console.log('Blocked (401) ✅');
            else console.log(`Unexpected status: ${res.status} ❌`);
        } catch (e) {
            console.log('Request failed', e.message);
        }
    }

    console.log('\nChecking for Alerts...');
    try {
        const res = await fetch('http://127.0.0.1:3333/api/security/alerts');
        const alerts = await res.json();

        if (alerts.length > 0) {
            console.log('✅ Security Alert Triggered!');
            console.log('Alert Details:', JSON.stringify(alerts[0], null, 2));
        } else {
            console.log('❌ No alerts found. Threshold might not have been reached.');
        }
    } catch (e) {
        console.error('Failed to fetch alerts:', e);
    }
}

triggerSecurityAlert();
