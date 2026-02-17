// Simplified IDS Rule Engine

const rules = [
    {
        id: 'AUTH_FAIL_BURST',
        name: 'Authentication Brute Force',
        threshold: 5,
        window: 60000, // 1 minute
        severity: 'HIGH',
        description: 'Detects multiple failed authentication attempts from a single IP.'
    },
    {
        id: 'BATCH_SIZE_ anomalous',
        name: 'Abnormal Batch Size',
        threshold: 1000,
        type: 'value_check',
        severity: 'MEDIUM',
        description: 'Flag batch uploads containing more than 1000 events.'
    }
];

class SecurityMonitor {
    constructor() {
        this.events = [];
        this.alerts = [];
    }

    log(type, source, details) {
        const event = {
            id: Date.now() + Math.random(),
            timestamp: new Date(),
            type,
            source,
            details
        };
        this.events.push(event);

        // Simple In-Memory cleanup
        if (this.events.length > 1000) this.events.shift();

        this.checkRules(event);
    }

    checkRules(newEvent) {
        // Rule: AUTH_FAIL_BURST
        if (newEvent.type === 'AUTH_FAIL') {
            const recentFailures = this.events.filter(e =>
                e.type === 'AUTH_FAIL' &&
                e.source === newEvent.source &&
                (new Date() - e.timestamp) < 60000
            );

            if (recentFailures.length >= 5) {
                this.triggerAlert('AUTH_FAIL_BURST', newEvent.source, `5 failed attempts in 1m from ${newEvent.source}`);
            }
        }
    }

    triggerAlert(ruleId, source, msg) {
        // Avoid alert fatigue (debounce)
        const recent = this.alerts.find(a => a.ruleId === ruleId && a.source === source && (new Date() - a.timestamp) < 30000);
        if (recent) return;

        const alert = {
            id: Date.now(),
            timestamp: new Date(),
            ruleId,
            source,
            message: msg
        };
        this.alerts.push(alert);
        console.log(`\x1b[41m\x1b[37m [SECURITY ALERT] ${msg} \x1b[0m`);
    }

    getAlerts() {
        return this.alerts;
    }
}

module.exports = new SecurityMonitor();
