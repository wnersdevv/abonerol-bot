'use strict';

const { getLogger } = require('../utils/logger');

/**
 * Merkezi zamanlayici. Tum periyodik job'lar buradan kaydedilir; boylece
 * duplicate interval / bellek sizintisi (madde 77) onlenir ve shutdown
 * sirasinda tum interval'lar tek noktadan temizlenir (madde 78, 86).
 */
class Scheduler {
  constructor() {
    this.tasks = new Map(); // name -> { intervalId, running }
    this.logger = getLogger();
  }

  register(name, intervalMs, handler) {
    if (this.tasks.has(name)) {
      this.logger.warn(`Zamanlayici gorevi zaten kayitli, tekrar kaydedilmeyecek: ${name}`);
      return;
    }
    if (!intervalMs || intervalMs <= 0) {
      this.logger.warn(`Zamanlayici gorevi devre disi (gecersiz interval): ${name}`);
      return;
    }

    const state = { running: false, intervalId: null, lastRunAt: null, lastError: null };

    const run = async () => {
      if (state.running) {
        this.logger.debug(`Onceki calisma hala surdugu icin atlandi: ${name}`);
        return;
      }
      state.running = true;
      try {
        await handler();
        state.lastError = null;
      } catch (err) {
        state.lastError = err.message;
        this.logger.error(`Zamanlanmis gorev hata verdi: ${name}`, { message: err.message });
      } finally {
        state.running = false;
        state.lastRunAt = new Date();
      }
    };

    state.intervalId = setInterval(run, intervalMs);
    if (state.intervalId.unref) state.intervalId.unref();
    this.tasks.set(name, state);
    this.logger.info(`Zamanlayici gorevi kaydedildi: ${name} (${intervalMs}ms)`);
  }

  async runNow(name) {
    const state = this.tasks.get(name);
    if (!state) throw new Error(`Bilinmeyen zamanlayici gorevi: ${name}`);
    return state;
  }

  getStatus() {
    const status = {};
    for (const [name, state] of this.tasks.entries()) {
      status[name] = { running: state.running, lastRunAt: state.lastRunAt, lastError: state.lastError };
    }
    return status;
  }

  stopAll() {
    for (const [name, state] of this.tasks.entries()) {
      clearInterval(state.intervalId);
      this.logger.info(`Zamanlayici gorevi durduruldu: ${name}`);
    }
    this.tasks.clear();
  }
}

let instance = null;

function initScheduler() {
  instance = new Scheduler();
  return instance;
}

function getScheduler() {
  if (!instance) instance = new Scheduler();
  return instance;
}

module.exports = { Scheduler, initScheduler, getScheduler };
