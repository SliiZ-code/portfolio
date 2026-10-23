# portfolio-astro

Julien Petit-Colboc's portfolio: a Game of Life board rendered on a canvas, with
project pages, a CV page and a French/English static build.

The visual reference is `design/board.html`. It is kept as-is for comparison; the
Astro site is the port of that prototype.

## Stack

- Astro (static output, no UI framework)
- TypeScript strict (`astro/tsconfigs/strict`)
- Zod for resume data validation
- Vitest for unit tests
- Self-hosted Geist Pixel / Gambarino fonts; Geist Mono and Shantell Sans come
  from `@fontsource`

No three.js, GSAP, Lenis or client-side framework is used.

## Commands

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # 12 static pages in dist/
npm run preview    # serve dist/
npm run check      # astro check
npm test           # vitest run
npm run sync:resume
npm run screenshots # optional, needs Playwright (see below)
```

## Content flow

The site never reads RxResume at build time. The public data is synced into two
sanitised JSON files, which are then validated by Zod:

```text
RxResume API
  -> scripts/sync-resume.mjs   (structural sanitiser)
  -> src/data/resume.fr.json / resume.en.json
  -> src/lib/resume.ts         (Zod validation, HTML sanitiser, slugs)
  -> pages and components
```

Create `.env` from `.env.example` and fill in the three required values:

```bash
RXRESUME_URL=https://rxresu.me
RXRESUME_API_KEY=...
RXRESUME_ID_FR=...
RXRESUME_ID_EN=...
```

Then run `npm run sync:resume`. The script calls
`GET /api/openapi/resumes/:id` for each language and keeps only the fields the
site renders. It deliberately drops:

- resume metadata and private notes;
- hidden sections, hidden items and hidden custom fields;
- the profile picture;
- custom sections.

Descriptions are sanitised again at load time: only `p`, `ul`, `ol`, `li`,
`strong`, `em`, `a[href]` and `br` survive; links are restricted to `http(s)`,
`mailto`, `tel`, root-relative paths and fragments.

The checked-in JSON files are samples: experience, certification and award
entries are labelled `[placeholder]` and must be replaced by a real sync before
publishing. Do not invent facts about Julien in this repository.

### Project slugs

Slugs are computed from the RxResume project names (`slugify`), for example
`Jeu de la vie` becomes `/projets/jeu-de-la-vie/`. Board placement, emblem,
margin note and capture are a site-only overlay in `src/data/board.ts`, keyed by
that slug. A project that exists in RxResume but not in the overlay is still
rendered: its emblem and position are chosen deterministically on rings around
the name. An overlay entry without a matching RxResume project is ignored
(RxResume stays the source of truth for projects).

## Routes

| FR | EN |
| --- | --- |
| `/` | `/en/` |
| `/projets/<slug>/` | `/en/projects/<slug>/` |
| `/cv/` | `/en/cv/` |

`<html lang>` follows the route. Every page has a canonical URL, `hreflang`
alternates and its own title/description. The project list is generated at build
time, not rendered on the client.

## Site configuration

`src/data/site.ts`:

- `url`: absolute site origin for canonical and `hreflang` URLs. Empty means
  relative URLs, which is fine for local/preview builds.
- `cvPdf.fr` / `cvPdf.en`: public paths to PDF CVs. When empty, the HUD CV link
  points to the `/cv/` page and the page offers print instead of a PDF download.

## Board

The engine lives in `src/scripts/board/`:

- `index.ts`: bootstrap, generation loop, dive navigation, list/theme/minimap
  wiring;
- `life.ts`: world stepping and heat;
- `structures.ts`: emblems, guns, intrusion/heal;
- `patterns.ts`: Life patterns;
- `render.ts` / `dither.ts`: canvas and project capture rendering;
- `camera.ts`: zoom/pan clamping;
- `input.ts`: drag, paint, glider drop, wheel and pinch;
- `minimap.ts`: minimap rendering.

Controls: drag to explore, wheel/pinch to zoom, click an empty cell to drop a
glider, `[✎ dessiner]` to paint, project/CV text to dive. Activating contact goes
to `mailto:` or the first profile. `?from=<slug>` starts zoomed on that project
and plays the reverse zoom-out.

The theme is stored under `jpc-theme` and applied inline before paint so night
mode does not flash. `prefers-reduced-motion` disables the intro and dives.

## Tests and screenshots

```bash
npm test
npm run check
```

The optional screenshot script compares the Astro home page with
`design/board.html`:

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node scripts/screenshots.mjs
```

Set `BASE_URL` if preview is not on `http://localhost:4321`, and `OUT_DIR` to
change the output directory (default `/tmp/shot`). Playwright is intentionally
not a project dependency.

## Deployment

### Docker and Coolify

`npm run build` produces a static `dist/` optimized for the included Docker setup.
The project is deployed via Coolify on an ARM64 server at https://sliiz.com.

**Docker image** (`Dockerfile`):
- Multi-stage build: Node.js 24 builder → static site in Caddy 2 (Alpine)
- No build-time secrets required; all data is committed JSON
- Runs on port 80

**Caddyfile** configuration:
- `encode zstd gzip` for compression
- `try_files` for HTML routing (supports SPA-like fallbacks)
- Long immutable cache (`/_astro/*`, `/fonts/*`, `/media/*`: 1 year)
- Short cache for HTML (1 hour)
- `handle_errors` serves `/404.html` with HTTP 404 status
- Health check via `wget` to `http://127.0.0.1/`

To build and test locally:
```bash
docker build -t portfolio .
docker run -d --name portfolio -p 127.0.0.1:8000:80 portfolio
curl http://127.0.0.1:8000/
docker stop portfolio && docker rm portfolio
```

### OG image regeneration

To regenerate `public/og.png` (the social share card):
```bash
LD_LIBRARY_PATH=/tmp/shot/root/usr/lib/aarch64-linux-gnu node scripts/og.mjs
```

This script:
1. Runs `npm run build`
2. Starts a preview server on port 4411
3. Opens the home page in headless Chromium at 1200×630
4. Waits for the intro animation to finish (~4 seconds)
5. Hides the HUD/minimap
6. Screenshots the result to `public/og.png`

The Playwright binary is at `/tmp/shot/node_modules/playwright/index.mjs`
(pre-built, not a project dependency).

### Video compression

The project includes two dithered Game of Life videos:
- `public/media/conway.mp4` (~1.9 MB)
- `public/media/blink.mp4` (~321 KB)

To re-encode them (e.g., after changes):
1. Download ffmpeg ARM64 static build:
   ```bash
   mkdir /tmp/ffmpeg-dl
   cd /tmp/ffmpeg-dl
   curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz -o ffmpeg.tar.xz
   tar xf ffmpeg.tar.xz
   ```
2. Re-encode:
   ```bash
   ffmpeg_bin="/tmp/ffmpeg-dl/ffmpeg-*/ffmpeg"
   "$ffmpeg_bin" -i public/media/conway.mp4 \
     -vf "scale=480:-2" \
     -c:v libx264 -crf 30 -preset slow -pix_fmt yuv420p -an -movflags +faststart \
     -f mp4 conway.tmp.mp4 && mv conway.tmp.mp4 public/media/conway.mp4
   ```

The goal is < 1 MB per video with preserved duration and quality.
