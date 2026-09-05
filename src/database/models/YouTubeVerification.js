'use strict';

const { Schema, model } = require('mongoose');

/**
 * YouTube doğrulama kaydı (madde 9, doc-1). guildId+discordId ile izole edilir.
 * State machine (doc-2 madde 50-51) burada tutulur.
 */
const YouTubeVerificationSchema = new Schema(
  {
    verificationId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },

    channelId: { type: String, default: null, index: true },
    channelUrl: { type: String, default: null },
    channelName: { type: String, default: null },
    channelHandle: { type: String, default: null },

    subscriberCount: { type: Number, default: null },
    videoCount: { type: Number, default: null },
    viewCount: { type: Number, default: null },
    channelCreatedAt: { type: Date, default: null },

    policyVersion: { type: Number, default: 1 },
    requirements: { type: Schema.Types.Mixed, default: {} },
    requirementsPassed: { type: Boolean, default: false },

    state: {
      type: String,
      enum: [
        'NOT_STARTED', 'TERMS_PENDING', 'CAPTCHA_PENDING', 'CHANNEL_PENDING',
        'API_CHECKING', 'RULE_CHECKING', 'AI_CHECKING', 'MANUAL_REVIEW',
        'PASSED', 'FAILED', 'GRACE_PERIOD', 'SUSPENDED', 'TIMEOUT', 'ERROR',
      ],
      default: 'NOT_STARTED',
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'verifying', 'passed', 'failed', 'grace_period', 'manual_review', 'suspended', 'expired', 'error'],
      default: 'pending',
      index: true,
    },

    confidence: { type: Number, default: null },
    scanType: { type: String, enum: ['manual', 'automatic', 'retry', 'admin'], default: 'manual' },
    scanSource: { type: String, default: 'youtube_api' },

    aiChecked: { type: Boolean, default: false },
    aiScore: { type: Number, default: null },
    aiRisk: { type: String, enum: ['low', 'medium', 'high', null], default: null },
    aiReason: { type: String, default: null },
    aiRecommendation: { type: String, default: null },

    verificationScore: { type: Number, default: null },
    riskScore: { type: Number, default: null },

    gracePeriodStartedAt: { type: Date, default: null },
    gracePeriodExpiresAt: { type: Date, default: null },

    roleId: { type: String, default: null },
    levelId: { type: String, default: null },

    failureReason: { type: String, default: null },

    manualOverride: {
      active: { type: Boolean, default: false },
      reviewerId: { type: String, default: null },
      reason: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      setAt: { type: Date, default: null },
    },

    lastCheckedAt: { type: Date, default: null },
    nextCheckAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

YouTubeVerificationSchema.index({ guildId: 1, discordId: 1 }, { unique: true });
YouTubeVerificationSchema.index({ guildId: 1, channelId: 1 });
YouTubeVerificationSchema.index({ guildId: 1, status: 1 });
YouTubeVerificationSchema.index({ nextCheckAt: 1, status: 1 });

module.exports = model('YouTubeVerification', YouTubeVerificationSchema);
