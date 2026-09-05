'use strict';

const { Schema, model } = require('mongoose');

/**
 * Abone-foto kanali gonderim kaydi. Kullanicinin ayarlar.json'da tanimli
 * fotograf kanaline attigi her gorsel burada izlenir - otomatik AI sonucu
 * veya manuel yonetici onay/red karari ile birlikte.
 */
const PhotoSubmissionSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true, unique: true, index: true },

    imageUrl: { type: String, required: true },

    moderationMode: { type: String, enum: ['otomatik', 'manuel'], required: true },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'ai_unavailable'],
      default: 'pending',
      index: true,
    },

    aiChecked: { type: Boolean, default: false },
    aiScore: { type: Number, default: null },
    aiRisk: { type: String, enum: ['low', 'medium', 'high', null], default: null },
    aiReason: { type: String, default: null },

    reviewerId: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    reviewReason: { type: String, default: null },
  },
  { timestamps: true }
);

PhotoSubmissionSchema.index({ guildId: 1, discordId: 1, createdAt: -1 });
PhotoSubmissionSchema.index({ guildId: 1, status: 1 });

module.exports = model('PhotoSubmission', PhotoSubmissionSchema);
