import { describe, expect, it } from 'vitest';
import { sha } from '../scripts/lib/strings.mjs';
import {
  buildTagPrompt,
  emptyTagCache,
  generateProjectTags,
  parseTagCache,
  serializeTagCache,
  type TagProject,
} from '../scripts/lib/project-tags.mjs';

const PROJECTS: TagProject[] = [
  { id: 'p1', name: 'Blink', description: '<p>Un jeu en C++ avec SFML</p>' },
  { id: 'p2', name: 'Thrive', description: '<p>Une application Flutter</p>' },
];

const hashOf = (project: TagProject) => sha(`${project.name}\n${project.description}`);
const cacheOf = (projects: Record<string, { tags: string[]; model: string; hash: string }>) => ({ version: 1, projects });

/** A provider that answers with `answer` and records the prompts it was sent. */
const fakeComplete = (answer: unknown, fail?: Error) => {
  const prompts: string[] = [];
  const complete = async (prompt: string) => {
    prompts.push(prompt);
    if (fail) throw fail;
    return answer;
  };
  return { prompts, complete };
};

const noop = () => {};

describe('parseTagCache and serializeTagCache', () => {
  it('starts empty when there is no file or the file is broken', () => {
    expect(parseTagCache(undefined)).toEqual(emptyTagCache());
    expect(parseTagCache('not json')).toEqual(emptyTagCache());
    expect(parseTagCache('{"version":2,"projects":{}}')).toEqual(emptyTagCache());
  });

  it('keeps well-formed entries only, and drops the others', () => {
    const parsed = parseTagCache(
      JSON.stringify({
        version: 1,
        projects: {
          p1: { tags: ['C++'], model: 'm', hash: 'h' },
          broken: null,
          nohash: { tags: ['Python'], model: 'm' },
          empty: { tags: [], model: '', hash: 'h2' },
        },
      }),
    );
    expect(Object.keys(parsed.projects).sort()).toEqual(['empty', 'p1']);
    expect(parsed.projects.p1).toEqual({ tags: ['C++'], model: 'm', hash: 'h' });
  });

  it('writes the same text whatever the order of the projects, sorted by id', () => {
    const a = cacheOf({
      p2: { tags: ['Flutter'], model: 'm', hash: 'b' },
      p1: { tags: ['C++'], model: 'm', hash: 'a' },
    });
    const b = cacheOf({
      p1: { tags: ['C++'], model: 'm', hash: 'a' },
      p2: { tags: ['Flutter'], model: 'm', hash: 'b' },
    });
    const text = serializeTagCache(a);
    expect(serializeTagCache(b)).toBe(text);
    expect(text.indexOf('"p1"')).toBeLessThan(text.indexOf('"p2"'));
    expect(text.endsWith('\n')).toBe(true);
    expect(parseTagCache(text)).toEqual(a);
  });
});

describe('buildTagPrompt', () => {
  it('names every project and its description', () => {
    const prompt = buildTagPrompt(PROJECTS);
    expect(prompt).toContain('"p1"');
    expect(prompt).toContain('Blink');
    expect(prompt).toContain('Un jeu en C++ avec SFML');
    expect(prompt).toContain('"p2"');
    expect(prompt).toContain('Une application Flutter');
    expect(prompt).toMatch(/verbatim/i);
    expect(prompt).toMatch(/Invent nothing/i);
    expect(prompt).toMatch(/only a JSON object/i);
  });
});

