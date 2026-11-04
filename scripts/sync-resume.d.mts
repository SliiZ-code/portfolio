export function sanitizeResume(input: unknown): unknown;
export function resumeFromResponse(body: unknown): unknown;
export function cvPdfFile(lang: string): string;
export function assertWebResume(main: unknown, web: unknown): void;
export function assertPdf(bytes: Uint8Array): void;
export function fetchCvPdf(options: {
  id: string;
  main: unknown;
  baseUrl: string;
  key: string;
  fetchImpl?: typeof fetch;
}): Promise<Uint8Array>;
export function collectPdfs(
  jobs: { lang: string; id: string; main: unknown }[],
  options: { baseUrl: string; key: string; fetchImpl: typeof fetch },
): Promise<{ pdfs: Map<string, Uint8Array>; errors: string[] }>;
