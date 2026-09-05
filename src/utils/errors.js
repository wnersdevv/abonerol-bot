'use strict';

class AppError extends Error {
  constructor(code, message, { retryable = false, meta = {} } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = retryable;
    this.meta = meta;
  }
}

class ValidationError extends AppError {
  constructor(message, meta) {
    super('VALIDATION_ERROR', message, { retryable: false, meta });
    this.name = 'ValidationError';
  }
}

class PermissionError extends AppError {
  constructor(message, meta) {
    super('PERMISSION_DENIED', message, { retryable: false, meta });
    this.name = 'PermissionError';
  }
}

class NotFoundError extends AppError {
  constructor(message, meta) {
    super('NOT_FOUND', message, { retryable: false, meta });
    this.name = 'NotFoundError';
  }
}

class RoleAssignmentError extends AppError {
  constructor(message, meta) {
    super('ROLE_ASSIGNMENT_FAILED', message, { retryable: true, meta });
    this.name = 'RoleAssignmentError';
  }
}

class TransientError extends AppError {
  constructor(message, meta) {
    super('TRANSIENT_ERROR', message, { retryable: true, meta });
    this.name = 'TransientError';
  }
}

class ConfigurationError extends AppError {
  constructor(message, meta) {
    super('NOT_CONFIGURED', message, { retryable: false, meta });
    this.name = 'ConfigurationError';
  }
}

class IdempotencyConflictError extends AppError {
  constructor(message, meta) {
    super('IDEMPOTENCY_CONFLICT', message, { retryable: false, meta });
    this.name = 'IdempotencyConflictError';
  }
}

/**
 * Bilinen Discord.js / MongoDB hata kodlarina bakarak hatanin retry edilebilir olup olmadigini belirler.
 * Kural (madde 68):
 *  - Discord gecici hatalari (5xx, rate limit, ETIMEDOUT, ECONNRESET) -> retryable
 *  - MongoDB gecici hatalari (network, topology) -> retryable
 *  - Payment provider gecici hatalari -> retryable
 *  - Gecersiz girdi, izin reddi, gecersiz plan, kalici silinmis rol -> retryable degil
 */
function isRetryableError(err) {
  if (!err) return false;
  if (err instanceof AppError) return err.retryable;

  const transientDiscordCodes = [500, 502, 503, 504, 429];
  if (err.httpStatus && transientDiscordCodes.includes(err.httpStatus)) return true;
  if (err.status && transientDiscordCodes.includes(err.status)) return true;

  const transientNetworkCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'];
  if (err.code && transientNetworkCodes.includes(err.code)) return true;

  if (err.name === 'MongoNetworkError' || err.name === 'MongoNetworkTimeoutError' || err.name === 'MongoTopologyClosedError') {
    return true;
  }

  const permanentDiscordCodes = [10011, 10013, 50001, 50013, 50035];
  if (err.code && permanentDiscordCodes.includes(err.code)) return false;

  return false;
}

module.exports = {
  AppError,
  ValidationError,
  PermissionError,
  NotFoundError,
  RoleAssignmentError,
  TransientError,
  ConfigurationError,
  IdempotencyConflictError,
  isRetryableError,
};
