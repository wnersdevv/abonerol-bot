'use strict';

const { YouTubeVerification, VerificationScan } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, ValidationError } = require('../utils/errors');
const { generateSecureId } = require('../utils/security');
const { getLogger } = require('../utils/logger');

const youtubeApiService = require('./youtubeApiService');
const geminiService = require('./geminiService');
const policyService = require('./verificationPolicyService');
const ruleEngine = require('./verificationRuleEngine');
const riskService = require('./verificationRiskService');
const roleService = require('./verificationRoleService');
const lockService = require('./verificationLockService');
const safeModeService = require('./verificationSafeModeService');
const auditService = require('./auditService');
const notificationService = require('./notificationService');

function requireDb() {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. YouTube dogrulama sistemi kullanilamiyor.');
  }
}

/**
 * Ana dogrulama orkestrasyonu (doc-1 madde 20 akisi, doc-2 madde 50-51 state machine).
 * Akis: kilit al -> kanal parse/API -> deterministik kural kontrolu -> risk skoru
 * -> (yapilandirilmissa) AI analizi -> nihai durum -> rol/seviye guncelle -> audit -> bildirim.
 *
 * Gercek API/AI cevabi olmadan hicbir asamada "dogrulandi" sonucu SAHTE uretilmez;
 * API basarisiz olursa state=ERROR ile acikca raporlanir (fail-safe, doc-2 madde 29-30).
 */
