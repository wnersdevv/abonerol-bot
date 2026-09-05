'use strict';

const { Subscriber, Subscription } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, NotFoundError, ValidationError } = require('../utils/errors');
const { durationToMs } = require('../utils/validators');
const { generateSecureId } = require('../utils/security');
const planService = require('./planService');
const roleService = require('./subscriberRoleService');
const paymentService = require('./paymentService');
const auditService = require('./auditService');

function requireDb() {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Yenileme islemleri kullanilamiyor.');
  }
}

/**
 * Kullanici tarafindan manuel yenileme (madde 14: /abonelik yenile).
 * Kontroller: mevcut abonelik, plan, fiyat, odeme durumu, yeni expiration, payment verification.
 * Odeme saglayicisi yapilandirilmamissa gercek odeme alinamaz; bu durumda
 * odeme gerektirmeyen (ucretsiz/manuel onaylanan) planlar disinda yenileme
 * baslatilamaz ve durum acikca bildirilir.
 */
async function requestRenewal(settings, guild, guildId, discordId) {
  requireDb();
  const subscriber = await Subscriber.findOne({ guildId, discordId });
  if (!subscriber) throw new NotFoundError('Aktif bir aboneliginiz bulunmuyor.');

  const plan = await planService.getPlan(guildId, subscriber.planId);
  if (!plan.active) throw new ValidationError('Bu planin yenilenebilmesi icin aktif olmasi gerekir.');

  if (plan.price > 0) {
    const paymentResult = await paymentService.initiatePayment(settings, { guildId, discordId, plan });
    if (!paymentResult.configured) {
      return { requiresPayment: true, configured: false, message: paymentResult.message };
    }
    return { requiresPayment: true, configured: true, payment: paymentResult.payment, providerSession: paymentResult.providerSession };
  }

  // Ucretsiz plan - dogrudan yenile
  const renewed = await applyRenewal(guild, guildId, discordId, plan, { source: 'manual_free', actorId: discordId });
  return { requiresPayment: false, subscriber: renewed };
}

/**
 * Yenilemeyi gercekten uygular: yeni expiration hesaplar, rolu dogrular/yeniden atar,
 * Subscription gecmis kaydi olusturur.
 */
async function applyRenewal(guild, guildId, discordId, plan, { source = 'manual', paymentId = null, actorId = null, actorType = 'user' } = {}) {
  const subscriber = await Subscriber.findOne({ guildId, discordId });
  if (!subscriber) throw new NotFoundError('Abone bulunamadi.');

  const durationMs = durationToMs(plan.duration, plan.durationUnit);
  const base = subscriber.expiresAt && new Date(subscriber.expiresAt).getTime() > Date.now()
    ? new Date(subscriber.expiresAt).getTime()
    : Date.now();
  const newExpiresAt = new Date(base + durationMs);

  subscriber.status = 'active';
  subscriber.planId = plan.planId;
  subscriber.roleId = plan.roleId;
  subscriber.expiresAt = newExpiresAt;
  subscriber.trial = false;
  subscriber.lastPaymentId = paymentId;
  subscriber.totalPaid = (subscriber.totalPaid || 0) + (paymentId ? plan.price : 0);
  subscriber.lastNotifiedThresholds = [];
  await subscriber.save();

  if (guild) {
    await roleService.assignRole(guild, discordId, plan.roleId, { guildId, actorId, actorType });
  }

  await Subscription.create({
    subscriptionId: generateSecureId('sub'),
    discordId,
    guildId,
    planId: plan.planId,
    status: 'active',
    startedAt: new Date(),
    expiresAt: newExpiresAt,
    renewedAt: new Date(),
    paymentId,
    changeType: 'renewal',
  });

  await auditService.record({
    guildId,
    actorId: actorId || discordId,
    actorType,
    action: 'subscription.renewed',
    targetType: 'Subscriber',
    targetId: discordId,
    details: { planId: plan.planId, newExpiresAt, source },
  });

  return subscriber;
}

/**
 * Basarili odeme webhook'u sonrasi aboneligi aktive eder (madde 66, 67 - idempotency
 * Payment.status kontrolu ile paymentWebhookService tarafinda saglanir).
 */
async function activateFromPayment(payment) {
  requireDb();
  const plan = await planService.getPlan(payment.guildId, payment.planId);

  const subscriber = await Subscriber.findOne({ guildId: payment.guildId, discordId: payment.discordId });
  if (!subscriber) {
    // Ilk satin alma - grantSubscription akisiyla ayni mantik, guild nesnesi burada
    // mevcut olmayabilecegi icin (webhook context) rol atama islemi ayri bir Discord
    // baglamli job/servis tarafindan (roleSynchronizer) tamamlanir.
    await Subscriber.create({
      discordId: payment.discordId,
      guildId: payment.guildId,
      planId: plan.planId,
      roleId: plan.roleId,
      status: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + durationToMs(plan.duration, plan.durationUnit)),
      lastPaymentId: payment.paymentId,
      totalPaid: plan.price,
      currency: plan.currency,
      source: 'payment',
    });
    return;
  }

  await applyRenewal(null, payment.guildId, payment.discordId, plan, {
    source: 'payment',
    paymentId: payment.paymentId,
    actorType: 'webhook',
  });
}

module.exports = { requestRenewal, applyRenewal, activateFromPayment };
