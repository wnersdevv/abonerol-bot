'use strict';

const { VerificationLevel } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError } = require('../utils/errors');
const { evaluateRuleGroup } = require('./verificationRuleEngine');
const roleService = require('./subscriberRoleService');
const safeModeService = require('./verificationSafeModeService');
const auditService = require('./auditService');
const { getLogger } = require('../utils/logger');

/**
 * Dogrulama sonucuna gore rol/seviye atamasi (doc-2 madde 4-6).
 * Kill switch (ROLE_ASSIGNMENT/ROLE_REMOVAL) veya Safe Mode aktifse
 * rol islemleri atlanir ve durum raporlanir - sessizce basarisiz olunmaz.
 */
async function determineLevel(guildId, channelData) {
  if (!isDatabaseReady()) throw new ConfigurationError('MongoDB baglantisi hazir degil.');

  const levels = await VerificationLevel.find({ guildId, active: true }).sort({ priority: -1 });
  for (const level of levels) {
    const result = evaluateRuleGroup(channelData, level.requirements);
    if (result.passed) return level;
  }
  return null;
}

/**
 * Kullanicinin dogrulama seviyesini gunceller: eski seviye rolu kaldirilir,
 * yeni seviye rolu verilir. Ayni anda birden fazla seviye rolu verilmez (doc-2 madde 5).
 */
async function applyLevelChange(guild, guildId, discordId, { previousLevel, newLevel, actorType = 'scheduler' }) {
  const logger = getLogger();

  if (previousLevel && (!newLevel || previousLevel.levelId !== newLevel.levelId)) {
    if (!safeModeService.isOperationAllowed(guildId, 'ROLE_REMOVAL')) {
      logger.warn(`ROLE_REMOVAL kill switch/safe mode aktif, eski seviye rolu kaldirilmadi: ${guildId}/${discordId}`);
    } else {
      await roleService.removeRole(guild, discordId, previousLevel.roleId, {
        guildId, actorType, reason: 'Dogrulama seviyesi degisti (eski seviye kaldirildi)',
      });
    }
  }

  if (newLevel && (!previousLevel || previousLevel.levelId !== newLevel.levelId)) {
    if (!safeModeService.isOperationAllowed(guildId, 'ROLE_ASSIGNMENT')) {
      logger.warn(`ROLE_ASSIGNMENT kill switch aktif, yeni seviye rolu verilmedi: ${guildId}/${discordId}`);
    } else {
      await roleService.assignRole(guild, discordId, newLevel.roleId, { guildId, actorType });
    }
  }

  await auditService.record({
    guildId,
    actorType,
    action: 'verification.level_changed',
    targetType: 'YouTubeVerification',
    targetId: discordId,
    details: {
      previousLevelId: previousLevel ? previousLevel.levelId : null,
      newLevelId: newLevel ? newLevel.levelId : null,
    },
  });

  return { previousLevel, newLevel };
}

async function listLevels(guildId) {
  if (!isDatabaseReady()) throw new ConfigurationError('MongoDB baglantisi hazir degil.');
  return VerificationLevel.find({ guildId }).sort({ priority: -1 });
}

module.exports = { determineLevel, applyLevelChange, listLevels };
