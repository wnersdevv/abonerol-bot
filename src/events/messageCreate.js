'use strict';

const photoModerationService = require('../services/photoModerationService');
const { buildPhotoReviewMessage } = require('../components/photo/photoModerationPanel');
const { getLogger } = require('../utils/logger');

/**
 * Abone-foto kanali kapisi (madde: "ayarlar.json'a kanal ID gir, sadece abone
 * rolu olanlar foto atsin, AI tarasin, manuel modda yetkilileri etiketleyip
 * Evet/Hayir biraksin"). Yalnizca ayarlar.json -> photoVerification.enabled=true
 * ve mesaj o kanaldaysa devreye girer; digger tum mesajlar dokunulmadan gecer.
 */
function register(client, ctx) {
  const logger = getLogger();

  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot || !message.guild) return;

      const settings = ctx.settings;
      if (!photoModerationService.isPhotoChannel(settings, message.channelId)) return;

      const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);

      if (!photoModerationService.hasRequiredRole(member, settings)) {
        await photoModerationService.rejectUnauthorizedMessage(message, settings);
        return;
      }

      const results = await photoModerationService.processMessageAttachments(message, settings);
      if (results.length === 0) return;

      const cfg = photoModerationService.getConfig(settings);

      for (const { attachment, submission, aiResult } of results) {
        if (cfg.moderationMode === 'manuel') {
          const panelMessage = buildPhotoReviewMessage({
            authorId: message.author.id,
            messageId: message.id,
            imageUrl: attachment.url,
            aiResult,
            staffMentionRoleIds: cfg.staffMentionRoleIds,
          });
          await message.channel.send(panelMessage);
          continue;
        }

        // Otomatik mod
        const { decision, reason } = photoModerationService.decideAutomatic(aiResult, settings);

        if (decision === 'approve') {
          if (submission) {
            submission.status = 'approved';
            submission.reviewedAt = new Date();
            await submission.save();
          }
          await message.react('✅').catch(() => {});
        } else if (decision === 'reject') {
          if (submission) {
            submission.status = 'rejected';
            submission.reviewedAt = new Date();
            submission.reviewReason = reason;
            await submission.save();
          }
          await message.delete().catch(() => {});
          await message.channel.send({
            content: `<@${message.author.id}> ❌ Fotoğrafınız yapay zeka moderasyonu tarafından reddedildi.${reason ? `\nNeden: ${reason}` : ''}`,
          }).then((m) => setTimeout(() => m.delete().catch(() => {}), cfg.unauthorizedWarningDeleteAfterMs || 8000));
        } else {
          // needs_review - otomatik modda AI belirsiz/yapilandirilmamis, guvenli varsayim: yetkilileri etiketle
          const panelMessage = buildPhotoReviewMessage({
            authorId: message.author.id,
            messageId: message.id,
            imageUrl: attachment.url,
            aiResult,
            staffMentionRoleIds: cfg.staffMentionRoleIds,
          });
          await message.channel.send(panelMessage);
        }
      }
    } catch (err) {
      logger.error('Foto kanali mesaj isleme hatasi.', { message: err.message });
    }
  });
}

module.exports = { register };
