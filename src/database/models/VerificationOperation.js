'use strict';

const { Schema, model } = require('mongoose');

/**
 * MongoDB tabanli dagitik-guvenli operation lock (doc-1 madde 21, doc-2 madde 37, 52).
 * Ayni kullanici ayni anda birden fazla dogrulama baslatamaz. TTL index ile
 * lock timeout sonrasi otomatik temizlenir.
 */
const VerificationOperationSchema = new Schema(
  {
    lockKey: { type: String, required: true, unique: true, index: true }, // orn: verify:guildId:discordId
    guildId: { type: String, required: true },
    discordId: { type: String, required: true },
    operation: { type: String, required: true },
    acquiredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

VerificationOperationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('VerificationOperation', VerificationOperationSchema);
