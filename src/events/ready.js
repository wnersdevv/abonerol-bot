'use strict';

const { getLogger } = require('../utils/logger');

function register(client) {
  client.once('clientReady', () => {
    getLogger().info(`WNERSDEV ULTIMATE bot hazir: ${client.user.tag} (${client.guilds.cache.size} sunucu)`);
  });
}

module.exports = { register };
