'use strict';

const { getLogger } = require('../utils/logger');

/**
 * Button / Select Menu / Modal interaction'larini customId on-ekine gore
 * ilgili handler'a yonlendirir. customId formati: "namespace:action:...params"
 * Ornek: "abonelik:yenile:PLAN123" veya "plan:sec:PLAN123"
 */
class ComponentRouter {
  constructor() {
    this.handlers = new Map(); // namespace -> handlerFn(interaction, ctx, action, params)
    this.logger = getLogger();
  }

  register(namespace, handlerFn) {
    if (this.handlers.has(namespace)) {
      throw new Error(`Duplicate component namespace kaydi: "${namespace}"`);
    }
    this.handlers.set(namespace, handlerFn);
    this.logger.debug(`Component namespace kaydedildi: ${namespace}`);
  }

  async route(interaction, ctx) {
    const customId = interaction.customId;
    if (!customId || !customId.includes(':')) {
      this.logger.warn(`Gecersiz customId formati: ${customId}`);
      return false;
    }

    const [namespace, action, ...params] = customId.split(':');
    const handler = this.handlers.get(namespace);
    if (!handler) {
      this.logger.warn(`Bilinmeyen component namespace: ${namespace}`);
      return false;
    }

    await handler(interaction, ctx, action, params);
    return true;
  }
}

let instance = null;

function initComponentRouter() {
  instance = new ComponentRouter();
  return instance;
}

function getComponentRouter() {
  if (!instance) instance = new ComponentRouter();
  return instance;
}

module.exports = { ComponentRouter, initComponentRouter, getComponentRouter };
