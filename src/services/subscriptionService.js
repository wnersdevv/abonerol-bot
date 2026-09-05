'use strict';

const { Subscriber, Subscription } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, ValidationError, NotFoundError, IdempotencyConflictError } = require('../utils/errors');
const { durationToMs } = require('../utils/validators');
const { generateSecureId, buildIdempotencyKey } = require('../utils/security');
const planService = require('./planService');
const roleService = require('./subscriberRoleService');
const auditService = require('./auditService');

function requireDb() {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Abonelik islemleri kullanilamiyor.');
  }
}

/**
 * Abonelik olusturulurken veri butunlugu kontrolleri (madde 63):
 * guild mevcut mu, user mevcut mu, plan aktif mi, role mevcut mu, duration gecerli mi.
 */
async function validateIntegrity(guild, discordId, plan) {
  if (!guild) throw new ValidationError('Sunucu (guild) baglami bulunamadi.');
  if (!plan) throw new ValidationError('Plan bulunamadi.');
  if (!plan.active) throw new ValidationError('Bu plan su anda aktif degil, satin alinamaz.');

  let member = guild.members.cache.get(discordId);
  if (!member) {
    try {
      member = await guild.members.fetch(discordId);
    } catch (err) {
      throw new ValidationError('Kullanici bu sunucuda bulunamadi.');
    }
  }

  const role = guild.roles.cache.get(plan.roleId);
  if (!role) throw new ValidationError('Plana bagli rol sunucuda bulunamadi. Yoneticiye bildirin.');

  durationToMs(plan.duration, plan.durationUnit); // gecersizse hata firlatir
}

/**
 * Yeni abonelik olusturur / mevcut aboneligi gunceller (satin alma, admin "ver" komutu,
 * odeme sonrasi aktivasyon icin ortak yol). Idempotency destekler.
 */
async function grantSubscription(guild, {
  discordId,
  guildId,
  planId,
  source = 'manual',
  paymentId = null,
  actorId = null,
  actorType = 'system',
  idempotencyKey = null,
}) {
  requireDb();
  const plan = await planService.getPlan(guildId, planId);
  await validateIntegrity(guild, discordId, plan);

  const key = idempotencyKey || buildIdempotencyKey('subscription.grant', guildId, discordId, planId, Date.now());
  const existingByKey = await Subscription.findOne({ idempotencyKey: key });
  if (existingByKey) {
    throw new IdempotencyConflictError('Bu islem zaten daha once gerceklestirilmis.', { idempotencyKey: key });
  }

  const now = new Date();
  const durationMs = durationToMs(plan.duration, plan.durationUnit);
  const expiresAt = new Date(now.getTime() + durationMs);

  const subscriptionId = generateSecureId('sub');
  const subscriptionRecord = await Subscription.create({
    subscriptionId,
    discordId,
    guildId,
    planId,
    status: 'active',
    startedAt: now,
    expiresAt,
    paymentId,
    changeType: source === 'payment' ? 'renewal' : 'new',
    idempotencyKey: key,
  });

  const subscriber = await Subscriber.findOneAndUpdate(
    { guildId, discordId },
    {
      $set: {
        planId,
        roleId: plan.roleId,
        status: 'active',
        startedAt: now,
        expiresAt,
        trial: false,
        autoRenew: plan.autoRenew,
        lastPaymentId: paymentId,
        source,
        lastNotifiedThresholds: [],
      },
      $inc: { totalPaid: paymentId ? plan.price : 0 },
      $setOnInsert: { currency: plan.currency },
    },
    { upsert: true, new: true }
  );

  await roleService.assignRole(guild, discordId, plan.roleId, { guildId, actorId, actorType });

  await auditService.record({
    guildId,
    actorId: actorId || discordId,
    actorType,
    action: 'subscription.granted',
    targetType: 'Subscriber',
    targetId: discordId,
    details: { planId, expiresAt, source },
  });

  return { subscriber, subscription: subscriptionRecord };
}

/**
 * Yonetici tarafindan aboneligin suresini uzatir (madde 22: /abonelik uzat, /abonelik sure).
 */
