import type { WireError } from './protocol.js';

export class ConnectorError extends Error {
  constructor(public code: string, message: string, public details?: WireError['details']) { super(message); }
  toJSON(): WireError { return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) }; }
}
export function wireError(error: unknown): WireError {
  return error instanceof ConnectorError ? error.toJSON() : { code: 'INTERNAL_ERROR', message: 'The connector could not complete this operation.' };
}
