# Anchor Architecture Detailed Guide

This document provides a deep dive into the internal workings of the Anchor system.

## 1. Network Discovery (mDNS)

Anchor uses standard Multicast DNS (RFC 6762) for service discovery.

- **Service Type**: `_anchor._tcp.local`
- **Hostname**: `anchor-core.local`
- **Announcement Frequency**: Every 30 seconds (and on startup).

When a device (or the simulator) starts, it performs a PTR query for `_anchor._tcp.local`. The Anchor Core responds with an SRV record containing the port (`3333`) and an A record containing its local IP address.

## 2. Device States

The `DeviceAgent` and `simulate_device.js` implement a state machine to handle connectivity:

| State | Description |
| :--- | :--- |
| `BOOT` | Initializing resources and discovery. |
| `SCANNING` | Actively looking for Anchor Core via mDNS. |
| `CONNECTED` | Normal operation. Sending heartbeats every 5s. |
| `OFFLINE_BUFFERING` | Hub unreachable. Storing data in internal memory. |
| `SYNCING` | Reconnected. Uploading buffered data to the hub. |

## 3. Data Flow

### Device -> Core
Devices send a JSON payload containing:
- `id`: Unique device identifier.
- `name`: Human readable name.
- `status`: Current operational status.
- `stats`: Telemetry data (CPU, Temperature, etc.).
- `timestamp`: ISO-8601 string.

### Core -> Cloud
The Anchor Core runs a synchronization loop every 5 seconds. It batches all received device events and pushes them to the Cloud Relay. If the cloud is unreachable, the Core maintains its own `cloudQueue` to ensure no data is lost during transit to the cloud.

## 4. Web Dashboard
The dashboard is a lightweight Vanilla JS application served from `server/server.js`. It features:
- **Automatic Failover**: If the local hub becomes unreachable (e.g., accessed from a different network), the dashboard automatically attempts to pull data from the Cloud Relay.
- **Live Updates**: Polls the status API every 2 seconds to show real-time device health.
- **Visual Status**: Color-coded badges indicating if the dashboard is connected to a "LOCAL CORE" or a "CLOUD RELAY".

## 5. Reusable Agent Library (`agent/Agent.js`)
The `Agent.js` file provides a production-ready class that can be integrated into other Node.js projects to make them "Anchor Enabled".

```javascript
const DeviceAgent = require('./agent/Agent');
const agent = new DeviceAgent({ name: 'My Custom App' });
agent.start();
```

It handles all the complexity of mDNS, state management, and buffering automatically.
