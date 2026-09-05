'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

/**
 * Yonetim paneli (madde 21). Kategoriler: Abonelikler, Planlar, Roller, Odemeler,
 * Bildirimler, Istatistik, Loglar, Sistem, Guvenlik, Backup.
 * Kategori secimi Select Menu ile yapilir; her secim componentRouter uzerinden
 * ilgili alt goruntulemeye yonlendirilir.
 */
const CATEGORIES = [
  { value: 'abonelikler', label: 'Abonelikler', emoji: '📋' },
  { value: 'planlar', label: 'Planlar', emoji: '⭐' },
  { value: 'roller', label: 'Roller', emoji: '🔖' },
  { value: 'odemeler', label: 'Odemeler', emoji: '💳' },
  { value: 'bildirimler', label: 'Bildirimler', emoji: '🔔' },
  { value: 'istatistik', label: 'Istatistik', emoji: '📊' },
  { value: 'loglar', label: 'Loglar', emoji: '📜' },
  { value: 'sistem', label: 'Sistem', emoji: '⚙️' },
  { value: 'guvenlik', label: 'Guvenlik', emoji: '🛡️' },
  { value: 'backup', label: 'Backup', emoji: '💾' },
];

function buildAdminPanel({ guildId, actorId, activeCategory = null, bodyText = null }) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      bodyText || ['## ⚙️ WNERSDEV Yonetim Paneli', '', 'Asagidaki menuden bir kategori secerek yonetim islemlerine baslayabilirsiniz.'].join('\n')
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`admin:kategori:${actorId}`)
    .setPlaceholder('Bir kategori secin...')
    .addOptions(
      CATEGORIES.map((cat) => ({
        label: cat.label,
        value: cat.value,
        emoji: cat.emoji,
        default: activeCategory === cat.value,
      }))
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);

  return { flags: MessageFlags.IsComponentsV2, components: [container, row] };
}

module.exports = { buildAdminPanel, CATEGORIES };
