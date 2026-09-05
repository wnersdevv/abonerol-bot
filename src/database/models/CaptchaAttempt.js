'use strict';

const { Schema, model } = require('mongoose');

/**
 * CAPTCHA deneme kaydi (doc-1 madde 19, doc-2 madde 48-49). Replay protection
 * icin nonce benzersizdir. Saglayici yapilandirilmamissa bu koleksiyon kullanilmaz.
 */
const CaptchaAttemptSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },
    provider: { type: String, enum: ['turnstile', 'hcaptcha', 'recaptcha'], required: true },

    nonce: { type: String, required: true, unique: true },
    success: { type: Boolean, default: false },
    errorCode: { type: String, default: null },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

CaptchaAttemptSchema.index({ guildId: 1, discordId: 1, createdAt: -1 });

module.exports = model('CaptchaAttempt', CaptchaAttemptSchema);
