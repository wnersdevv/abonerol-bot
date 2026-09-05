'use strict';

const { YouTubeVerification, VerificationReview } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, NotFoundError, PermissionError } = require('../utils/errors');
const roleService = require('./subscriberRoleService');
const auditService = require('./auditService');
const policyService = require('./verificationPolicyService');

/**
 * Manuel inceleme islemleri (doc-1 madde 23-24, doc-2 madde 22-23, 58-60).
 * Onay/red/tekrar tara/askiya al. Kim/ne zaman/hangi gerekce ile audit'e yazilir.
 * Manuel override (kalici veya gecici) sadece yetkili kullanicilar tarafindan yapilabilir -
 * yetki kontrolu cagiran komut katmaninda yapilir, burada sadece islenir.
 */
function requireDb() {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Inceleme islemleri kullanilamiyor.');
  }
}

async function listPendingReviews(guildId, { category = 'pending', limit = 25 } = {}) {
  requireDb();
  const query = { guildId };

  if (category === 'pending') query.status = 'manual_review';
  else if (category === 'high_risk') { query.status = 'manual_review'; query.riskScore = { $gte: 60 }; }
  else if (category === 'api_conflict') { query.status = 'error'; }
  else if (category === 'duplicate') { query.status = 'manual_review'; query.failureReason = /duplik/i; }

  return YouTubeVerification.find(query).sort({ updatedAt: 1 }).limit(limit);
}

async function reviewVerification(guild, guildId, discordId, { action, reason, reviewerId }) {
  requireDb();
  const record = await YouTubeVerification.findOne({ guildId, discordId });
  if (!record) throw new NotFoundError('Dogrulama kaydi bulunamadi.');

  await VerificationReview.create({ guildId, verificationId: record.verificationId, discordId, reviewerId, action, reason });

  const policy = await policyService.getActivePolicy(guildId);

  switch (action) {
    case 'approve': {
      record.status = 'passed';
      record.state = 'PASSED';
      record.manualOverride = { active: true, reviewerId, reason, expiresAt: null, setAt: new Date() };
      record.gracePeriodStartedAt = null;
      record.gracePeriodExpiresAt = null;
      await record.save();
      if (guild && policy.roleId) {
        await roleService.assignRole(guild, discordId, policy.roleId, { guildId, actorId: reviewerId, actorType: 'user' });
      }
      break;
    }
    case 'reject': {
      record.status = 'failed';
      record.state = 'FAILED';
      record.failureReason = reason || 'Yonetici tarafindan reddedildi.';
      await record.save();
      if (guild && record.roleId) {
        await roleService.removeRole(guild, discordId, record.roleId, { guildId, actorId: reviewerId, actorType: 'user', reason: 'Manuel inceleme: reddedildi' });
      }
      break;
    }
    case 'suspend': {
      record.status = 'suspended';
      record.state = 'SUSPENDED';
      record.failureReason = reason || 'Yonetici tarafindan askiya alindi.';
      await record.save();
      if (guild && record.roleId) {
        await roleService.removeRole(guild, discordId, record.roleId, { guildId, actorId: reviewerId, actorType: 'user', reason: 'Manuel inceleme: askiya alindi' });
      }
      break;
    }
    case 'rescan': {
      record.status = 'pending';
      record.state = 'CHANNEL_PENDING';
      await record.save();
      break;
    }
    default:
      throw new NotFoundError(`Bilinmeyen inceleme islemi: ${action}`);
  }

  await auditService.record({
    guildId, actorId: reviewerId, actorType: 'user',
    action: `verification.manual_review.${action}`, targetType: 'YouTubeVerification', targetId: discordId,
    details: { reason },
  });

  return record;
}

/**
 * Gecici/kalici manuel override (doc-2 madde 58-60). Sadece Owner/Manager
 * cagirabilir - yetki kontrolu komut katmaninda yapilir.
 */
async function setManualOverride(guildId, discordId, { status, reviewerId, reason, durationMs = null }) {
  requireDb();
  const record = await YouTubeVerification.findOne({ guildId, discordId });
  if (!record) throw new NotFoundError('Dogrulama kaydi bulunamadi.');

  record.status = status;
  record.manualOverride = {
    active: true,
    reviewerId,
    reason,
    expiresAt: durationMs ? new Date(Date.now() + durationMs) : null,
    setAt: new Date(),
  };
  await record.save();

  await auditService.record({
    guildId, actorId: reviewerId, actorType: 'user',
    action: 'verification.manual_override_set', targetType: 'YouTubeVerification', targetId: discordId,
    details: { status, reason, durationMs },
  });

  return record;
}

module.exports = { listPendingReviews, reviewVerification, setManualOverride };
