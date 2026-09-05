'use strict';

const { Schema, model } = require('mongoose');

/**
 * Basarisiz job kaydi (madde 69). Kaybolmamasi icin ayri koleksiyonda tutulur;
 * yonetici sistem panelinden gorebilir. Queue sistemi ile birlikte calisir.
 */
const FailedJobSchema = new Schema(
  {
    jobType: { type: String, required: true, index: true },
    guildId: { type: String, default: null, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },

    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastError: { type: String, default: null },
    nextRetryAt: { type: Date, default: null, index: true },

    status: { type: String, enum: ['pending_retry', 'exhausted', 'resolved'], default: 'pending_retry', index: true },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

FailedJobSchema.index({ status: 1, nextRetryAt: 1 });

module.exports = model('FailedJob', FailedJobSchema);
