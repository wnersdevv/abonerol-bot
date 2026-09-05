'use strict';

const { Schema, model } = require('mongoose');

/**
 * Gemini AI analiz sonucu (doc-1 madde 11-15, doc-2 madde 9-12). AI yalnizca
 * analiz dondurur; karar motoru degildir. Gemini yapilandirilmamissa hic
 * kayit olusturulmaz (fake AI sonucu uretilmez).
 */
const AIAnalysisSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    verificationId: { type: String, required: true, index: true },

    model: { type: String, required: true },
    aiScore: { type: Number, default: null },
    aiRisk: { type: String, enum: ['low', 'medium', 'high'], default: null },
    aiReason: { type: String, default: null },
    aiRecommendation: { type: String, default: null },

    inputDataHash: { type: String, default: null },
    valid: { type: Boolean, default: true },
    rejectionReason: { type: String, default: null },

    analyzedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AIAnalysisSchema.index({ guildId: 1, verificationId: 1, createdAt: -1 });

module.exports = model('AIAnalysis', AIAnalysisSchema);
