'use strict';

const { VerificationOperation } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, ValidationError } = require('../utils/errors');

/**
 * MongoDB tabanli dagitik-guvenli lock (doc-1 madde 21, doc-2 madde 37, 52).
 * unique index (lockKey) sayesinde ayni anahtar icin ikinci acquire cagrisi
 * E11000 hatasi alir - bu race condition'a karsi guvenlidir.
 */
function buildLockKey(guildId, discordId, operation) {
  return `${operation}:${guildId}:${discordId}`;
}

async function acquireLock(guildId, discordId, operation, timeoutMs = 600000) {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil, kilit alinamiyor.');
  }

  const lockKey = buildLockKey(guildId, discordId, operation);
  const expiresAt = new Date(Date.now() + timeoutMs);

  try {
    const lock = await VerificationOperation.create({
      lockKey, guildId, discordId, operation, acquiredAt: new Date(), expiresAt,
    });
    return lock;
  } catch (err) {
    if (err.code === 11000) {
      throw new ValidationError('Zaten devam eden bir dogrulamaniz bulunuyor. Lutfen tamamlanmasini bekleyin.', { lockKey });
    }
    throw err;
  }
}

async function releaseLock(guildId, discordId, operation) {
  if (!isDatabaseReady()) return;
  const lockKey = buildLockKey(guildId, discordId, operation);
  await VerificationOperation.deleteOne({ lockKey });
}

/**
 * Bir islemi kilit altinda calistirir, islem bitince (basarili/basarisiz fark etmez)
 * kilidi serbest birakir. Timeout sonrasi TTL index zaten otomatik temizler (doc-2 madde 52).
 */
async function withLock(guildId, discordId, operation, timeoutMs, fn) {
  await acquireLock(guildId, discordId, operation, timeoutMs);
  try {
    return await fn();
  } finally {
    await releaseLock(guildId, discordId, operation);
  }
}

module.exports = { acquireLock, releaseLock, withLock, buildLockKey };
