'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const { formatCurrency, formatDuration } = require('../../utils/formatters');

/**
 * Plan karsilastirma paneli (madde 20). Plan secimi Select Menu ile yapilir.
 */
function buildPlansPanel({ plans, discordId }) {
  const container = new ContainerBuilder();

  if (!plans || plans.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## ⭐ Abonelik Planlari\n\nBu sunucuda su anda satin alinabilir aktif plan bulunmuyor.')
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const lines = ['## ⭐ Abonelik Planlari', ''];
  for (const plan of plans) {
    lines.push(
      `**${plan.name}**`,
      `💰 Fiyat: ${formatCurrency(plan.price, plan.currency)}`,
      `⏳ Sure: ${formatDuration(plan.duration, plan.durationUnit)}`,
      `🔖 Rol: <@&${plan.roleId}>`,
      `✨ Ozellikler: ${plan.features && plan.features.length ? plan.features.join(', ') : 'Belirtilmemis'}`,
      `🎁 Deneme: ${plan.trialEnabled ? `${formatDuration(plan.trialDuration, plan.trialDurationUnit)}` : 'Yok'}`,
      ''
    );
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder());

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`plan:sec:${discordId}`)
    .setPlaceholder('Bir plan secin...')
    .addOptions(
      plans.slice(0, 25).map((plan) => ({
        label: plan.name.slice(0, 100),
        description: `${formatCurrency(plan.price, plan.currency)} - ${formatDuration(plan.duration, plan.durationUnit)}`.slice(0, 100),
        value: plan.planId,
      }))
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);

  return { flags: MessageFlags.IsComponentsV2, components: [container, row] };
}

module.exports = { buildPlansPanel };
