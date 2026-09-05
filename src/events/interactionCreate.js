'use strict';

const { getLogger } = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * Tum interaction turlerini (slash command, button, select menu, modal) tek
 * noktadan yonetir. Komutlar commandLoader ile yuklenen Map'ten, buton/select
 * etkilesimleri componentRouter uzerinden yonlendirilir.
 */
function register(client, { commands, componentRouter, ctx }) {
  const logger = getLogger();

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command) {
          logger.warn(`Bilinmeyen komut cagrisi: ${interaction.commandName}`);
          await interaction.reply({ content: '❌ Bu komut su anda kullanilamiyor.', ephemeral: true });
          return;
        }
        await command.execute(interaction, ctx);
        return;
      }

      if (interaction.isButton() || interaction.isAnySelectMenu()) {
        const handled = await componentRouter.route(interaction, ctx);
        if (!handled && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ Bu etkilesim artik gecerli degil.', ephemeral: true });
        }
        return;
      }
    } catch (err) {
      logger.error('Interaction islenirken hata olustu.', { message: err.message, type: interaction.type });
      const content = err instanceof AppError ? `🟡 ${err.message}` : '❌ İşlem sırasında beklenmeyen bir hata oluştu.';
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content });
        } else if (interaction.isRepliable && interaction.isRepliable()) {
          await interaction.reply({ content, ephemeral: true });
        }
      } catch (replyErr) {
        logger.error('Hata mesaji kullaniciya iletilemedi.', { message: replyErr.message });
      }
    }
  });
}

module.exports = { register };