async function runVerification(discordClient, settings, guild, guildId, discordId, {
  channelInputRaw,
  scanType = 'manual',
  actorId = null,
}) {
  requireDb();
  const logger = getLogger();

  return lockService.withLock(guildId, discordId, 'verify', (settings.verification && settings.verification.lockTimeoutMs) || 600000, async () => {
    let record = await YouTubeVerification.findOne({ guildId, discordId });
    if (!record) {
      record = await YouTubeVerification.create({
        verificationId: generateSecureId('verif'),
        guildId,
        discordId,
        state: 'NOT_STARTED',
        status: 'pending',
      });
    }

    const previousState = record.state;
    const previousStatus = record.status;
    const policy = await policyService.getActivePolicy(guildId);

    // --- CHANNEL_PENDING / API_CHECKING ---
    record.state = 'CHANNEL_PENDING';
    await record.save();

    let parsedInput;
    let channelData;
    try {
      parsedInput = youtubeApiService.parseChannelInput(channelInputRaw || record.channelUrl || record.channelId);
      record.state = 'API_CHECKING';
      await record.save();
      channelData = await youtubeApiService.fetchChannelData(parsedInput, settings);
    } catch (err) {
      record.state = 'ERROR';
      record.status = 'error';
      record.failureReason = err.message;
      record.lastCheckedAt = new Date();
      await record.save();

      await logScan(guildId, discordId, record, scanType, policy.version, previousStatus, 'error', null, false, err.message);
      await auditService.record({
        guildId, actorId, actorType: actorId ? 'user' : 'scheduler',
        action: 'verification.api_error', targetType: 'YouTubeVerification', targetId: discordId,
        details: { message: err.message }, success: false, errorMessage: err.message,
      });

      throw err;
    }

    // --- RULE_CHECKING ---
    record.state = 'RULE_CHECKING';
    await record.save();

    const ruleResult = ruleEngine.evaluateRuleGroup(channelData, policy.ruleGroup);
    const dataHash = youtubeApiService.hashChannelData(channelData);
    const dataUnchanged = record.requirements && record.requirements.dataHash === dataHash;

    // --- AI_CHECKING (Smart Scan: veri degismediyse tekrar AI cagirma) ---
    record.state = 'AI_CHECKING';
    await record.save();

    let aiResult = { configured: false, valid: false, aiRisk: null, aiScore: null, aiReason: 'AI analizi yapilandirilmamis.' };
    if (geminiService.isConfigured(settings) && !dataUnchanged) {
      const anonymousOperationId = generateSecureId('op');
      aiResult = await geminiService.analyzeVerification(settings, {
        anonymousOperationId,
        channelData,
        previousChannelData: record.requirements && record.requirements.lastChannelData,
        dataHash,
      });
    }

    // --- Duplicate kanal kontrolu ---
    const duplicateOwner = await YouTubeVerification.findOne({
      guildId, channelId: channelData.channelId, discordId: { $ne: discordId }, status: { $in: ['passed', 'grace_period'] },
    });
    const duplicateDetected = !!duplicateOwner;

    const { riskScore, verificationScore, signals } = await riskService.calculateRiskScore(guildId, discordId, {
      channelData, ruleResult, aiResult, duplicateChannelDetected: duplicateDetected,
    });
    const riskClass = riskService.classifyRisk(riskScore, policy.riskThresholds);

    // --- Nihai durum karari (deterministik motor + guvenlik > AI) ---
    let finalStatus;
    let finalState;
    let failureReason = null;

    if (duplicateDetected && policy.duplicateChannelPolicy === 'DENY') {
      finalStatus = 'failed';
      finalState = 'FAILED';
      failureReason = 'Bu YouTube kanali bu sunucuda baska bir Discord hesabina bagli.';
    } else if (duplicateDetected && policy.duplicateChannelPolicy === 'MANUAL_REVIEW') {
      finalStatus = 'manual_review';
      finalState = 'MANUAL_REVIEW';
      failureReason = 'Kanal duplikasyon supheli - manuel inceleme gerekiyor.';
    } else if (!ruleResult.passed) {
      finalStatus = 'failed';
      finalState = 'FAILED';
      failureReason = 'Sunucu sartlari saglanmadi.';
    } else if (riskClass.level === 'review') {
      finalStatus = 'manual_review';
      finalState = 'MANUAL_REVIEW';
      failureReason = 'Risk skoru inceleme esiginde - manuel inceleme gerekiyor.';
    } else if (riskClass.level === 'high') {
      finalStatus = 'manual_review';
      finalState = 'MANUAL_REVIEW';
      failureReason = 'Yuksek risk tespit edildi - otomatik onay yerine manuel inceleme baslatildi.';
    } else {
      finalStatus = 'passed';
      finalState = 'PASSED';
    }

    // Kaybedilen sart -> grace period (onceden passed/grace_period ise)
    if (finalStatus === 'failed' && ['passed', 'grace_period'].includes(previousStatus)) {
      const graceMs = policy.gracePeriodMs || 21600000;
      finalStatus = 'grace_period';
      finalState = 'GRACE_PERIOD';
      record.gracePeriodStartedAt = record.gracePeriodStartedAt || new Date();
      record.gracePeriodExpiresAt = new Date(Date.now() + graceMs);
    } else if (finalStatus === 'passed') {
      record.gracePeriodStartedAt = null;
      record.gracePeriodExpiresAt = null;
    }

    Object.assign(record, {
      channelId: channelData.channelId,
      channelUrl: channelData.channelUrl,
      channelName: channelData.channelName,
      channelHandle: channelData.channelHandle,
      subscriberCount: channelData.subscriberCount,
      videoCount: channelData.videoCount,
      viewCount: channelData.viewCount,
      channelCreatedAt: channelData.channelCreatedAt,
      policyVersion: policy.version,
      requirements: { dataHash, lastChannelData: channelData, ruleResult: ruleResult.results },
      requirementsPassed: ruleResult.passed,
      status: finalStatus,
      state: finalState,
      confidence: verificationScore,
      scanType,
      scanSource: 'youtube_api',
      aiChecked: aiResult.valid,
      aiScore: aiResult.aiScore,
      aiRisk: aiResult.aiRisk,
      aiReason: aiResult.aiReason,
      aiRecommendation: aiResult.aiRecommendation,
      verificationScore,
      riskScore,
      failureReason,
      lastCheckedAt: new Date(),
      nextCheckAt: policy.autoScanEnabled ? new Date(Date.now() + policy.scanIntervalMs) : null,
    });
    await record.save();

    await logScan(guildId, discordId, record, scanType, policy.version, previousStatus, finalStatus, dataHash, aiResult.valid, null);

    // --- Rol/seviye guncelleme (yalnizca gercek Discord guild baglami varsa) ---
    if (guild) {
      try {
        const newLevel = finalStatus === 'passed' || finalStatus === 'grace_period'
          ? await roleService.determineLevel(guildId, channelData)
          : null;
        const previousLevel = record.levelId ? { levelId: record.levelId, roleId: record.roleId } : null;

        if (newLevel || previousLevel) {
          await roleService.applyLevelChange(guild, guildId, discordId, {
            previousLevel,
            newLevel,
            actorType: actorId ? 'user' : 'scheduler',
          });
          record.levelId = newLevel ? newLevel.levelId : null;
          record.roleId = newLevel ? newLevel.roleId : null;
          await record.save();
        } else if (policy.roleId) {
          // Tek-seviye basit mod: policy.roleId dogrudan tanimliysa onu kullan.
          if (finalStatus === 'passed' || finalStatus === 'grace_period') {
            await require('./subscriberRoleService').assignRole(guild, discordId, policy.roleId, { guildId, actorType: actorId ? 'user' : 'scheduler' });
          } else if (finalStatus === 'failed') {
            await require('./subscriberRoleService').removeRole(guild, discordId, policy.roleId, { guildId, actorType: 'scheduler', reason: 'YouTube dogrulama sartlari saglanmadi' });
          }
          record.roleId = policy.roleId;
          await record.save();
        }
      } catch (roleErr) {
        logger.warn('Dogrulama sonrasi rol islemi basarisiz oldu.', { message: roleErr.message, guildId, discordId });
      }
    }

    await auditService.record({
      guildId, actorId, actorType: actorId ? 'user' : 'scheduler',
      action: `verification.${finalStatus}`, targetType: 'YouTubeVerification', targetId: discordId,
      details: { channelId: channelData.channelId, riskScore, verificationScore, signals },
    });

    if (discordClient) {
      await sendResultNotification(discordClient, record).catch((err) => logger.warn('Dogrulama bildirimi gonderilemedi.', { message: err.message }));
    }

    return record;
  });
}

