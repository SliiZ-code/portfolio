export interface RxApi {
  getResume(id: string): Promise<any>;
  listResumes(): Promise<any[]>;
  createResume(options: { name: string; slug: string }): Promise<string>;
  patchResume(id: string, operations: unknown[], expectedUpdatedAt?: string): Promise<any>;
  downloadPdf(id: string): Promise<Uint8Array>;
  removeResume(id: string): Promise<void>;
}
export const CHECKER_PAUSES_MS: readonly number[];
export const BUILD_PAUSES_MS: readonly number[];
export function createApi(options: {
  baseUrl: string;
  key: string;
  fetchImpl?: typeof fetch;
  protectedId?: string;
  timeoutMs?: number;
  retryPausesMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): RxApi;
