# Resume sync

One French resume in RxResume is the source of truth. `npm run sync:resume` (run in the Docker
builder before `npm run build`) turns it into everything the site and the CV download need:

| Output | From | Committed |
| --- | --- | --- |
| `src/data/resume.fr.json` | the French resume, sanitised to what the site renders | yes |
| `src/data/resume.en.json` | the French, translated to English by AI (cache below) | yes |
| `src/data/resume.translations.json` | the translation cache | yes |
| `public/cv/julien-petit-colboc-{fr,en}.pdf` | temporary copies of the resume in RxResume | yes |

Nothing needs a call to AI at deploy time when the cache is complete, so a build without any key still
works with the committed files.

## Coolify settings

Set these as build variables or build secrets (Coolify: tick "Build Variable", and enable "Use Docker
Build Secrets" so the keys arrive as secrets):

| Name | Kind | Value |
| --- | --- | --- |
| `RXRESUME_URL` | variable | `https://rxresu.me` (default) |
| `RXRESUME_ID` | variable | the ID of the French resume (`RXRESUME_ID_FR` is accepted as an alias) |
| `RXRESUME_API_KEY` | secret | an RxResume API key |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret | token of your Claude subscription (see below) |
| `GEMINI_API_KEY` | secret | optional, used when there is no Claude token |
| `OPENROUTER_API_KEY` | secret | optional, used when there is neither |
| `TRANSLATE_CLAUDE_MODEL`, `TRANSLATE_GEMINI_MODEL`, `TRANSLATE_OPENROUTER_MODEL` | variable | optional model overrides |

Remove `RXRESUME_ID_EN`, `RXRESUME_PDF_ID_FR` and `RXRESUME_PDF_ID_EN`: they are not read any more.

Without `RXRESUME_API_KEY` the sync is skipped. A failed sync prints a warning and the deploy builds with
the committed files.

## Getting the Claude token

On a machine where Claude Code is logged in with your subscription:

```bash
claude setup-token
```

It prints a long-lived OAuth token. Put it in Coolify as `CLAUDE_CODE_OAUTH_TOKEN`. The token is only
given to the `claude` process that runs the translation, never to the RxResume calls.

## Translation providers

Tried in this order; the first one configured is used, and a failure falls through to the next:

1. **Claude** (`CLAUDE_CODE_OAUTH_TOKEN`): `claude -p --output-format json --tools ""`, prompt on stdin,
   model `claude-haiku-5-5` (`TRANSLATE_CLAUDE_MODEL`). Uses `npx -y @anthropic-ai/claude-code@2.1.311` when `claude`
   is not on the PATH (the Docker builder). The version is pinned in `scripts/lib/translate.mjs`: bump it on purpose.
   The child runs in an empty temporary directory, with only PATH, HOME and the token in its environment. Local development can use the Claude Code login of the machine
   with `TRANSLATE_CLAUDE_LOCAL=1` instead of a token.
2. **Gemini** (`GEMINI_API_KEY`): `generateContent` in JSON mode, model `gemini-3.5-flash`
   (`TRANSLATE_GEMINI_MODEL`).
3. **OpenRouter** (`OPENROUTER_API_KEY`): chat completions, model `anthropic/claude-haiku-4.5`
   (`TRANSLATE_OPENROUTER_MODEL`).

Every call has a timeout. Errors are reported by status only; keys, tokens and answers are never logged.

## What is translated

Only prose and labels: the headline, the summary, section titles, positions, degrees, areas, locations,
period strings (`janv. 2026 – aujourd’hui` becomes `Jan 2026 – present`), descriptions (HTML: only the text
between the tags changes), skill names and keywords, language names and fluency, interests, project names
and descriptions, volunteer organisations and certification or award titles.

The English PDF also translates what only the PDF shows: publications, references (not the person's name),
custom sections and the header's custom fields, when they are not hidden and do not hold the phone number.
The English site data does not carry them.

Never translated: person names, company and school names, emails, URLs, network names, numbers, ids.

Every AI answer is checked before it is used: every key must come back as a non-empty string, and HTML
values must keep exactly the same tags and attributes (one retry, then the next provider).

## The cache

`src/data/resume.translations.json` maps `sha256(French string)` to its English and the model that wrote it.
Only the strings that are not in the cache go to a provider. Each run keeps only the entries the current
French resume uses, so the file always matches the resume. The file is written in a fixed order, so a
change in the resume shows up as a small, readable diff.

To correct a wording by hand, edit the `en` of its entry and leave the French key alone; the next sync uses
the correction. To force a new translation, delete the entry.

## The phone number

The phone number is `basics.phone` in RxResume. It must never reach the site JSON, the cache, the AI
provider, a temporary copy or a PDF. The sync checks each of them against the number (any formatting, and
numbers split over two fields) and refuses the run if the French site data holds it. The translation
payload only contains sanitised text, which the sync checks before sending. The PDF is checked as a copy and
as bytes (raw and decompressed streams). Keep the number in `basics.phone`: the checks compare against that
field.

## The PDFs

For each language the sync:

1. creates a resume named `tmp-portfolio-pdf-<lang>-<stamp>` (`POST /api/openapi/resumes`);
2. fills it with the resume data without the phone (`PATCH /api/openapi/resumes/:id`, JSON Patch on the
   top-level keys, guarded by `expectedUpdatedAt`), reads it back and checks it;
3. downloads `GET /api/openapi/resumes/:id/pdf`, checks it starts with `%PDF-` and does not show the phone;
4. removes the copy: `DELETE /api/openapi/resumes/:id` (Trash), then
   `POST /api/openapi/documents/purge` with `{"type":"resume","id":":id"}`.

Step 4 runs even when a step before it failed. At the start of every run, the copies left by a crashed run
(names or slugs starting with `tmp-portfolio-pdf-`) are removed the same way. A copy that RxResume reports as
public (`isPublic`) is refused and removed. The main resume is only ever read: the API client refuses any
write to it or deletion of it (`protectedId`, checked below the sync, so no caller can bypass it).

Hidden projects keep their flag in the copy, so RxResume leaves them off the PDF while the site still shows
them. Hidden sections and items are off the site and, as before, off the PDF.

Each language can change the copy's metadata, and nothing else (`PDF_METADATA` in `scripts/sync-resume.mjs`):

- **English**: `metadata.page.locale` is `en-US`. RxResume formats the dates and their "present" label from that
  locale, so with the French locale the English PDF printed `janv. 2026 – Aujourd’hui`. The same locale as the
  hand-made English resume, which fitted on one page.
- **English**: the body line height is 1.35 (1.4 in the French resume). It keeps the English on one page,
  where the same text with the French look ran onto a second page by three lines.
- **French**: no override, the main resume's metadata as it is.

A test walks the English copy and fails if a French string that has a translation is still there. The
PDF-only prose above is translated with the same cache. A hidden summary, section or item is never sent to a
provider, hidden projects excepted: the site shows those, so they were already translated.

## Running it locally

```bash
cp .env.example .env     # fill in RXRESUME_*, and a translation key or TRANSLATE_CLAUDE_LOCAL=1
npm run sync:resume
npx vitest run
```

The unit tests use fakes only: they never call RxResume or a provider.
