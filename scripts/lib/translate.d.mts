export interface Provider {
  name: string;
  model: string;
  translate(input: Record<string, string>): Promise<Record<string, unknown>>;
}
export interface Cache {
  version: number;
  entries: Record<string, { en: string; model: string }>;
}
export const DEFAULT_MODELS: { claude: string; gemini: string; openrouter: string };
export const CLAUDE_CODE_PACKAGE: string;
export function buildPrompt(input: Record<string, string>): string;
export function emptyCache(): Cache;
export function parseCache(text: string | undefined): Cache;
export function serializeCache(cache: Cache): string;
export function parseJsonObject(text: unknown): Record<string, unknown>;
export function validateTranslations(input: Record<string, string>, output: unknown, phone?: string): Record<string, string>;
export function translateStrings(options: {
  strings: string[];
  cache?: Cache;
  translators?: Provider[];
  phone?: string;
  warn?: (message: string) => void;
  maxChars?: number;
}): Promise<{ cache: Cache; complete: boolean }>;
export function claudeEnv(env: Record<string, string | undefined>): Record<string, string>;
export function claudeProvider(options?: any): Provider;
export function geminiProvider(options?: any): Provider;
export function openrouterProvider(options?: any): Provider;
export function findExecutable(name: string, pathValue?: string): string | null;
export function configuredTranslators(env: Record<string, string | undefined>, options?: any): Provider[];
