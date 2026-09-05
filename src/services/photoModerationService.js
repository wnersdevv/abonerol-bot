'use strict';

const { PhotoSubmission } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');
const { generateSecureId } = require('../utils/security');
const geminiService = require('./geminiService');
const auditService = require('./auditService');
const { isManagerOrAbove } = require('../utils/permissions');

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;

/**
 * Abone-foto kanali moderasyon servisi (kullanicidan gelen istek):
 * "ayarlar.json'a kanal ID gir, o kanala sadece abone rolu olanlar foto atabilsin,
 * yapay zeka fotografi tarasin, manuel modda yetkilileri etiketleyip Evet/Hayir
 * butonu biraksin."
 *
 * Guvenlik/dogruluk kurallari (mevcut sistemle tutarli):
 *  - Yetkisiz kullanicinin mesaji silinir, fake basari uretilmez.
 *  - AI yapilandirilmamissa "Yapilandirilmamis" olarak isaretlenir, otomatik
 *    modda bile korlemesine onaylanmaz - guvenli varsayilan: yoneticiye birakilir.
 *  - AI tek basina silme karari vermez; esik degerleri (ayarlar.json) deterministiktir.
 */
function getConfig(settings) {
  return settings.photoVerification || { enabled: false };
}

function isPhotoChannel(settings, channelId) {
  const cfg = getConfig(settings);
  return !!(cfg.enabled && cfg.channelId && cfg.channelId === channelId);
}

function hasRequiredRole(member, settings) {
  const cfg = getConfig(settings);
  if (!cfg.requiredRoleId) return true; // rol zorunlulugu yapilandirilmamissa herkese acik
  if (!member || !member.roles) return false;
  return member.roles.cache.has(cfg.requiredRoleId);
}

/**
 * Yetkisiz kullanicinin mesajini siler ve kisa sureli bir uyari birakir.
 */
async function rejectUnauthorizedMessage(message, settings) {
  const cfg = getConfig(settings);
  const logger = getLogger();

  if (!cfg.deleteUnauthorizedMessages) return { deleted: false };

  try {
    await message.delete();
  } catch (err) {
    logger.warn('Yetkisiz mesaj silinemedi.', { message: err.message, channelId: message.channelId });
    return { deleted: false, error: err.message };
  }

  try {
    const warning = await message.channel.send({
      content: `<@${message.author.id}> ❌ Bu kanala yalnızca <@&${cfg.requiredRoleId}> rolüne sahip aboneler fotoğraf gönderebilir.`,
    });
    setTimeout(() => warning.delete().catch(() => {}), cfg.unauthorizedWarningDeleteAfterMs || 8000);
  } catch (err) {
    logger.warn('Yetkisiz kullanici uyari mesaji gonderilemedi.', { message: err.message });
  }

  await auditService.record({
    guildId: message.guildId,
    actorId: message.author.id,
    actorType: 'user',
    action: 'photo.unauthorized_message_removed',
    targetType: 'PhotoSubmission',
    targetId: message.id,
    success: false,
    errorMessage: 'Kullanici gerekli role sahip degil.',
  });

  return { deleted: true };
}

async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gorsel indirilemedi: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') || 'image/png';
  return { base64: Buffer.from(arrayBuffer).toString('base64'), mimeType };
}

/**
 * Bir mesajdaki gorsel eklerini isler: AI analizi yapar, PhotoSubmission kaydi
 * olusturur ve moderationMode'a gore otomatik karar verir veya manuel inceleme
 * icin yetkilileri etiketleyen bir panel doner (mesaji gonderen tarafa birakilir).
 */
