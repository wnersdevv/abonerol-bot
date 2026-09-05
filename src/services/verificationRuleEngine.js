'use strict';

const { ValidationError } = require('../utils/errors');

/**
 * Esnek sart motoru (doc-2 madde 1). AND/OR/NOT ve karsilastirma operatorlerini
 * destekler. Sabit kodlanmis sartlar yerine VerificationPolicy.ruleGroup uzerinden
 * calisir - yonetici panelden degistirilebilir.
 *
 * ruleGroup formati:
 * { logic: 'AND' | 'OR' | 'NOT', conditions: [{ field, operator, value, valueMax }] }
 */

function evaluateCondition(channelData, condition) {
  const { field, operator, value, valueMax } = condition;
  const actual = channelData[field];

  if (actual === undefined || actual === null) {
    return { passed: false, field, operator, expected: value, actual: null, reason: `${field} verisi mevcut degil` };
  }

  let passed = false;
  switch (operator) {
    case 'gte': passed = actual >= value; break;
    case 'lte': passed = actual <= value; break;
    case 'gt': passed = actual > value; break;
    case 'lt': passed = actual < value; break;
    case 'eq': passed = actual === value; break;
    case 'neq': passed = actual !== value; break;
    case 'between': passed = actual >= value && actual <= valueMax; break;
    default:
      throw new ValidationError(`Bilinmeyen kural operatoru: ${operator}`);
  }

  return { passed, field, operator, expected: valueMax !== null && valueMax !== undefined ? [value, valueMax] : value, actual };
}

/**
 * Bir kural grubunu (AND/OR/NOT) gercek kanal verisine gore degerlendirir.
 * Deterministik ve aciklanabilir sonuc doner - hangi sartin gectigi/kaldigi belli olur.
 */
function evaluateRuleGroup(channelData, ruleGroup) {
  if (!ruleGroup || !ruleGroup.conditions || ruleGroup.conditions.length === 0) {
    return { passed: true, logic: 'AND', results: [] };
  }

  const results = ruleGroup.conditions.map((cond) => evaluateCondition(channelData, cond));

  let passed;
  switch (ruleGroup.logic) {
    case 'AND':
      passed = results.every((r) => r.passed);
      break;
    case 'OR':
      passed = results.some((r) => r.passed);
      break;
    case 'NOT':
      passed = !results.every((r) => r.passed);
      break;
    default:
      throw new ValidationError(`Bilinmeyen kural mantigi: ${ruleGroup.logic}`);
  }

  return { passed, logic: ruleGroup.logic, results };
}

module.exports = { evaluateCondition, evaluateRuleGroup };
