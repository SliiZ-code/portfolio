export function phoneNeedle(phone: unknown): string;
export function holdsPhone(value: unknown, phone: unknown): boolean;
export function assertNoPhone(value: unknown, phone: unknown, label: string): void;
export function assertPdf(bytes: Uint8Array): void;
export function pdfHoldsPhone(bytes: Uint8Array, phone: unknown): boolean;
