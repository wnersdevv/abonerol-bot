'use strict';

const { AuditLog } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');

/**
 * Merkezi denetim (audit) kayit servisi. Tum kritik islemler (rol atama/kaldirma,
 * plan degisikligi, iptal, backup/restore vb.) buradan gecer (madde 7, 12, 63, 87).
 * MongoDB hazir degilse kaydi atlamaz, en azindan logger uzerinden iz birakir.
 */
async function record({
  guildId,
  actorId = null,
  actorType = 'system',
  action,
  targetType = null,
  targetId = null,
  details = {},
  success = true,
  errorMessage = null,
}) {
  const logger = getLogger();

  if (!isDatabaseReady()) {
    logger.warn(`[AUDIT - DB HAZIR DEGIL] ${action}`, { guildId, actorId, targetType, targetId, success });
    return null;
  }

  try {
    const entry = await AuditLog.create({
      guildId,
      actorId,
      actorType,
      action,
      targetType,
      targetId,
      details,
      success,
      errorMessage,
    });
    return entry;
  } catch (err) {
    logger.error('Audit kaydi olusturulamadi.', { message: err.message, action });
    return null;
  }
}

async function listForGuild(guildId, { limit = 25, action = null } = {}) {
  if (!isDatabaseReady()) return [];
  const query = { guildId };
  if (action) query.action = action;
  return AuditLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = { record, listForGuild };
