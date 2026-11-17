# Resume sync

One French resume in RxResume is the source of truth. `npm run sync:resume` (run in the Docker
builder before `npm run build`) turns it into everything the site and the CV download need:

| Output | From | Committed |
| --- | --- | --- |
| `src/data/resume.fr.json` | the French resume, sanitised to what the site renders | yes |
| `src/data/resume.en.json` | the French, translated to English by AI (cache below) | yes |
| `src/data/resume.translations.json` | the translation cache | yes |
| `public/cv/julien-petit-colboc-{fr,en}.pdf` | temporary copies of the resume in RxResume | yes |
| `src/data/resume.fingerprint.json` | the fingerprint of the master this build applied (see redeploy below) | yes |

Nothing needs a call to AI at deploy time when the cache is complete, so a build without any key still
works with the committed files.

## Coolify settings

Set these as build variables or build secrets (Coolify: tick "Build Variable" for the variables, and enable
"Use Docker Build Secrets" for the keys). Coolify passes build variables as secrets when Use Docker Build
Secrets is on, and as `--build-arg` otherwise. The Dockerfile reads both: the sync RUN mounts every setting below
as a secret (`--mount=type=secret,id=NAME,env=SECRET_NAME`) and uses the `ARG` of the same name when the secret is
absent or empty. A missing setting is optional, so a build without it still works.

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

The rule for the public PDFs: they keep the original RxResume layout, unmodified, and the only change is the
phone number, removed. For English, the translated text and the English date locale are part of the translation.
No layout setting (line height, margins, template, fonts, page count) is overridden for either language.

Each language can change the copy's metadata, and nothing else (`PDF_METADATA` in `scripts/sync-resume.mjs`):

- **English**: `metadata.page.locale` is `en-US`, and nothing else. RxResume formats the dates and their "present"
  label from that locale, so with the French locale the English PDF printed `janv. 2026 – Aujourd’hui`. It is also
  the locale of the hand-made English resume.
- **French**: no override, the main resume's metadata as it is.

A test walks the English copy and fails if a French string that has a translation is still there. The
PDF-only prose above is translated with the same cache. A hidden summary, section or item is never sent to a
provider, hidden projects excepted: the site shows those, so they were already translated.

## Retries

RxResume sometimes refuses a request that is valid and works a minute later: a 401 on a good key was seen once in
production and once locally, and the PDFs were skipped for it. The client (`scripts/lib/rxresume.mjs`) retries those
refusals, so one blip does not skip a sync or a deploy.

| Request | Retried on | Why |
| --- | --- | --- |
| GET: list, read, PDF | 401, 408, 429, 5xx, a network error, a timeout (the checker does not retry a 401, see below) | a GET changes nothing, so a second try cannot do harm |
| POST create, PATCH, DELETE, POST purge | 401, 429 only | the server refused it before it ran, so a retry cannot run it twice |
| everything else | never | the request may already have run: a retried create could leave a duplicate copy |

- The **build** (`npm run sync:resume`, through `buildApi` in `scripts/sync-resume.mjs`) makes up to **5 attempts**.
  The pauses before each retry are **2 s, 5 s, 15 s and 30 s**: about **52 seconds** in all, enough for a refusal
  that lasts about a minute. A build can afford to wait.
- The **checker** (`scripts/check-resume-change.mjs`) makes up to **3 attempts**, pausing **2 s** and then **5 s**:
  about **7 seconds**. It runs every 15 minutes and tries again on its next run, so it does not wait longer.
- A `Retry-After` header (seconds or a date) replaces the pause in both, capped at **30 s**.
- Each retry logs one line, with the label, the status and the attempt, for example
  `RxResume list: HTTP 401, attempt 1 of 5 failed, retrying in 2000 ms`. The labels carry no id. No key, URL,
  response body or resume text is logged.
- When the attempts run out, the error is the same as before, with the label and the status only
  (`RxResume list: HTTP 503`). The sync then skips the PDFs and the build fails; the checker treats it as transient.