describe('generateProjectTags', () => {
  it('caches a valid answer, with the model and the hash of the French text', async () => {
    const { prompts, complete } = fakeComplete({ p1: ['C++', 'SFML'], p2: ['Flutter'] });
    const result = await generateProjectTags({ projects: PROJECTS, cache: emptyTagCache(), complete, model: 'tag-model', warn: noop });

    expect(prompts).toHaveLength(1);
    expect(result.cache.projects.p1).toEqual({ tags: ['C++', 'SFML'], model: 'tag-model', hash: hashOf(PROJECTS[0]) });
    // case does not matter, the description names Flutter
    expect(result.cache.projects.p2.tags).toEqual(['Flutter']);
    expect(result).toMatchObject({ total: 2, reused: 0, generated: 2 });
  });

  it('accepts a tag whose case differs from the description', async () => {
    const { complete } = fakeComplete({ p1: ['c++'], p2: ['flutter'] });
    const result = await generateProjectTags({ projects: PROJECTS, complete, warn: noop });
    expect(result.cache.projects.p1.tags).toEqual(['c++']);
    expect(result.cache.projects.p2.tags).toEqual(['flutter']);
  });

  it('rejects an invented tag, retries the batch once, and caches the second answer', async () => {
    let calls = 0;
    const answers = [{ p1: ['Rust'], p2: ['Flutter'] }, { p1: ['C++'], p2: ['Flutter'] }];
    const complete = async () => answers[calls++];
    const warnings: string[] = [];
    const result = await generateProjectTags({ projects: PROJECTS, complete, warn: (message) => warnings.push(message) });

    expect(calls).toBe(2);
    expect(result.cache.projects.p1.tags).toEqual(['C++']);
    expect(warnings.join('\n')).toMatch(/WARNING/);
    expect(warnings.join('\n')).toMatch(/retrying once/);
  });

  it('drops a project that is still invalid after the retry and keeps its previous entry', async () => {
    const previous = cacheOf({ p1: { tags: ['Python'], model: 'old', hash: 'stale' } });
    const { prompts, complete } = fakeComplete({ p1: ['Rust', 'Java'], p2: ['Flutter'] });
    const result = await generateProjectTags({ projects: PROJECTS, cache: previous, complete, warn: noop });

    expect(prompts).toHaveLength(2);
    // the invented tags are dropped, the stale entry stays so the next sync tries again
    expect(result.cache.projects.p1).toEqual({ tags: ['Python'], model: 'old', hash: 'stale' });
    expect(result.cache.projects.p2.tags).toEqual(['Flutter']);
    expect(result.generated).toBe(1);
  });

  it('drops the tags of a project without a previous entry when the answer stays invalid', async () => {
    const { complete } = fakeComplete({ p2: ['Flutter'] });
    const result = await generateProjectTags({ projects: PROJECTS, complete, warn: noop });
    expect(result.cache.projects.p1).toBeUndefined();
    expect(result.cache.projects.p2.tags).toEqual(['Flutter']);
  });

  it('keeps at most two tags', async () => {
    const { complete } = fakeComplete({ p1: ['C++', 'SFML', 'Arduino'], p2: ['Flutter'] });
    const result = await generateProjectTags({ projects: PROJECTS, complete, maxTags: 2, warn: noop });
    expect(result.cache.projects.p1.tags).toEqual(['C++', 'SFML']);
  });

  it('reuses the entries whose hash matches and only asks for the others', async () => {
    const first = await generateProjectTags({ projects: PROJECTS, complete: fakeComplete({ p1: ['C++'], p2: ['Flutter'] }).complete, warn: noop });
    const { prompts, complete } = fakeComplete({ p2: ['Flutter'] });
    const again = await generateProjectTags({ projects: PROJECTS, cache: first.cache, complete, warn: noop });

    expect(prompts).toHaveLength(0);
    expect(again).toMatchObject({ total: 2, reused: 2, generated: 0 });
    expect(again.cache).toEqual(first.cache);

    const changed = [{ ...PROJECTS[0], description: '<p>Un jeu en C++ avec Qt</p>' }, PROJECTS[1]];
    const { prompts: changedPrompts, complete: changedComplete } = fakeComplete({ p1: ['C++'] });
    const next = await generateProjectTags({ projects: changed, cache: first.cache, complete: changedComplete, warn: noop });
    expect(changedPrompts).toHaveLength(1);
    expect(changedPrompts[0]).not.toContain('Flutter');
    expect(next.cache.projects.p1.hash).toBe(hashOf(changed[0]));
    expect(next.cache.projects.p2).toEqual(first.cache.projects.p2);
  });

  it('prunes the entries of projects that no longer exist', async () => {
    const cache = cacheOf({
      gone: { tags: ['Rust'], model: 'm', hash: 'h' },
      p1: { tags: ['C++'], model: 'm', hash: hashOf(PROJECTS[0]) },
    });
    const { prompts, complete } = fakeComplete({ p2: ['Flutter'] });
    const result = await generateProjectTags({ projects: PROJECTS, cache, complete, warn: noop });

    expect(prompts).toHaveLength(1);
    expect(Object.keys(result.cache.projects).sort()).toEqual(['p1', 'p2']);
    expect(result.reused).toBe(1);
  });

  it('writes the pruned cache and warns when there is no provider', async () => {
    const cache = cacheOf({
      gone: { tags: ['Rust'], model: 'm', hash: 'h' },
      p1: { tags: ['C++'], model: 'm', hash: hashOf(PROJECTS[0]) },
    });
    const warnings: string[] = [];
    const result = await generateProjectTags({ projects: PROJECTS, cache, warn: (message) => warnings.push(message) });

    expect(Object.keys(result.cache.projects)).toEqual(['p1']);
    expect(result).toMatchObject({ total: 2, reused: 1, generated: 0 });
    expect(warnings.join('\n')).toMatch(/WARNING/);
  });

  it('keeps the old entries and never throws when the provider fails', async () => {
    const cache = cacheOf({ p1: { tags: ['C++'], model: 'old', hash: 'stale' } });
    const warnings: string[] = [];
    const result = await generateProjectTags({
      projects: PROJECTS,
      cache,
      complete: async () => {
        throw new Error('opencode: HTTP 500');
      },
      warn: (message) => warnings.push(message),
    });

    expect(result.cache.projects.p1).toEqual({ tags: ['C++'], model: 'old', hash: 'stale' });
    expect(result.cache.projects.p2).toBeUndefined();
    expect(warnings.join('\n')).toMatch(/WARNING/);
  });

  it('never logs a project id or its text, even when the provider throws them back', async () => {
    const warnings: string[] = [];
    await generateProjectTags({
      projects: PROJECTS,
      complete: async () => {
        throw new Error('Blink could not run Un jeu en C++ avec SFML on p1');
      },
      warn: (message) => warnings.push(message),
    });

    const logged = warnings.join('\n');
    expect(logged).toMatch(/WARNING/);
    expect(logged).not.toContain('Blink');
    expect(logged).not.toContain('Un jeu en C++');
    expect(logged).not.toContain('p1');
  });

  it('never throws on an answer that is not a JSON object', async () => {
    const { complete } = fakeComplete(['nope']);
    const result = await generateProjectTags({ projects: PROJECTS, complete, warn: noop });
    expect(result.cache.projects).toEqual({});
    expect(result.generated).toBe(0);
  });
});
