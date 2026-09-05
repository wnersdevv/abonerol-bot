'use strict';

const { getLogger } = require('../utils/logger');
const { isRetryableError } = require('../utils/errors');

/**
 * Bellek-ici concurrency/retry kuyrugu. Rol atama, bildirim gonderme, webhook
 * islemleri gibi Discord/DB'ye baskin islemler bu kuyruktan gecer (madde 10, 68, 69).
 *
 * Kalici olmayan bir kuyruktur: process yeniden baslarsa bellekteki bekleyen
 * isler kaybolabilir. Bu yuzden "onemli" retry gerektiren islemler basarisiz
 * oldugunda FailedJob koleksiyonuna da yazilir (bkz. handler'lardaki persistFailedJob
 * cagrilari) boylece madde 69'daki "failed job kaybetme" kurali saglanir.
 */
class TaskQueue {
  constructor({ concurrency = 3, maxAttempts = 5, backoffBaseMs = 5000 } = {}) {
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.backoffBaseMs = backoffBaseMs;
    this.pending = [];
    this.active = 0;
    this.logger = getLogger();
  }

  /**
   * @param {Function} taskFn - async () => any
   * @param {Object} options - { name, attempts, onExhausted(err) }
   */
  push(taskFn, options = {}) {
    return new Promise((resolve, reject) => {
      this.pending.push({
        taskFn,
        name: options.name || 'anonim-gorev',
        attempts: options.attempts || 0,
        maxAttempts: options.maxAttempts || this.maxAttempts,
        onExhausted: options.onExhausted || null,
        resolve,
        reject,
      });
      this._drain();
    });
  }

  _drain() {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift();
      this.active += 1;
      this._runItem(item).finally(() => {
        this.active -= 1;
        this._drain();
      });
    }
  }

  async _runItem(item) {
    try {
      const result = await item.taskFn();
      item.resolve(result);
    } catch (err) {
      item.attempts += 1;
      const retryable = isRetryableError(err);

      if (retryable && item.attempts < item.maxAttempts) {
        const delay = this.backoffBaseMs * Math.pow(2, item.attempts - 1);
        this.logger.warn(`Gorev basarisiz, yeniden denenecek: ${item.name}`, {
          attempt: item.attempts,
          maxAttempts: item.maxAttempts,
          delayMs: delay,
          error: err.message,
        });
        setTimeout(() => {
          this.pending.push(item);
          this._drain();
        }, delay);
        return;
      }

      this.logger.error(`Gorev nihai olarak basarisiz oldu: ${item.name}`, {
        attempts: item.attempts,
        error: err.message,
        retryable,
      });

      if (item.onExhausted) {
        try {
          await item.onExhausted(err, item.attempts);
        } catch (persistErr) {
          this.logger.error('Basarisiz gorev kaydi olusturulamadi.', { message: persistErr.message });
        }
      }

      item.reject(err);
    }
  }

  size() {
    return { pending: this.pending.length, active: this.active };
  }
}

let instance = null;

function initQueue(settings) {
  const cfg = (settings && settings.queue) || {};
  instance = new TaskQueue({
    concurrency: cfg.concurrency,
    maxAttempts: cfg.maxAttempts,
    backoffBaseMs: cfg.backoffBaseMs,
  });
  return instance;
}

function getQueue() {
  if (!instance) instance = new TaskQueue({});
  return instance;
}

module.exports = { TaskQueue, initQueue, getQueue };
