export function sanitizeResume(input: unknown): any;
export function resumeFromResponse(body: unknown): any;
export function cvPdfFile(lang: string): string;
export const TEMP_PREFIX: string;
export function dataOperations(
  current: unknown,
  target: Record<string, unknown>,
): ({ op: 'add'; path: string; value: unknown } | { op: 'remove'; path: string })[];
export const PDF_METADATA: Record<string, Record<string, any>>;
export function pdfDataFrom(mainData: unknown, overrides?: Record<string, unknown>): Record<string, any>;
export function resumeIdFrom(env: Record<string, string | undefined>): string;
export function buildApi(options: {
  baseUrl: string;
  key: string;
  mainId: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): any;
export function cleanupLeftovers(options: { api: any; mainId: string; log?: (message: string) => void }): Promise<number>;
export function makePdf(options: {
  api: any;
  mainId: string;
  lang: string;
  source: unknown;
  phone: string;
  stamp: string;
  log?: (message: string) => void;
}): Promise<Uint8Array>;
export function fingerprintToPublish(result: { errors: string[]; en: unknown; fingerprint: string }): string | null;
export function runSync(options: {
  mainId: string;
  api: any;
  fingerprintKey: string;
  translators?: any[];
  cache?: any;
  stamp?: string;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}): Promise<{ fr: any; en: any; cache: any; complete: boolean; pdfs: Map<string, Uint8Array>; errors: string[]; fingerprint: string }>;
