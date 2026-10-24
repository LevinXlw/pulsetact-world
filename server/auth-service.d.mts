import type { IncomingMessage, ServerResponse } from 'node:http';
export function createAuthService(options?: { sessionTtlMs?: number; now?: () => number }): {
  handler(request: IncomingMessage, response: ServerResponse, next?: () => void): void;
  requireSession(request: IncomingMessage, response: ServerResponse, next?: () => void): void;
  close(): void;
};
