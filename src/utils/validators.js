'use strict';

const { ValidationError } = require('./errors');

const DURATION_UNITS = ['minute', 'hour', 'day', 'week', 'month', 'year'];
const SUBSCRIPTION_STATUSES = ['pending', 'active', 'trial', 'expired', 'cancelled', 'suspended', 'paused', 'failed'];

function isSnowflake(value) {
  return typeof value === 'string' && /^[0-9]{15,25}$/.test(value);
}

function assertSnowflake(value, fieldName) {
  if (!isSnowflake(value)) {
    throw new ValidationError(`${fieldName} gecerli bir Discord ID (snowflake) degil.`, { fieldName, value });
  }
}

function assertNonEmptyString(value, fieldName, maxLength = 200) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} bos olamaz.`, { fieldName });
  }
  if (value.length > maxLength) {
    throw new ValidationError(`${fieldName} en fazla ${maxLength} karakter olabilir.`, { fieldName });
  }
}

function assertPositiveNumber(value, fieldName) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new ValidationError(`${fieldName} pozitif bir sayi olmalidir.`, { fieldName, value });
  }
}

function assertDurationUnit(unit) {
  if (!DURATION_UNITS.includes(unit)) {
    throw new ValidationError(`Gecersiz sure birimi: ${unit}. Gecerli degerler: ${DURATION_UNITS.join(', ')}`, { unit });
  }
}

function assertSubscriptionStatus(status) {
  if (!SUBSCRIPTION_STATUSES.includes(status)) {
    throw new ValidationError(`Gecersiz abonelik durumu: ${status}`, { status });
  }
}

function assertPlanShape(plan) {
  assertNonEmptyString(plan.name, 'Plan adi');
  assertSnowflake(plan.roleId, 'Plan roleId');
  assertPositiveNumber(plan.price, 'Plan fiyati');
  assertNonEmptyString(plan.currency, 'Para birimi', 10);
  assertPositiveNumber(plan.duration, 'Plan suresi');
  assertDurationUnit(plan.durationUnit);
  if (plan.trialEnabled) {
    assertPositiveNumber(plan.trialDuration, 'Trial suresi');
  }
}

function durationToMs(duration, unit) {
  assertPositiveNumber(duration, 'duration');
  assertDurationUnit(unit);
  const multipliers = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  return duration * multipliers[unit];
}

module.exports = {
  DURATION_UNITS,
  SUBSCRIPTION_STATUSES,
  isSnowflake,
  assertSnowflake,
  assertNonEmptyString,
  assertPositiveNumber,
  assertDurationUnit,
  assertSubscriptionStatus,
  assertPlanShape,
  durationToMs,
};
