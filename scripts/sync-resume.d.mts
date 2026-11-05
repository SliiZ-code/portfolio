export function sanitizeResume(input: unknown): unknown;
export function resumeFromResponse(body: unknown): unknown;
export function cvPdfFile(lang: string): string;
export function assertWebResume(main: unknown, web: unknown): void;
export function assertPdf(bytes: Uint8Array): void;
export function webDataFrom(mainData: unknown): Record<string, any>;
export function dataOperations(
  current: unknown,
  target: Record<string, unknown>,
): ({ op: 'add'; path: string; value: unknown } | { op: 'remove'; path: string })[];
export function syncWebResume(options: {
  id: string;
  mainId?: string;
  main: unknown;
  baseUrl: string;
  key: string;
  lang?: string;
  fetchImpl?: typeof fetch;
}): Promise<unknown>;
export function fetchCvPdf(options: {
  id: string;
  mainId?: string;
  main: unknown;
  baseUrl: string;
  key: string;
  lang?: string;
  fetchImpl?: typeof fetch;
}): Promise<Uint8Array>;
export function collectPdfs(
  jobs: { lang: string; id: string; mainId?: string; main: unknown }[],
  options: { baseUrl: string; key: string; fetchImpl: typeof fetch },
): Promise<{ pdfs: Map<string, Uint8Array>; errors: string[] }>;
export function assertDistinctIds(mainIds: (string | undefined)[], webIds: (string | undefined)[]): void;
