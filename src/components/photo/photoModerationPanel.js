'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Manuel inceleme paneli - abone-foto kanalina atilan bir gorsel icin yetkilileri
 * etiketleyip Evet/Hayir (Onayla/Reddet) butonu birakir.
 */
function buildPhotoReviewMessage({ authorId, messageId, imageUrl, aiResult, staffMentionRoleIds }) {
  const mentionText = (staffMentionRoleIds || []).map((id) => `<@&${id}>`).join(' ');

  const embed = new EmbedBuilder()
    .setTitle('🖼️ Yeni Fotoğraf İncelemesi Bekliyor')
    .setColor(0xffa500)
    .setDescription(`Gönderen: <@${authorId}>`)
    .setImage(imageUrl)
    .addFields({
      name: 'AI Analizi',
      value: aiResult && aiResult.valid
        ? `Risk: ${aiResult.aiRisk} (skor: ${aiResult.aiScore})\n${aiResult.aiReason || ''}`.slice(0, 1024)
        : 'AI analizi yapılandırılmamış veya kullanılamadı.',
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`foto:onayla:${messageId}`).setLabel('Evet').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`foto:reddet:${messageId}`).setLabel('Hayır').setEmoji('❌').setStyle(ButtonStyle.Danger)
  );

  return { content: mentionText || undefined, embeds: [embed], components: [row] };
}

module.exports = { buildPhotoReviewMessage };