async function logScan(guildId, discordId, record, scanType, policyVersion, resultBefore, resultAfter, apiDataHash, aiInvoked, error) {
  if (!isDatabaseReady()) return;
  await VerificationScan.create({
    guildId, discordId, verificationId: record.verificationId,
    scanType, policyVersion, resultBefore, resultAfter, apiDataHash, aiInvoked, error,
  });
}

async function sendResultNotification(discordClient, record) {
  const messages = {
    passed: '🟢 YouTube kanal doğrulamanız başarılı oldu.',
    failed: `🔴 YouTube kanal doğrulamanız başarısız oldu.${record.failureReason ? `\nNeden: ${record.failureReason}` : ''}`,
    grace_period: `🟡 YouTube kanalınız artık şartları sağlamıyor. ${record.gracePeriodExpiresAt ? `Şartları yeniden sağlamak için süreniz: ${new Date(record.gracePeriodExpiresAt).toLocaleString('tr-TR')}` : ''}`,
    manual_review: '🟠 Doğrulamanız manuel inceleme kuyruğuna alındı.',
  };
  const message = messages[record.status];
  if (!message) return;
  await notificationService.sendDm(discordClient, record.discordId, message);
}

async function getVerification(guildId, discordId) {
  requireDb();
  return YouTubeVerification.findOne({ guildId, discordId });
}

async function getScanHistory(guildId, discordId, limit = 10) {
  requireDb();
  return VerificationScan.find({ guildId, discordId }).sort({ createdAt: -1 }).limit(limit);
}

module.exports = { runVerification, getVerification, getScanHistory };
