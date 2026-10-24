import { createAuthService } from './auth-service.mjs';
import { createWorldService } from './world-server.mjs';

/** Identical auth boundary for Vite development, preview and the production server. */
export function createAppService(options) {
  const auth = createAuthService();
  const world = createWorldService(options);
  return {
    handler(request, response, next) {
      auth.handler(request, response, () => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const proceed = () => world.handler(request, response, next);
        if (pathname.startsWith('/api/')) auth.requireSession(request, response, proceed);
        else proceed();
      });
    },
    async close() { auth.close(); await world.close(); },
  };
}
