'use strict';

const { Schema, model } = require('mongoose');

/**
 * Tarama gecmisi (doc-1 madde 29, doc-2 madde 25). Retention policy ile
 * eskitilebilir (cleanup job); onemli state degisiklikleri AuditLog'da kalicidir.
 */
const VerificationScanSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },
    verificationId: { type: String, required: true, index: true },

    scanType: { type: String, enum: ['manual', 'automatic', 'retry', 'admin'], required: true },
    policyVersion: { type: Number, required: true },

    resultBefore: { type: String, default: null },
    resultAfter: { type: String, required: true },

    apiDataHash: { type: String, default: null },
    aiInvoked: { type: Boolean, default: false },

    error: { type: String, default: null },
  },
  { timestamps: true }
);

VerificationScanSchema.index({ guildId: 1, discordId: 1, createdAt: -1 });
VerificationScanSchema.index({ createdAt: 1 });

module.exports = model('VerificationScan', VerificationScanSchema);
