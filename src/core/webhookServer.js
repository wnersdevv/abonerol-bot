'use strict';

const http = require('http');
const { getLogger } = require('../utils/logger');
const paymentWebhookService = require('../services/paymentWebhookService');

/**
 * Odeme saglayicilarindan gelen webhook isteklerini karsilayan minimal HTTP
 * sunucusu (madde 15, 67, 87). ayarlar.json -> payment.webhookServer.enabled
 * false ise hic baslatilmaz (varsayilan - webhook alacak public bir adres
 * yoksa gereksiz port acilmaz).
 */
function startWebhookServer(settings) {
  const logger = getLogger();
  const cfg = settings.payment && settings.payment.webhookServer;
  if (!cfg || !cfg.enabled) {
    logger.info('Webhook sunucusu devre disi (payment.webhookServer.enabled = false).');
    return null;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith(cfg.path || '/webhook')) {
      res.writeHead(404);
      res.end();
      return;
    }

    const provider = req.url.split('/').filter(Boolean).pop();
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const signatureHeader = req.headers['x-webhook-signature'] || req.headers['stripe-signature'] || '';
        const result = await paymentWebhookService.handleWebhook(settings, {
          provider,
          rawPayload: body,
          signatureHeader,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        logger.error('Webhook isleme hatasi.', { message: err.message });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  server.listen(cfg.port, () => {
    logger.info(`Webhook sunucusu dinliyor: port ${cfg.port}, yol ${cfg.path || '/webhook'}/:provider`);
  });

  return server;
}

module.exports = { startWebhookServer };
