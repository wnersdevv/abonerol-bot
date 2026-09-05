'use strict';

/**
 * Basit TTL tabanli in-memory cache. Discord API'yi spamlamamak icin (madde 10)
 * rol/uye/plan gibi sik erisilen verileri kisa sureli tutar.
 * Bellek sizintisini onlemek icin (madde 77) maxEntries siniri ve periyodik
 * temizleme mekanizmasi bulunur; process kapaninca interval durdurulur.
 */
class Cache {
  constructor({ ttlMs = 60000, maxEntries = 5000 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
    this.sweepInterval = setInterval(() => this._sweep(), Math.max(ttlMs, 30000));
    if (this.sweepInterval.unref) this.sweepInterval.unref();
  }

  _sweep() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }

  set(key, value, ttlMs) {
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + (ttlMs || this.ttlMs) });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  async wrap(key, ttlMs, producer) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await producer();
    this.set(key, value, ttlMs);
    return value;
  }

  destroy() {
    clearInterval(this.sweepInterval);
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

let instance = null;

function initCache(settings) {
  const cfg = (settings && settings.cache) || {};
  instance = new Cache({ ttlMs: cfg.ttlMs, maxEntries: cfg.maxEntries });
  return instance;
}

function getCache() {
  if (!instance) instance = new Cache({});
  return instance;
}

module.exports = { Cache, initCache, getCache };
