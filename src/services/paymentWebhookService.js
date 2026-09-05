'use strict';

const { Payment } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { verifyWebhookSignature } = require('../utils/security');
const { ConfigurationError, ValidationError } = require('../utils/errors');
const paymentService = require('./paymentService');
const renewalService = require('./renewalService');
const auditService = require('./auditService');
const { getLogger } = require('../utils/logger');

/**
 * Gelen odeme webhook'larini gecerli imza + idempotency ile isler (madde 67, 87).
 * Imza dogrulanamazsa veya secret yapilandirilmamissa istek REDDEDILIR;
 * hicbir sekilde "basarili odeme" varsayilmaz.
 */
async function handleWebhook(settings, { provider, rawPayload, signatureHeader }) {
  const logger = getLogger();
  const { configured, config } = paymentService.getActiveProviderConfig(settings);

  if (!configured || config.provider !== provider) {
    // provider objesi config icinde provider adini tutmuyor, dogrudan settings'den kontrol edelim
  }

  const providerCfg = settings.payment && settings.payment.providers && settings.payment.providers[provider];
  if (!providerCfg || !providerCfg.enabled) {
    throw new ConfigurationError(`Odeme saglayicisi (${provider}) yapilandirilmamis, webhook islenemiyor.`);
  }

  const secret = providerCfg.webhookSecret;
  const isValid = verifyWebhookSignature({ payload: rawPayload, signature: signatureHeader, secret });

  if (!isValid) {
    logger.warn(`Webhook imza dogrulamasi basarisiz oldu: provider=${provider}`);
    throw new ValidationError('Webhook imzasi gecersiz, istek reddedildi.');
  }

  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil, webhook islenemiyor.');
  }

  let event;
  try {
    event = JSON.parse(rawPayload);
  } catch (err) {
    throw new ValidationError('Webhook govdesi gecerli JSON degil.');
  }

  const providerTransactionId = event.id || (event.data && event.data.object && event.data.object.id);
  if (!providerTransactionId) {
    throw new ValidationError('Webhook govdesinde islem kimligi bulunamadi.');
  }

  const payment = await paymentService.getPaymentByProviderTransactionId(provider, providerTransactionId);
  if (!payment) {
    logger.warn(`Webhook icin eslesen Payment kaydi bulunamadi: ${providerTransactionId}`);
    return { handled: false, reason: 'payment_not_found' };
  }

  // Idempotency: zaten islenmis (succeeded) bir odeme icin ikinci kez abonelik olusturma.
  if (payment.status === 'succeeded') {
    return { handled: true, alreadyProcessed: true };
  }

  const eventType = event.type || 'unknown';
  const isSuccessEvent = eventType.includes('succeeded') || eventType.includes('completed') || eventType.includes('payment_intent.succeeded');

  if (isSuccessEvent) {
    payment.status = 'succeeded';
    payment.paidAt = new Date();
    await payment.save();

    await auditService.record({
      guildId: payment.guildId,
      actorType: 'webhook',
      action: 'payment.webhook.succeeded',
      targetType: 'Payment',
      targetId: payment.paymentId,
      details: { provider, eventType },
    });

    await renewalService.activateFromPayment(payment);
    return { handled: true, alreadyProcessed: false, status: 'succeeded' };
  }

  payment.status = 'failed';
  await payment.save();

  await auditService.record({
    guildId: payment.guildId,
    actorType: 'webhook',
    action: 'payment.webhook.failed',
    targetType: 'Payment',
    targetId: payment.paymentId,
    details: { provider, eventType },
    success: false,
  });

  return { handled: true, alreadyProcessed: false, status: 'failed' };
}

module.exports = { handleWebhook };
