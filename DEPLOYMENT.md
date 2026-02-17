# 🚢 Anchor Deployment Guide

This guide covers two main deployment strategies:
1.  **Local Self-Host** (Best for full functionality, mDNS, and privacy).
2.  **Cloud Hosting** (Best for demos, remote access).

---

## 🌩️ Strategy 1: Cloud Hosting (Render/Heroku/Railway)

Deploying to the cloud is perfect for trying out the dashboard or setting up a central **Cloud Relay**.

### ⚠️ Important 
Cloud servers **cannot** use mDNS to discover devices on your home network. You will need to manually point your devices to the cloud URL (e.g., `https://my-anchor-app.onrender.com`).

### Using Render (Recommended)
1.  **Fork** this repository.
2.  Sign up at [render.com](https://render.com).
3.  Click **New +** -> **Web Service**.
4.  Connect your GitHub repo.
5.  **Settings**:
    *   **Runtime**: Node
    *   **Build Command**: `npm ci`
    *   **Start Command**: `npm start`
    *   **Env Vars**: Add `ANCHOR_SECRET_KEY` with a strong password.

---

## 🏠 Strategy 2: Local Home Lab (Raspberry Pi / Linux)

This is the **intended** way to run Anchor. It enables zero-config discovery for all your smart devices.

### Prerequisites
- A Raspberry Pi (3B+ or 4 recommended) or any Linux server.
- Docker & Docker Compose installed.

### Steps
1.  Clone the repo on your Pi:
    ```bash
    git clone https://github.com/jABurat23/anchor.git
    cd anchor
    ```

2.  Run with Docker Compose:
    ```bash
    # network_mode: host is essential for mDNS to work!
    docker-compose up -d --build
    ```

3.  Access the Dashboard:
    Open `http://raspberrypi.local:3333` or `http://<IP-ADDRESS>:3333`

### Does it work on Windows/Mac?
Yes, but Docker Desktop for Windows/Mac has trouble with `host` networking mode (mDNS).
*   **Workaround**: Run it directly with `npm install && npm start`.

---

## 🔌 Connecting Devices

### Local Mode (Default)
Devices scan for `_anchor._tcp.local`. They find the server automatically.

### Cloud Mode
You must configure your devices manually:

```javascript
// In your device code (Agent.js) config:
const agent = new DeviceAgent({
    id: 'my-sensor',
    // ...
});

// OVERRIDE discovery and point to cloud
agent.serverUrl = 'https://my-anchor.onrender.com';
agent.connect();
```
