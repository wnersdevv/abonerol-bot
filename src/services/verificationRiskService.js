'use strict';

const { YouTubeVerification, VerificationReview } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');

/**
 * Deterministik risk/dogrulama skoru (doc-2 madde 7-8). AI sadece bir sinyal
 * girdisidir - hesaplama tamamen aciklanabilir ve tekrarlanabilirdir.
 * 0-100 arasi riskScore doner: dusuk skor = dusuk risk.
 */
async function calculateRiskScore(guildId, discordId, { channelData, ruleResult, aiResult, duplicateChannelDetected, isNewChannel }) {
  let risk = 0;
  const signals = [];

  if (!ruleResult.passed) {
    risk += 25;
    signals.push('Sartlar saglanmadi (+25)');
  }

  if (channelData.channelCreatedAt) {
    const ageDays = (Date.now() - new Date(channelData.channelCreatedAt).getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays < 30) {
      risk += 20;
      signals.push('Kanal yasi 30 gunden az (+20)');
    } else if (ageDays < 90) {
      risk += 10;
      signals.push('Kanal yasi 90 gunden az (+10)');
    }
  } else {
    risk += 5;
    signals.push('Kanal olusturulma tarihi bilinmiyor (+5)');
  }

  if (duplicateChannelDetected) {
    risk += 20;
    signals.push('Ayni kanal baska Discord hesabina bagli (+20)');
  }

  if (isDatabaseReady()) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentVerificationCount = await YouTubeVerification.countDocuments({
      guildId, discordId, updatedAt: { $gte: since },
    });
    if (recentVerificationCount > 5) {
      risk += 15;
      signals.push(`Son 24 saatte ${recentVerificationCount} dogrulama denemesi (+15)`);
    }

    const rejectedReviewCount = await VerificationReview.countDocuments({ guildId, discordId, action: 'reject' });
    if (rejectedReviewCount > 0) {
      risk += Math.min(15, rejectedReviewCount * 5);
      signals.push(`Gecmiste ${rejectedReviewCount} reddedilmis inceleme (+${Math.min(15, rejectedReviewCount * 5)})`);
    }
  }

  if (aiResult && aiResult.valid) {
    const aiRiskPoints = { low: 0, medium: 15, high: 30 }[aiResult.aiRisk] || 0;
    risk += aiRiskPoints;
    if (aiRiskPoints > 0) signals.push(`AI risk analizi: ${aiResult.aiRisk} (+${aiRiskPoints})`);
  }

  const riskScore = Math.max(0, Math.min(100, risk));
  const verificationScore = Math.max(0, 100 - riskScore);

  return { riskScore, verificationScore, signals };
}

function classifyRisk(riskScore, thresholds) {
  const t = thresholds || { lowMax: 30, mediumMax: 60, highMax: 85 };
  if (riskScore <= t.lowMax) return { level: 'low', label: '🟢 Dusuk Risk' };
  if (riskScore <= t.mediumMax) return { level: 'medium', label: '🟡 Orta Risk' };
  if (riskScore <= t.highMax) return { level: 'review', label: '🟠 Inceleme Gerekli' };
  return { level: 'high', label: '🔴 Yuksek Risk' };
}

module.exports = { calculateRiskScore, classifyRisk };