async function extendSubscription(guildId, discordId, extraDuration, extraDurationUnit, actorId) {
  requireDb();
  const subscriber = await Subscriber.findOne({ guildId, discordId });
  if (!subscriber) throw new NotFoundError('Abone bulunamadi.');

  const extraMs = durationToMs(extraDuration, extraDurationUnit);
  const base = subscriber.expiresAt && new Date(subscriber.expiresAt).getTime() > Date.now()
    ? new Date(subscriber.expiresAt).getTime()
    : Date.now();

  subscriber.expiresAt = new Date(base + extraMs);
  if (subscriber.status === 'expired' || subscriber.status === 'cancelled') {
    subscriber.status = 'active';
  }
  await subscriber.save();

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'subscription.extended',
    targetType: 'Subscriber',
    targetId: discordId,
    details: { extraDuration, extraDurationUnit, newExpiresAt: subscriber.expiresAt },
  });

  return subscriber;
}

/**
 * Aboneligi iptal eder (madde 18). Davranis guild.subscriptionPolicy.cancelBehavior'a gore
 * "immediate" (aninda) veya "period_end" (donem sonu) olabilir.
 */
async function cancelSubscription(guild, guildId, discordId, { reason = null, actorId = null, cancelBehavior = 'period_end' } = {}) {
  requireDb();
  const subscriber = await Subscriber.findOne({ guildId, discordId });
  if (!subscriber) throw new NotFoundError('Abone bulunamadi.');

  subscriber.autoRenew = false;

  if (cancelBehavior === 'immediate') {
    subscriber.status = 'cancelled';
    subscriber.expiresAt = new Date();
    await subscriber.save();
    if (guild) {
      await roleService.removeRole(guild, discordId, subscriber.roleId, {
        guildId,
        actorId,
        actorType: 'user',
        reason: 'Abonelik iptal edildi (aninda)',
      });
    }
  } else {
    subscriber.status = 'active'; // donem sonuna kadar aktif kalir, expirationService iptali tamamlar
    await subscriber.save();
  }

  await Subscription.findOneAndUpdate(
    { discordId, guildId, status: { $in: ['active', 'trial'] } },
    { $set: { status: cancelBehavior === 'immediate' ? 'cancelled' : 'active', cancelledAt: new Date(), cancelReason: reason } },
    { sort: { createdAt: -1 } }
  );

  await auditService.record({
    guildId,
    actorId: actorId || discordId,
    actorType: actorId ? 'user' : 'system',
    action: 'subscription.cancelled',
    targetType: 'Subscriber',
    targetId: discordId,
    details: { cancelBehavior, reason },
  });

  return subscriber;
}

/**
 * Aboneligi duraklatir (madde 17). Kalan sureyi dondurur; guild rolPolicy'ye
 * gore rol korunabilir veya kaldirilabilir - burada varsayilan olarak rol korunur,
 * yalnizca sure sayaci durur.
 */
async function pauseSubscription(guildId, discordId, actorId) {
  requireDb();
  const subscriber = await Subscriber.findOne({ guildId, discordId });
  if (!subscriber) throw new NotFoundError('Abone bulunamadi.');
  if (subscriber.status !== 'active' && subscriber.status !== 'trial') {
    throw new ValidationError('Yalnizca aktif veya deneme suresindeki abonelikler duraklatilabilir.');
  }

  const remainingMs = subscriber.expiresAt ? Math.max(0, new Date(subscriber.expiresAt).getTime() - Date.now()) : 0;

  subscriber.status = 'paused';
  subscriber.pausedAt = new Date();
  subscriber.pauseRemainingMs = remainingMs;
  await subscriber.save();

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'subscription.paused',
    targetType: 'Subscriber',
    targetId: discordId,
    details: { remainingMs },
  });

  return subscriber;
}

