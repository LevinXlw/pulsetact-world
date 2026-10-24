// Node-only browser test helper. Credentials are never added to a page script or browser storage.
import { FIXED_ACCOUNT } from '../server/auth-credentials.mjs';

export async function authenticateContext(context, baseURL = 'http://127.0.0.1:5186') {
  const response = await context.request.post(`${baseURL}/api/auth/login`, { data: FIXED_ACCOUNT });
  if (!response.ok()) throw new Error(`Browser test login failed (${response.status()}).`);
  await response.dispose();
}