- A refusal that lasts longer than the build's 52 seconds is not covered: the run then skips as it did before, and
  the checker tries again after six hours.
- The checker's fetch wrapper classifies the answers before the client sees them: HTTP 408, 429 and 5xx are
  transient, and every other error status is configuration. So the checker does not retry a 401 (it still exits 1,
  as documented below), while the sync does. The wrapper also does not pass `Retry-After` through, so in the checker
  the pause is always the schedule's.

## Redeploy when the resume changes

RxResume has no webhooks and autosaves while you type, so the site is redeployed by polling, and only after
the resume has been quiet for a while. `.github/workflows/resume-autodeploy.yml` runs
`scripts/check-resume-change.mjs` every 15 minutes:

1. **Fingerprint of the master.** The master is read (GET only) and fingerprinted: HMAC-SHA256, keyed with the
   RxResume API key, over the whole master as the sync reads it, without the phone number
   (`scripts/lib/fingerprint.mjs`). Metadata, layout, picture, custom sections and hidden flags count, so a change
   that only the CV PDF shows also redeploys. The phone number does not count. The data has no timestamps, and the
   update time is not part of it, so an edit that changes nothing does not count either. The key keeps the value
   private: notes and hidden items are low-entropy text that a plain hash could be guessed against.
2. **Fingerprint of the site.** `npm run sync:resume` writes the master's fingerprint to
   `src/data/resume.fingerprint.json` at the end of a complete run (site data, English and both PDFs). The site
   serves it at `/resume-fingerprint.json` (`src/pages/resume-fingerprint.json.ts`, `no-cache` in Caddy). A build
   without a sync, or after a partial one, serves the committed value: `null` until a sync is committed, and an
   older fingerprint after a failed run, so the checker keeps retrying.
3. **Deploy only if** the two fingerprints differ **and** the master was last edited at least `QUIET_MINUTES` ago
   (default 30). A missing or unreachable site fingerprint counts as different, but still waits for the quiet period.
4. **Wait** while Coolify has a deployment queued or in progress, and while the newest deployment started less than
   `DEPLOY_COOLDOWN_MINUTES` ago (default 30). The newest is taken from the last five deployments
   (`GET /api/v1/deployments/applications/{uuid}?take=5`): Coolify does not document the order of the list.
5. **A sync that keeps failing does not rebuild every cooldown.** When a deployment started after the last edit
   and the site still differs, its sync failed (for example RxResume was down). The checker then retries at most
   every six hours.
6. **A failed deployment is reported once.** The first run that sees a failed deployment ended less than 15 minutes
   ago exits with code 1, so GitHub sends one failure email for it. The runs after it stay quiet (exit 0) and do not
   redeploy for six hours. The schedule runs every 15 minutes, so that window holds one run. If GitHub runs the
   schedule late, or Coolify cannot be read on that run, the failure then shows only in Coolify, and the site keeps
   its previous build.
7. **Deploy:** `POST {COOLIFY_URL}/api/v1/deploy?uuid={COOLIFY_APP_UUID}&force=true`. The `force` flag is the cache
   fix below.

**Failures come in two kinds.** Every RxResume and Coolify call has a 20-second timeout.

- **Transient** (a timeout, a network error, HTTP 408, 429 or 5xx): the client retries a read of the master first
  (see Retries). If the failure persists, the run logs one line, for example
  `RxResume: HTTP 503 (transient), no deploy this run`, and exits 0. Nothing is deployed, and the next run tries
  again. An outage does not email the owner every 15 minutes.
- **Configuration or auth** (a missing setting, a `COOLIFY_URL` that is not `https://`, HTTP 401 or 403, another 4xx
  such as 404 on the master, a master that is not JSON, a refused redirect): the run exits 1, so GitHub tells the
  owner. It repeats on every run until it is fixed.

