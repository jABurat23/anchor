const chalk = require('chalk');

const LEVELS = {
    INFO: { color: chalk.blue, label: '[INFO]' },
    SUCCESS: { color: chalk.green, label: '[ OK ]' },
    WARN: { color: chalk.yellow, label: '[WARN]' },
    ERROR: { color: chalk.red, label: '[ERR!]' },
    WS: { color: chalk.magenta, label: '[ WS ]' },
    DEVICE: { color: chalk.cyan, label: '[DEV ]' },
    SECURITY: { color: chalk.bgRed.white, label: '[SEC ]' }
};

function log(type, msg, details = '') {
    const time = new Date().toLocaleTimeString();
    const level = LEVELS[type] || LEVELS.INFO;
    const prefix = level.color(level.label);

    console.log(`${chalk.gray(time)} ${prefix} ${msg} ${details ? chalk.gray(details) : ''}`);
}

module.exports = { log };
