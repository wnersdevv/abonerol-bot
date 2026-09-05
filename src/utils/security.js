'use strict';

const crypto = require('crypto');

/**
 * Idempotency anahtari uretir. Ayni girdi (event tipi + benzersiz kaynak id) icin
 * her zaman ayni anahtari uretir, boylece webhook/renewal/rol atama gibi
 * islemler iki kere islenmez (madde 67).
 */
function buildIdempotencyKey(namespace, ...parts) {
  const raw = [namespace, ...parts].filter((p) => p !== undefined && p !== null).join(':');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Webhook imzasini HMAC-SHA256 ile dogrular. Payment provider'a gore secret farkli olabilir.
 * secret bos ise (provider yapilandirilmamissa) dogrulama basarisiz sayilir - fake onay verilmez.
 */
function verifyWebhookSignature({ payload, signature, secret }) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const signatureBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  } catch (err) {
    return false;
  }
}

/**
 * Loglarda / hata mesajlarinda gorunmemesi gereken hassas alanlari maskeler.
 */
function maskSensitive(value) {
  if (!value) return value;
  const str = String(value);
  if (str.length <= 4) return '***';
  return `${str.slice(0, 2)}***${str.slice(-2)}`;
}

/**
 * Basit girdi temizleme - Discord mesaj/embed alanlarina yansiyacak kullanici
 * girdilerinde kontrol karakterlerini ve asiri uzunlugu sinirlar.
 */
function sanitizeText(input, maxLength = 500) {
  if (typeof input !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return cleaned.slice(0, maxLength);
}

function generateSecureId(prefix = '') {
  const id = crypto.randomBytes(12).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}

module.exports = {
  buildIdempotencyKey,
  verifyWebhookSignature,
  maskSensitive,
  sanitizeText,
  generateSecureId,
};
