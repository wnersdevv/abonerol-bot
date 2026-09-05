'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

class Logger {
  constructor(settings) {
    this.settings = settings || {};
    this.level = LEVELS[(this.settings.logging && this.settings.logging.level) || 'info'];
    this.toFile = !!(this.settings.logging && this.settings.logging.toFile);
    this.filePath = (this.settings.logging && this.settings.logging.filePath) || 'logs/wnersdev.log';

    if (this.toFile) {
      const dir = path.dirname(this.filePath);
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        // Dosya sistemine yazılamıyorsa dosya loglamayı sessizce kapat, konsol çalışmaya devam etsin.
        this.toFile = false;
      }
    }
  }

  _mask(meta) {
    if (!meta || typeof meta !== 'object') return meta;
    const sensitiveKeys = ['token', 'secret', 'secretKey', 'apiKey', 'webhookSecret', 'password', 'uri'];
    const clone = Array.isArray(meta) ? [...meta] : { ...meta };
    for (const key of Object.keys(clone)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        clone[key] = '***MASKED***';
      } else if (clone[key] && typeof clone[key] === 'object') {
        clone[key] = this._mask(clone[key]);
      }
    }
    return clone;
  }

  _write(levelName, message, meta) {
    if (LEVELS[levelName] > this.level) return;
    const timestamp = new Date().toISOString();
    const maskedMeta = meta ? this._mask(meta) : undefined;
    const line = `[${timestamp}] [${levelName.toUpperCase()}] ${message}${maskedMeta ? ' ' + JSON.stringify(maskedMeta) : ''}`;

    const consoleFn = levelName === 'error' ? console.error : levelName === 'warn' ? console.warn : console.log;
    consoleFn(line);

    if (this.toFile) {
      try {
        fs.appendFileSync(this.filePath, line + '\n');
      } catch (err) {
        // Dosyaya yazma başarısız olursa sessizce geç, konsol logu yeterlidir.
      }
    }
  }

  error(message, meta) { this._write('error', message, meta); }
  warn(message, meta) { this._write('warn', message, meta); }
  info(message, meta) { this._write('info', message, meta); }
  debug(message, meta) { this._write('debug', message, meta); }
}

let instance = null;

function initLogger(settings) {
  instance = new Logger(settings);
  return instance;
}

function getLogger() {
  if (!instance) instance = new Logger({});
  return instance;
}

module.exports = { initLogger, getLogger };
