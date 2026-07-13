const fs = require('fs');
const path = require('path');
const pino = require('pino');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const fileTransport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: false,
    singleLine: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
    destination: path.join(LOG_DIR, 'combined.log'),
    mkdir: true,
  },
});

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
}, fileTransport);

module.exports = logger;