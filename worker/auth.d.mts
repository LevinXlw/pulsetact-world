export interface AuthStorage {
  get(key: string): Promise<any>;
  put(key: string, value: any): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(options?: { prefix?: string; limit?: number; startAfter?: string }): Promise<Map<string, any>>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}
export interface AuthContext {
  storage: AuthStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
export class AuthStore {
  constructor(ctx: AuthContext);
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}
