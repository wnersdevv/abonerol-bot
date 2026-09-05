'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { statusLabelTr, formatDate, formatRemainingTime, unconfiguredLabel } = require('../../utils/formatters');

/**
 * Kullanici abonelik paneli (madde 19). Discord Components V2 kullanir.
 * Butonlar: Yenile, Iptal Et, Detaylar, Planlar, Odeme, Yardim.
 */
function buildSubscriptionPanel({ subscriber, plan, discordId }) {
  const container = new ContainerBuilder();

  const hasSubscription = !!subscriber;
  const statusLine = hasSubscription ? statusLabelTr(subscriber.status) : unconfiguredLabel();
  const planLine = plan ? `⭐ **Plan:** ${plan.name}` : '⭐ **Plan:** Yok';
  const startedLine = hasSubscription ? `📅 **Baslangic:** ${formatDate(subscriber.startedAt)}` : '📅 **Baslangic:** -';
  const expiresLine = hasSubscription && subscriber.expiresAt
    ? `⏳ **Bitis:** ${formatDate(subscriber.expiresAt)} (${formatRemainingTime(subscriber.expiresAt)})`
    : '⏳ **Bitis:** -';
  const paymentLine = hasSubscription
    ? `💳 **Odeme durumu:** ${subscriber.lastPaymentId ? 'Odendi' : 'Odeme kaydi yok'}`
    : '💳 **Odeme durumu:** -';
  const autoRenewLine = hasSubscription ? `🔄 **Otomatik yenileme:** ${subscriber.autoRenew ? 'Acik' : 'Kapali'}` : '🔄 **Otomatik yenileme:** -';
  const trialLine = hasSubscription ? `🎁 **Deneme:** ${subscriber.trial ? 'Evet' : 'Hayir'}` : '🎁 **Deneme:** -';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `## 👤 Abonelik Panelim`,
        `<@${discordId}>`,
        '',
        `🟢 **Durum:** ${statusLine}`,
        planLine,
        startedLine,
        expiresLine,
        paymentLine,
        autoRenewLine,
        trialLine,
      ].join('\n')
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`abonelik:yenile:${discordId}`).setLabel('Yenile').setStyle(ButtonStyle.Success).setEmoji('🔄'),
    new ButtonBuilder().setCustomId(`abonelik:iptal:${discordId}`).setLabel('Iptal Et').setStyle(ButtonStyle.Danger).setEmoji('🛑').setDisabled(!hasSubscription),
    new ButtonBuilder().setCustomId(`abonelik:detay:${discordId}`).setLabel('Detaylar').setStyle(ButtonStyle.Secondary).setEmoji('📄')
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`abonelik:planlar:${discordId}`).setLabel('Planlar').setStyle(ButtonStyle.Primary).setEmoji('⭐'),
    new ButtonBuilder().setCustomId(`abonelik:odeme:${discordId}`).setLabel('Odeme').setStyle(ButtonStyle.Secondary).setEmoji('💳'),
    new ButtonBuilder().setCustomId(`abonelik:yardim:${discordId}`).setLabel('Yardim').setStyle(ButtonStyle.Secondary).setEmoji('❓')
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container, row1, row2],
  };
}

module.exports = { buildSubscriptionPanel };