The site's fingerprint keeps its own rule: unreachable or missing counts as changed, and waits for the quiet period
(item 2). The job also has a timeout (`timeout-minutes`), so a stuck run cannot hold up the schedule.

The logs are public (the repository is public), so they contain only decisions, service names, status or error
codes, and 12-character fingerprint prefixes: never resume text, keys, tokens, URLs, the phone number or response
bodies. Every failure is reported by the service name and its status or error code only.

**Why `force=true`.** The Docker builder runs `npm run sync:resume` in a layer. Secret mounts are not part of a
layer's cache key, so a redeploy of the same commit reuses that layer and does not sync at all. A push changes
the source, so it rebuilds the layer; a deploy triggered by the checker does not. `force` makes Coolify build
without cache, so the sync runs again. The cost is one full build (`npm ci` included) per triggered deploy, which
is rare. Normal push deploys are unchanged.

**Known limits.**

- A sync that fails during a build is a warning: the build succeeds with the previous data, and no email is sent.
  The site stays on its previous version until the next retry (every six hours while the sync fails) succeeds.
- A configuration or auth error (a bad or expired RxResume key, a Coolify token without the permissions) exits with
  code 1 on every run, so it sends one failure email per run until it is fixed. A transient outage does not: see
  Failures above.
- An outage of Coolify that covers the 15 minutes after a failed deployment ends hides that failure: the checker
  cannot read it, and it is not reported later. The failure shows in Coolify, and the site keeps its previous build.
- The fingerprint depends on the RxResume key. Rotate the GitHub and Coolify copies of that key together: a
  mismatch in between causes one extra deploy.

**First build.** The site has no fingerprint until a build with the RxResume key runs the sync. The first push
deploy of this change does that (Coolify deploys on push), so the checker finds nothing to do afterwards.

### GitHub secrets and variables

Set them in the repository (Settings → Secrets and variables → Actions):

| Name | Kind | Value |
| --- | --- | --- |
| `RXRESUME_URL` | secret | RxResume base URL (default `https://rxresu.me`) |
| `RXRESUME_ID` | secret | ID of the French resume (`RXRESUME_ID_FR` is accepted as an alias) |
| `RXRESUME_API_KEY` | secret | an RxResume API key (read access is enough: the checker only GETs). Also the fingerprint key, see above |
| `COOLIFY_URL` | secret | the Coolify base URL, `https://` only |
| `COOLIFY_DEPLOY_TOKEN` | secret | a Coolify API token with the read and deploy permissions only (see below) |
| `COOLIFY_APP_UUID` | secret | the UUID of this application in Coolify |
| `SITE_URL` | variable | the production site (default `https://sliiz.com`) |

**Coolify token.** Create it in Coolify under Keys & Tokens → API tokens, with the `read` and `deploy`
permissions only. Do not give it `write` or `root`: the checker reads deployments and triggers a deploy, nothing
else. The permission names depend on the Coolify version; pick the two that match "read" and "deploy".

**Keeping the schedule alive.** GitHub disables scheduled workflows in a public repository after 60 days without
repository activity. `.github/workflows/resume-autodeploy-keepalive.yml` runs monthly and pushes an empty commit to
the `keepalive` branch (not `main`, so Coolify does not deploy on it). Pushes are the activity that counts. This is
not documented in detail by GitHub: if the autodeploy workflow ever shows as disabled, press Enable workflow.

### Running the check locally

```bash
node --env-file=.env scripts/check-resume-change.mjs --dry-run
```

It reads the master and the live site and prints the decision (`would deploy`, `waiting`, `up to date`, …). It
makes no deploy call. The Coolify settings are optional in a dry run; without them the deployments are not
checked. Without `--dry-run` it deploys when the decision says so.

## Running it locally

```bash
cp .env.example .env     # fill in RXRESUME_*, and a translation key or TRANSLATE_CLAUDE_LOCAL=1
npm run sync:resume
npx vitest run
```

The unit tests use fakes only: they never call RxResume, a provider, Coolify or the site.
