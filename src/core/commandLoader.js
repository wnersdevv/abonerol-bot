'use strict';

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { getLogger } = require('../utils/logger');

/**
 * src/commands altindaki tum komut dosyalarini yukler. Her dosya
 * { data: SlashCommandBuilder, execute: async (interaction, ctx) => {} } seklinde export etmelidir.
 * Duplicate command ismi tespit edilirse (madde: no duplicate commands) hata firlatir.
 */
function loadCommandFiles(baseDir) {
  const logger = getLogger();
  const commands = new Map();
  const categories = fs.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const category of categories) {
    const categoryPath = path.join(baseDir, category.name);
    const files = fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'));

    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const commandModule = require(filePath);

      if (!commandModule || !commandModule.data || typeof commandModule.execute !== 'function') {
        logger.warn(`Gecersiz komut dosyasi atlandi (data/execute eksik): ${filePath}`);
        continue;
      }

      const commandName = commandModule.data.name;
      if (commands.has(commandName)) {
        throw new Error(`Duplicate komut tespit edildi: "${commandName}" (${filePath})`);
      }

      commands.set(commandName, commandModule);
      logger.debug(`Komut yuklendi: /${commandName} (${category.name}/${file})`);
    }
  }

  return commands;
}

async function registerSlashCommands(settings, commands) {
  const logger = getLogger();
  const token = settings.discord && settings.discord.token;
  const clientId = settings.discord && settings.discord.clientId;

  if (!token || !clientId) {
    logger.warn('Slash komutlari Discord API\'ye kaydedilemedi: token/clientId yapilandirilmamis.');
    return { ok: false, reason: 'discord.token veya discord.clientId eksik' };
  }

  const body = [...commands.values()].map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    await rest.put(Routes.applicationCommands(clientId), { body });
    logger.info(`${body.length} slash komutu global olarak kaydedildi.`);
    return { ok: true, count: body.length };
  } catch (err) {
    logger.error('Slash komutlari kaydedilirken hata olustu.', { message: err.message });
    return { ok: false, reason: err.message };
  }
}

module.exports = { loadCommandFiles, registerSlashCommands };
