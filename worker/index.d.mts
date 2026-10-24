export { AuthStore } from './auth.mjs';
export type WorkerEnvironment = {
  AUTH_STORE: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  ASSETS: { fetch(request: Request): Promise<Response> };
  CF_VERSION_METADATA?: { id: string };
};
declare const worker: { fetch(request: Request, env: WorkerEnvironment): Promise<Response> };
export default worker;
