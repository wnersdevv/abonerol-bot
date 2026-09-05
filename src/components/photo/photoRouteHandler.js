'use strict';

const photoModerationService = require('../../services/photoModerationService');
const { getLogger } = require('../../utils/logger');

/**
 * "foto" namespace'i altindaki Evet/Hayir buton etkilesimlerini yonetir.
 * Yalnizca yetkili (Manager+ veya staffMentionRoleIds icindeki) kullanicilar
 * onaylayabilir/reddedebilir.
 */
async function handle(interaction, ctx, action, params) {
  const [messageId] = params;
  const guildId = interaction.guildId;

  if (!photoModerationService.canReview(interaction.member, ctx.settings, interaction.guild)) {
    await interaction.reply({ content: '❌ Bu işlemi gerçekleştirmek için yetkiniz bulunmuyor.', ephemeral: true });
    return;
  }

  try {
    await interaction.deferUpdate();

    const reviewAction = action === 'onayla' ? 'approve' : action === 'reddet' ? 'reject' : null;
    if (!reviewAction) {
      await interaction.followUp({ content: '❌ Bilinmeyen işlem.', ephemeral: true });
      return;
    }

    await photoModerationService.applyReview(interaction.guild, messageId, {
      action: reviewAction,
      reviewerId: interaction.user.id,
    });

    const resultText = reviewAction === 'approve' ? '✅ Fotoğraf onaylandı.' : '❌ Fotoğraf reddedildi ve silindi.';
    await interaction.editReply({
      content: `${resultText} (İşlemi yapan: <@${interaction.user.id}>)`,
      embeds: interaction.message.embeds,
      components: [],
    });
  } catch (err) {
    getLogger().error('Foto inceleme islemi basarisiz.', { message: err.message });
    await interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
  }
}

module.exports = { handle };
