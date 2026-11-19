export interface TagProject {
  id: string;
  name: string;
  description: string;
}
export interface ProjectTagEntry {
  tags: string[];
  model: string;
  hash: string;
}
export interface TagCache {
  version: number;
  projects: Record<string, ProjectTagEntry>;
}
export const emptyTagCache: () => TagCache;
export function parseTagCache(text: string | undefined): TagCache;
export function serializeTagCache(cache: TagCache): string;
export function descriptionText(description: string): string;
export function buildTagPrompt(projects: TagProject[]): string;
export function generateProjectTags(options: {
  projects: TagProject[];
  cache?: TagCache;
  complete?: (prompt: string) => Promise<unknown>;
  model?: string;
  warn?: (message: string) => void;
  maxTags?: number;
}): Promise<{ cache: TagCache; total: number; reused: number; generated: number }>;
