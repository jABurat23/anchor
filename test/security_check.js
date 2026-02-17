const fetch = require('node-fetch');

async function testSecurity() {
    const baseUrl = 'http://localhost:3333';
    const secretKey = 'anchor_secure_dev_key';

    console.log('--- Security Hardening Verification ---');

    // 1. Test Server-Side Identity
    console.log('\n[1] Testing Server-Side Identity Registration...');
    try {
        const regRes = await fetch(`${baseUrl}/api/register`, { method: 'POST' });
        const regData = await regRes.json();
        if (regData.id && regData.id.length > 30) {
            console.log('✅ Identity Registration: SUCCESS (Server issued ID)');
        } else {
            console.log('❌ Identity Registration: FAILED');
        }
    } catch (e) {
        console.log('❌ Identity Registration: ERROR', e.message);
    }

    // 2. Test API Authentication
    console.log('\n[2] Testing Heartbeat API Authentication...');
    try {
        // No Key
        const failRes = await fetch(`${baseUrl}/api/devices/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'test', name: 'tester' })
        });
        if (failRes.status === 401) {
            console.log('✅ Unauthorized Check: SUCCESS (Blocked without key)');
        } else {
            console.log('❌ Unauthorized Check: FAILED');
        }

        // With Key
        const successRes = await fetch(`${baseUrl}/api/devices/heartbeat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': secretKey
            },
            body: JSON.stringify({ id: 'test', name: 'tester', status: 'online' })
        });
        if (successRes.status === 200) {
            console.log('✅ Authorized Check: SUCCESS (Accepted with key)');
        } else {
            console.log('❌ Authorized Check: FAILED', successRes.status);
        }
    } catch (e) {
        console.log('❌ Authentication Check: ERROR', e.message);
    }

    // 3. Test XSS Sanitization
    console.log('\n[3] Testing XSS Sanitization...');
    const xssPayload = '<script>alert("XSS")</script> - Hacky Device';
    try {
        await fetch(`${baseUrl}/api/devices/heartbeat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': secretKey
            },
            body: JSON.stringify({ id: 'xss-test', name: xssPayload, status: 'online' })
        });

        const listRes = await fetch(`${baseUrl}/api/devices`);
        const devices = await listRes.json();
        const xssDevice = devices.find(d => d.id === 'xss-test');

        if (xssDevice && (xssDevice.name.includes('&lt;script&gt;') || xssDevice.name.includes('&#x3C;script&#x3E;'))) {
            console.log('✅ XSS Sanitization: SUCCESS (Server escaped name)');
        } else if (xssDevice) {
            console.log('❌ XSS Sanitization: FAILED (Name was not escaped)', xssDevice.name);
        } else {
            console.log('❌ XSS Sanitization: FAILED (Device not found)');
        }
    } catch (e) {
        console.log('❌ XSS Check: ERROR', e.message);
    }
}

testSecurity();
