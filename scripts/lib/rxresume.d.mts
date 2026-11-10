export interface RxApi {
  getResume(id: string): Promise<any>;
  listResumes(): Promise<any[]>;
  createResume(options: { name: string; slug: string }): Promise<string>;
  patchResume(id: string, operations: unknown[], expectedUpdatedAt?: string): Promise<any>;
  downloadPdf(id: string): Promise<Uint8Array>;
  removeResume(id: string): Promise<void>;
}
export function createApi(options: { baseUrl: string; key: string; fetchImpl?: typeof fetch }): RxApi;
