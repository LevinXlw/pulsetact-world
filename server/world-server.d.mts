import type { IncomingMessage, ServerResponse } from 'node:http';

export function createWorldService(options?: { storagePath?: string | null }): {
  handler(request: IncomingMessage, response: ServerResponse, next?: () => void): void;
  close(): Promise<void>;
};
