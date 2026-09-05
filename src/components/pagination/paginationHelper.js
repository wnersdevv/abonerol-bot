'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Genel amacli sayfalama yardimcisi (madde: Pagination). Liste tabanli
 * goruntulemelerde (abonelik gecmisi, loglar, plan listesi vb.) kullanilir.
 */
function paginate(items, page, pageSize = 10) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return { pageItems, currentPage: safePage, totalPages, totalItems: items.length };
}

function buildPaginationRow(namespace, contextId, currentPage, totalPages) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${namespace}:sayfa:${contextId}:${currentPage - 1}`)
      .setLabel('◀ Onceki')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`${namespace}:sayfabilgi:${contextId}`)
      .setLabel(`${currentPage} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${namespace}:sayfa:${contextId}:${currentPage + 1}`)
      .setLabel('Sonraki ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages)
  );
  return row;
}

module.exports = { paginate, buildPaginationRow };
