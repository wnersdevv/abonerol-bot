'use strict';

const { Guild } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError } = require('../utils/errors');
const { getCache } = require('../core/cache');

/**
 * Sunucuya ozel ayarlar servisi (madde 25, 26, 71 Feature Flags, 70 Maintenance Mode).
 * guildId ile tam izolasyon saglar - bir sunucudaki ayar diger sunucuyu etkilemez.
 */
function requireDb() {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Sunucu ayarlari kullanilamiyor.');
  }
}

async function getOrCreateGuildSettings(guildId, guildName = '') {
  requireDb();
  const cacheKey = `guild:${guildId}`;
  const cached = getCache().get(cacheKey);
  if (cached) return cached;

  let doc = await Guild.findOne({ guildId });
  if (!doc) {
    doc = await Guild.create({ guildId, name: guildName });
  }

  getCache().set(cacheKey, doc, 30000);
  return doc;
}

async function updateGuildSettings(guildId, updates) {
  requireDb();
  const doc = await Guild.findOneAndUpdate({ guildId }, { $set: updates }, { upsert: true, new: true });
  getCache().delete(`guild:${guildId}`);
  return doc;
}

async function setMaintenanceMode(guildId, enabled) {
  return updateGuildSettings(guildId, { maintenanceMode: enabled });
}

async function setFeatureFlag(guildId, flagName, value) {
  return updateGuildSettings(guildId, { [`featureFlags.${flagName}`]: value });
}

module.exports = { getOrCreateGuildSettings, updateGuildSettings, setMaintenanceMode, setFeatureFlag };
