export function sha(text: string): string;
export function needsTranslation(text: unknown): boolean;
export function tagsOf(html: unknown): string[];
export function sameTags(source: unknown, translated: unknown): boolean;
export function mapTranslatable<T>(data: T, fn: (text: string) => string): T;
export function translatableStrings(data: unknown): string[];
