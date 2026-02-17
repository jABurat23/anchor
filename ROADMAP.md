# Anchor Project Roadmap & Status

## Phase 1: Inception & Foundation
**Status: ✅ Completed**

### What We Built
- **Node.js + Fastify Core**: Modular server structure.
- **Local-first Architecture**: mDNS for zero-config discovery.
- **Documentation**: `README.md` and `architecture.md` documenting data flow and offline strategies.
- **Identity**: Project branding and identity (jaDev).

### What to Improve Next
- [ ] **Config Management**: Strict environment validation, separate dev/demo/prod configs.
- [ ] **Observability**: Structured logging (request IDs, device IDs, log levels).
- [ ] **Health Endpoints**: `/health` + `/metrics` for diagnostics.
- [ ] **Diagrams**: Sequence flows, offline state machine, threat model.

---

## Phase 2: Core Features & Operator Experience
**Status: ✅ Completed**

### What We Built
- **Dashboard**: Vanilla JS dashboard for device monitoring.
- **Theme Engine**: Persistent Light/Dark/System modes.
- **Interactive Playbook**: Dynamic progress tracking.
- **Live Streaming**: WebRTC with **Snapshot Fallback** for non-SSL LAN environments.

### What to Improve Next
- [ ] **Dashboard Resilience**: State store + WS auto-reconnect + stale data indicators.
- [ ] **Stream Health**: Quality downgrade logic + latency indicators.
- [ ] **Failure UX**: Clear error states ("Core unreachable").
- [ ] **Operator Observability**: Heartbeat timelines, buffer size per device.

---

## Phase 3: Security Hardening & Offline Resilience (Red Team Phase)
**Status: ✅ Completed**

### What We Built
- **XSS Protection**: Sanitization for device names.
- **Identity**: Server-side device ID issuance (`/api/register`).
- **Network Security**: CORS restriction to trusted local origins.
- **Authentication**:
    - API key auth (`X-API-Key`).
    - Authenticated WebSocket handshake.
- **Resilience**:
    - Offline buffering.
    - Batch sync (`/api/devices/heartbeat/batch`).
    - Updated `Agent.js` for auth and auto-recovery.

### What to Improve Next
- [ ] **Per-device Secrets**: Replace shared API key with unique credentials.
- [ ] **Replay Protection**: Timestamps + nonces.
- [ ] **Audit Logging**: Security event logs (auth failures, key revocations).
- [ ] **Transport Security**: Optional TLS.
- [ ] **RBAC**: Viewer vs Controller roles.

---

## Phase 4: Security Intelligence & Autonomous Defense (Anchor Sentinel)
**Status: 🚧 Planned / Next Up**

### Objectives
- **Centralized Security Feed**: A unified stream of security-relevant events.
- **IDS-lite Rules**: Detection of auth spam, abnormal batch sizes, anomalous heartbeats.
- **Real-time Alerts**: Dashboard notifications for security threats.
- **Automated Responses**: Throttling, quarantine, key revocation.

### What to Improve Next
- [ ] **Rule Engine**: Configurable detection rules (YAML/JSON).
- [ ] **Correlation**: Multi-event detection (e.g., brute-force).
- [ ] **Visualization**: Attack timelines + security heatmaps.
- [ ] **Forensics**: Event export for analysis.
- [ ] **Policy Engine**: Trust-based capability restrictions.
- [ ] **Baselines**: Automatic normal behavior modeling.

---

## One-Liner Summary
**Anchor** is a secure, offline-first edge orchestration platform with zero-config discovery, resilient telemetry sync, real-time streaming with graceful fallback, and built-in security monitoring with autonomous defense.
