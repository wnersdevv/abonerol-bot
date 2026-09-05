'use strict';

const { Payment } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, ValidationError } = require('../utils/errors');
const { generateSecureId, buildIdempotencyKey } = require('../utils/security');
const auditService = require('./auditService');

/**
 * Odeme mimarisi (madde 15, 65, 66, 83). Gercek bir odeme saglayicisi
 * yapilandirilmamissa ("payment.provider" = "none" veya ilgili provider.enabled = false)
 * sistem SAHTE basari URETMEZ; bunun yerine "Yapilandirilmamis" durumunu doner.
 *
 * Provider entegrasyonu, gercek bir API anahtari saglandiginda calisacak sekilde
 * hazir tutulur (checkout/session olusturma, durum sorgulama). Canli anahtar
 * olmadan bu cagrilar denenmez.
 */

function getActiveProviderConfig(settings) {
  const provider = settings.payment && settings.payment.provider;
  if (!provider || provider === 'none') return { configured: false, provider: null, config: null };

  const config = settings.payment.providers && settings.payment.providers[provider];
  if (!config || !config.enabled) return { configured: false, provider, config: null };

  return { configured: true, provider, config };
}

/**
 * Stripe uzerinde bir checkout session olusturur. Gercek stripe secretKey
 * yapilandirilmadan bu fonksiyon cagrilmaz (initiatePayment icinde kontrol edilir).
 */
async function createStripeCheckoutSession({ config, plan, discordId, guildId }) {
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      mode: 'payment',
      'line_items[0][price_data][currency]': plan.currency.toLowerCase(),
      'line_items[0][price_data][product_data][name]': plan.name,
      'line_items[0][price_data][unit_amount]': String(Math.round(plan.price * 100)),
      'line_items[0][quantity]': '1',
      'metadata[discordId]': discordId,
      'metadata[guildId]': guildId,
      'metadata[planId]': plan.planId,
      success_url: 'https://discord.com/channels/@me',
      cancel_url: 'https://discord.com/channels/@me',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stripe checkout session olusturulamadi: ${response.status} ${body}`);
  }

  return response.json();
}

/**
 * Odeme baslatir. Provider yapilandirilmamissa configured:false doner ve
 * Payment kaydi olusturmaz - fake odeme kaydi asla uretilmez.
 */
async function initiatePayment(settings, { guildId, discordId, plan }) {
  const { configured, provider, config } = getActiveProviderConfig(settings);

  if (!configured) {
    return {
      configured: false,
      message: 'Odeme saglayicisi yapilandirilmamis. Lutfen yoneticiyle iletisime gecin.',
    };
  }

  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Odeme baslatilamiyor.');
  }

  const paymentId = generateSecureId('pay');
  const idempotencyKey = buildIdempotencyKey('payment.initiate', guildId, discordId, plan.planId, Date.now());

  const paymentRecord = await Payment.create({
    paymentId,
    discordId,
    guildId,
    planId: plan.planId,
    amount: plan.price,
    currency: plan.currency,
    provider,
    status: 'pending',
    idempotencyKey,
  });

  let providerSession = null;
  try {
    if (provider === 'stripe') {
      providerSession = await createStripeCheckoutSession({ config, plan, discordId, guildId });
      paymentRecord.providerTransactionId = providerSession.id;
      await paymentRecord.save();
    } else {
      throw new ValidationError(`Desteklenmeyen odeme saglayicisi: ${provider}`);
    }
  } catch (err) {
    paymentRecord.status = 'failed';
    await paymentRecord.save();
    await auditService.record({
      guildId,
      actorId: discordId,
      actorType: 'user',
      action: 'payment.initiate.failed',
      targetType: 'Payment',
      targetId: paymentId,
      success: false,
      errorMessage: err.message,
    });
    throw err;
  }

  await auditService.record({
    guildId,
    actorId: discordId,
    actorType: 'user',
    action: 'payment.initiate.success',
    targetType: 'Payment',
    targetId: paymentId,
    details: { provider, planId: plan.planId, amount: plan.price, currency: plan.currency },
  });

  return { configured: true, payment: paymentRecord, providerSession };
}

async function getPaymentByProviderTransactionId(provider, providerTransactionId) {
  if (!isDatabaseReady()) return null;
  return Payment.findOne({ provider, providerTransactionId });
}

module.exports = { getActiveProviderConfig, initiatePayment, getPaymentByProviderTransactionId };