async function resumeSubscription(guildId, discordId, actorId) {
  requireDb();
  const subscriber = await Subscriber.findOne({ guildId, discordId });
  if (!subscriber) throw new NotFoundError('Abone bulunamadi.');
  if (subscriber.status !== 'paused') {
    throw new ValidationError('Bu abonelik duraklatilmis durumda degil.');
  }

  const remainingMs = subscriber.pauseRemainingMs || 0;
  subscriber.status = subscriber.trial ? 'trial' : 'active';
  subscriber.expiresAt = new Date(Date.now() + remainingMs);
  subscriber.pausedAt = null;
  subscriber.pauseRemainingMs = null;
  await subscriber.save();

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'subscription.resumed',
    targetType: 'Subscriber',
    targetId: discordId,
    details: { newExpiresAt: subscriber.expiresAt },
  });

  return subscriber;
}

/**
 * Plan degistirme - upgrade/downgrade (madde 64). Eski rol kaldirilir, yeni rol
 * atanir, kalan sure/fiyat farki plan politikasina gore hesaplanabilir (prorate).
 */
async function changePlan(guild, guildId, discordId, newPlanId, actorId) {
  requireDb();
  const subscriber = await Subscriber.findOne({ guildId, discordId });
  if (!subscriber) throw new NotFoundError('Abone bulunamadi.');

  const oldPlan = await planService.getPlan(guildId, subscriber.planId).catch(() => null);
  const newPlan = await planService.getPlan(guildId, newPlanId);
  if (!newPlan.active) throw new ValidationError('Hedef plan aktif degil.');

  const changeType = oldPlan && newPlan.price > oldPlan.price ? 'upgrade' : 'downgrade';

  if (guild && oldPlan && oldPlan.roleId !== newPlan.roleId) {
    await roleService.removeRole(guild, discordId, oldPlan.roleId, { guildId, actorId, actorType: 'user', reason: 'Plan degisikligi' });
    await roleService.assignRole(guild, discordId, newPlan.roleId, { guildId, actorId, actorType: 'user' });
  }

  const remainingMs = subscriber.expiresAt ? Math.max(0, new Date(subscriber.expiresAt).getTime() - Date.now()) : 0;
  const newDurationMs = durationToMs(newPlan.duration, newPlan.durationUnit);
  const effectiveMs = newPlan.upgradeDowngradePolicy && newPlan.upgradeDowngradePolicy.prorate
    ? Math.max(remainingMs, 0) + newDurationMs
    : newDurationMs;

  subscriber.planId = newPlan.planId;
  subscriber.roleId = newPlan.roleId;
  subscriber.expiresAt = new Date(Date.now() + effectiveMs);
  await subscriber.save();

  await Subscription.create({
    subscriptionId: generateSecureId('sub'),
    discordId,
    guildId,
    planId: newPlan.planId,
    previousPlanId: oldPlan ? oldPlan.planId : null,
    status: 'active',
    startedAt: new Date(),
    expiresAt: subscriber.expiresAt,
    changeType,
  });

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: `subscription.plan_changed.${changeType}`,
    targetType: 'Subscriber',
    targetId: discordId,
    details: { oldPlanId: oldPlan ? oldPlan.planId : null, newPlanId: newPlan.planId },
  });

  return subscriber;
}

async function deleteSubscriberRecord(guildId, discordId, actorId) {
  requireDb();
  const subscriber = await Subscriber.findOneAndDelete({ guildId, discordId });
  if (!subscriber) throw new NotFoundError('Abone bulunamadi.');

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'subscription.deleted',
    targetType: 'Subscriber',
    targetId: discordId,
  });

  return subscriber;
}

async function getSubscriberStatus(guildId, discordId) {
  requireDb();
  return Subscriber.findOne({ guildId, discordId });
}

async function getSubscriptionHistory(guildId, discordId, limit = 10) {
  requireDb();
  return Subscription.find({ guildId, discordId }).sort({ createdAt: -1 }).limit(limit);
}

async function listActiveSubscribers(guildId = null) {
  requireDb();
  const query = { status: { $in: ['active', 'trial'] } };
  if (guildId) query.guildId = guildId;
  return Subscriber.find(query);
}

module.exports = {
  grantSubscription,
  extendSubscription,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  changePlan,
  deleteSubscriberRecord,
  getSubscriberStatus,
  getSubscriptionHistory,
  listActiveSubscribers,
  validateIntegrity,
};
