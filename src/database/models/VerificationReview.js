'use strict';

const { Schema, model } = require('mongoose');

/**
 * Manuel inceleme kaydi (doc-1 madde 23-24, doc-2 madde 22-23). Kim, ne zaman,
 * hangi gerekcayla islem yapti - audit icin ayrica AuditLog'a da yazilir.
 */
const VerificationReviewSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    verificationId: { type: String, required: true, index: true },
    discordId: { type: String, required: true },

    reviewerId: { type: String, required: true },
    action: { type: String, enum: ['approve', 'reject', 'rescan', 'suspend'], required: true },
    reason: { type: String, default: null },
  },
  { timestamps: true }
);

VerificationReviewSchema.index({ guildId: 1, verificationId: 1, createdAt: -1 });

module.exports = model('VerificationReview', VerificationReviewSchema);
