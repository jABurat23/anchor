const WebSocket = require('ws');

function createClient(id) {
    return new Promise((resolve) => {
        const ws = new WebSocket('ws://127.0.0.1:3333/api/ws?apiKey=anchor_secure_dev_key');
        ws.on('open', () => {
            console.log(`[${id}] Connected`);
            ws.send(JSON.stringify({ type: 'register', id }));
            resolve(ws);
        });
    });
}

async function runTest() {
    console.log('--- Starting WebSocket Verification ---');

    const clientA = await createClient('device-A');
    const clientB = await createClient('device-B');

    // Wait for registration to propagate
    await new Promise(r => setTimeout(r, 500));

    // TEST 1: Ping A -> B
    console.log('\n[Test 1] Ping A -> B');
    const pingPromise = new Promise(resolve => {
        clientB.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.type === 'ping' && msg.from === 'device-A') {
                console.log('✅ B received ping from A');
                resolve();
            }
        });
    });

    clientA.send(JSON.stringify({ type: 'ping', targetId: 'device-B' }));
    await pingPromise;

    console.log('\n--- Verification SUCCESS ---');
    process.exit(0);
}

runTest().catch(e => {
    console.error(e);
    process.exit(1);
});
