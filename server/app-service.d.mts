import type { IncomingMessage, ServerResponse } from 'node:http';
export function createAppService(options?: { storagePath?: string | null }): {
  handler(request: IncomingMessage, response: ServerResponse, next?: () => void): void;
  close(): Promise<void>;
};