async function processMessageAttachments(message, settings) {
  const logger = getLogger();
  const cfg = getConfig(settings);
  const imageAttachments = [...message.attachments.values()].filter(
    (att) => (att.contentType && att.contentType.startsWith('image/')) || IMAGE_EXTENSIONS.test(att.name || '')
  );

  if (imageAttachments.length === 0) return [];

  const results = [];

  for (const attachment of imageAttachments) {
    let submission = null;
    let aiResult = { configured: false, valid: false, aiScore: null, aiRisk: null, aiReason: 'AI analizi yapilandirilmamis.' };

    try {
      if (geminiService.isConfigured(settings)) {
        const { base64, mimeType } = await fetchImageAsBase64(attachment.url);
        aiResult = await geminiService.analyzePhoto(settings, {
          anonymousOperationId: generateSecureId('photo-op'),
          imageBase64: base64,
          mimeType,
        });
      }
    } catch (err) {
      logger.warn('Foto AI analizi sirasinda hata olustu.', { message: err.message });
      aiResult = { configured: geminiService.isConfigured(settings), valid: false, aiScore: null, aiRisk: null, aiReason: 'Görsel analiz edilemedi.' };
    }

    if (isDatabaseReady()) {
      submission = await PhotoSubmission.create({
        guildId: message.guildId,
        discordId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
        imageUrl: attachment.url,
        moderationMode: cfg.moderationMode || 'otomatik',
        status: 'pending',
        aiChecked: aiResult.valid,
        aiScore: aiResult.aiScore,
        aiRisk: aiResult.aiRisk,
        aiReason: aiResult.aiReason,
      });
    }

    results.push({ attachment, submission, aiResult });
  }

  return results;
}

/**
 * Otomatik moddaki nihai karari deterministik esiklerle verir. AI yapilandirilmamis
 * veya cevap gecersizse KESINLIKLE otomatik onaylamaz - guvenli varsayim: pending
 * birakip yetkilileri bilgilendirir (sanki manuel moddaymis gibi davranir).
 */
function decideAutomatic(aiResult, settings) {
  const cfg = getConfig(settings);
  if (!aiResult.valid) {
    return { decision: 'needs_review', reason: 'AI analizi kullanılamadı, güvenlik gereği yönetici incelemesine bırakıldı.' };
  }
  const rejectThreshold = cfg.aiRiskRejectThreshold ?? 70;
  const reviewThreshold = cfg.aiRiskReviewThreshold ?? 40;

  if (aiResult.aiScore >= rejectThreshold) {
    return { decision: 'reject', reason: aiResult.aiReason };
  }
  if (aiResult.aiScore >= reviewThreshold) {
    return { decision: 'needs_review', reason: aiResult.aiReason };
  }
  return { decision: 'approve', reason: aiResult.aiReason };
}

async function applyReview(guild, submissionMessageId, { action, reviewerId, reason = null }) {
  if (!isDatabaseReady()) throw new Error('MongoDB baglantisi hazir degil.');

  const submission = await PhotoSubmission.findOne({ messageId: submissionMessageId });
  if (!submission) throw new Error('Fotograf kaydi bulunamadi.');

  submission.status = action === 'approve' ? 'approved' : 'rejected';
  submission.reviewerId = reviewerId;
  submission.reviewedAt = new Date();
  submission.reviewReason = reason;
  await submission.save();

  if (action === 'reject' && guild) {
    try {
      const channel = await guild.channels.fetch(submission.channelId);
      const originalMessage = await channel.messages.fetch(submission.messageId).catch(() => null);
      if (originalMessage) await originalMessage.delete().catch(() => {});
    } catch (err) {
      getLogger().warn('Reddedilen fotograf mesaji silinemedi.', { message: err.message });
    }
  }

  await auditService.record({
    guildId: submission.guildId,
    actorId: reviewerId,
    actorType: 'user',
    action: `photo.review.${action}`,
    targetType: 'PhotoSubmission',
    targetId: submission.messageId,
    details: { reason },
  });

  return submission;
}

function canReview(member, settings, guild) {
  const cfg = getConfig(settings);
  if (isManagerOrAbove(member, settings, guild)) return true;
  const staffIds = cfg.staffMentionRoleIds || [];
  return member && member.roles && staffIds.some((id) => member.roles.cache.has(id));
}

module.exports = {
  getConfig,
  isPhotoChannel,
  hasRequiredRole,
  rejectUnauthorizedMessage,
  processMessageAttachments,
  decideAutomatic,
  applyReview,
  canReview,
};
