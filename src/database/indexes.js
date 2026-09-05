'use strict';

const models = require('./models');
const { getLogger } = require('../utils/logger');

/**
 * Mongoose sema tanimlarindaki index() cagrilarinin gercekten MongoDB'de
 * olusturulmasini garanti eder. Buyuk olcekte (1000+ guild, madde 76) sorgu
 * performansi icin kritik.
 */
async function ensureIndexes() {
  const logger = getLogger();
  const modelNames = Object.keys(models);
  const results = [];

  for (const name of modelNames) {
    try {
      await models[name].syncIndexes();
      results.push({ model: name, ok: true });
    } catch (err) {
      results.push({ model: name, ok: false, error: err.message });
      logger.error(`Index olusturma hatasi: ${name}`, { message: err.message });
    }
  }

  return results;
}

module.exports = { ensureIndexes };
