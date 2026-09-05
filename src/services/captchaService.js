'use strict';

const crypto = require('crypto');
const { CaptchaAttempt } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, ValidationError } = require('../utils/errors');
const { getLogger } = require('../utils/logger');

/**
 * CAPTCHA abstraction (doc-1 madde 19, doc-2 madde 48-49). Cloudflare Turnstile,
 * hCaptcha, reCAPTCHA destekler. Credential yoksa "Yapilandirilmamis" doner -
 * hicbir sekilde bypass edilmez veya sahte basari uretilmez.
 */

const VERIFY_ENDPOINTS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
};

function getActiveProvider(settings) {
  const provider = settings.captcha && settings.captcha.provider;
  if (!provider || provider === 'none') return { configured: false, provider: null, config: null };
  const config = settings.captcha.providers && settings.captcha.providers[provider];
  if (!config || !config.enabled || !config.secretKey) return { configured: false, provider, config: null };
  return { configured: true, provider, config };
}

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Cok fazla basarisiz denemede gecici kilit uygular (doc-2 madde 49) - kalici ban degil.
 */
async function isTemporarilyLocked(guildId, discordId, settings) {
  if (!isDatabaseReady()) return { locked: false };
  const maxAttempts = (settings.captcha && settings.captcha.maxFailedAttempts) || 5;
  const lockDurationMs = (settings.captcha && settings.captcha.lockDurationMs) || 900000;
  const since = new Date(Date.now() - lockDurationMs);

  const failedCount = await CaptchaAttempt.countDocuments({ guildId, discordId, success: false, createdAt: { $gte: since } });
  return { locked: failedCount >= maxAttempts, failedCount, maxAttempts };
}

/**
 * CAPTCHA token'ini saglayicinin siteverify endpoint'i uzerinden gercekten dogrular.
 * Credential yoksa cagrilmaz (initiateCaptchaCheck icinde kontrol edilir).
 */
async function verifyToken(provider, config, token, remoteIp) {
  const endpoint = VERIFY_ENDPOINTS[provider];
  const body = new URLSearchParams({ secret: config.secretKey, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  const response = await fetch(endpoint, { method: 'POST', body });
  if (!response.ok) {
    throw new ValidationError(`CAPTCHA dogrulama servisi hata dondurdu: ${response.status}`);
  }
  return response.json();
}

async function initiateCaptchaCheck(settings, guildId, discordId) {
  const { configured, provider } = getActiveProvider(settings);
  if (!configured) {
    return { configured: false, message: 'CAPTCHA yapilandirilmamis.' };
  }

  const lockStatus = await isTemporarilyLocked(guildId, discordId, settings);
  if (lockStatus.locked) {
    throw new ValidationError('Cok fazla basarisiz CAPTCHA denemesi nedeniyle gecici olarak kilitlisiniz. Lutfen daha sonra tekrar deneyin.');
  }

  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + 300000); // 5 dakika

  if (isDatabaseReady()) {
    await CaptchaAttempt.create({ guildId, discordId, provider, nonce, success: false, expiresAt });
  }

  return { configured: true, provider, nonce, expiresAt };
}

async function completeCaptchaCheck(settings, guildId, discordId, { nonce, token, remoteIp = null }) {
  const logger = getLogger();
  const { configured, provider, config } = getActiveProvider(settings);
  if (!configured) return { configured: false, success: false, message: 'CAPTCHA yapilandirilmamis.' };

  if (!isDatabaseReady()) throw new ConfigurationError('MongoDB baglantisi hazir degil, CAPTCHA dogrulanamiyor.');

  const attempt = await CaptchaAttempt.findOne({ guildId, discordId, nonce, provider });
  if (!attempt) throw new ValidationError('Gecersiz veya suresi dolmus CAPTCHA istegi.');
  if (attempt.expiresAt.getTime() < Date.now()) throw new ValidationError('CAPTCHA istegi zaman asimina ugradi, lutfen tekrar deneyin.');

  let result;
  try {
    result = await verifyToken(provider, config, token, remoteIp);
  } catch (err) {
    logger.warn('CAPTCHA dogrulama isteği basarisiz oldu.', { message: err.message });
    attempt.success = false;
    attempt.errorCode = 'provider_error';
    await attempt.save();
    return { configured: true, success: false, message: 'CAPTCHA dogrulanamadi, lutfen tekrar deneyin.' };
  }

  attempt.success = !!result.success;
  attempt.errorCode = result.success ? null : (result['error-codes'] || []).join(',') || 'unknown';
  await attempt.save();

  return { configured: true, success: !!result.success, message: result.success ? 'CAPTCHA dogrulandi.' : 'CAPTCHA dogrulamasi basarisiz.' };
}

module.exports = { getActiveProvider, initiateCaptchaCheck, completeCaptchaCheck, isTemporarilyLocked };
