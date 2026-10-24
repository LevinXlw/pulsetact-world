import type { BrowserContext } from '@playwright/test';
export function authenticateContext(context: BrowserContext, baseURL?: string): Promise<void>;
