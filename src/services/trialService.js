'use strict';

const { TrialUsage, Subscriber } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, ValidationError } = require('../utils/errors');
const { durationToMs } = require('../utils/validators');
const auditService = require('./auditService');

/**
 * Trial / deneme suresi sistemi (madde 16). Ayni kisinin tekrar tekrar trial
 * almasini TrialUsage koleksiyonu ile kalici olarak engeller (trial abuse detection).
 * Subscriber kaydi silinse dahi TrialUsage kaydi kalir.
 */
function requireDb() {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Trial islemleri kullanilamiyor.');
  }
}

async function isTrialEligible(guildId, discordId, plan) {
  requireDb();
  if (!plan.trialEnabled) return { eligible: false, reason: 'Bu planda deneme suresi aktif degil.' };

  const priorUsage = await TrialUsage.findOne({ guildId, discordId, planId: plan.planId });
  if (priorUsage) return { eligible: false, reason: 'Bu plan icin daha once deneme suresi kullanilmis.' };

  const activeSubscriber = await Subscriber.findOne({ guildId, discordId, status: { $in: ['active', 'trial'] } });
  if (activeSubscriber) return { eligible: false, reason: 'Zaten aktif bir aboneliginiz bulunuyor.' };

  return { eligible: true, reason: null };
}

async function startTrial(guildId, discordId, plan, actorId = null) {
  requireDb();
  const eligibility = await isTrialEligible(guildId, discordId, plan);
  if (!eligibility.eligible) {
    throw new ValidationError(eligibility.reason, { guildId, discordId, planId: plan.planId });
  }

  const trialMs = durationToMs(plan.trialDuration, plan.trialDurationUnit);
  const now = new Date();
  const trialExpiresAt = new Date(now.getTime() + trialMs);

  await TrialUsage.create({
    discordId,
    guildId,
    planId: plan.planId,
    usedAt: now,
    trialExpiresAt,
  });

  const subscriber = await Subscriber.findOneAndUpdate(
    { guildId, discordId },
    {
      $set: {
        planId: plan.planId,
        roleId: plan.roleId,
        status: 'trial',
        startedAt: now,
        expiresAt: trialExpiresAt,
        trial: true,
        trialStartedAt: now,
        trialExpiresAt,
        autoRenew: false,
        source: 'trial',
        lastNotifiedThresholds: [],
      },
    },
    { upsert: true, new: true }
  );

  await auditService.record({
    guildId,
    actorId: actorId || discordId,
    actorType: actorId ? 'user' : 'system',
    action: 'trial.started',
    targetType: 'Subscriber',
    targetId: discordId,
    details: { planId: plan.planId, trialExpiresAt },
  });

  return subscriber;
}

module.exports = { isTrialEligible, startTrial };
