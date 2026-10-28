# portfolio-astro

Julien Petit-Colboc's portfolio: a one-screen Game of Life board you can draw on, with
project pages, a CV page and a French/English static build.

The visual reference is `design/board-v2.html`. It is kept as-is for comparison; the
Astro site is the port of that prototype.

## Stack

- Astro (static output, no UI framework)
- TypeScript strict (`astro/tsconfigs/strict`)
- Zod for resume data validation
- Vitest for unit tests
- Self-hosted Geist Pixel / Gambarino fonts; Geist Mono and Shantell Sans come
  from `@fontsource`

three.js is used only by the lab page (loaded on demand); no GSAP, Lenis or client-side framework.

## Commands

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # 17 static pages in dist/
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
`Jeu de la vie` becomes `/projets/jeu-de-la-vie/`. Board placement, pattern, tag,
page note and capture are a site-only overlay in `src/data/board.ts`, keyed by that slug
(positions are screen fractions per orientation, `l` landscape / `p` portrait). A project
that exists in RxResume but not in the overlay is still rendered, in the no-JavaScript list and as a page:
on the board it gets a deterministic pattern and a free slot found at runtime (a scan for a
free rectangle that avoids every pattern, label, keep-clear zone and HUD corner). If the
screen has no room left it is left off the board with a `[board] no free slot` console
warning. An overlay entry without a matching RxResume project is ignored (RxResume stays the
source of truth for projects).

## Routes

| FR | EN |
| --- | --- |
| `/` | `/en/` |
| `/projets/<slug>/` | `/en/projects/<slug>/` |
| `/cv/` | `/en/cv/` |
| `/labo/` | `/en/lab/` |
| `/histoire/` | `/en/story/` |

`<html lang>` follows the route. Every page has a canonical URL, `hreflang`
alternates and its own title/description. The project list is generated at build
time, not rendered on the client.

## Site configuration

`src/data/site.ts`:

- `url`: absolute site origin for canonical and `hreflang` URLs. Empty means
  relative URLs, which is fine for local/preview builds.
- `cvPdf.fr` / `cvPdf.en`: public paths to PDF CVs. When empty, the HUD CV link
  points to the `/cv/` page and the page offers print instead of a PDF download.

## Lab and story

Two hand-placed patterns sit on the board next to the projects: the lab (`labo`, a beacon)
and "mon histoire" / "my story" (a toad). Their position and pattern live in `BOARD_PAGES`
in `src/data/board.ts`; their name, label and margin note in `src/i18n`.

- The lab page lists the experiments of `src/data/lab.ts`. The first one renders
  `public/media/arduino.glb` with three.js at 320×200, then pixelates it (see below); drag to
  rotate, it turns by itself unless reduced motion is requested, and it follows the theme.
  three.js is imported only once the viewer is on screen.
- The story page is a placeholder (`[placeholder]` copy) until the real text is written.

## Board

The board fits the viewport exactly: no pan, no zoom. The name is rasterized at the font's
half-pixel resolution and sets the cell size (about 40% of the width in landscape, two thirds
on phones, cells between 3 and 8px), the grid covers the screen, and every structure is
placed by screen fractions. The engine lives in `src/scripts/board/`:

- `index.ts`: bootstrap, layout (re-run on resize), generation loop, dive and return;
- `layout.ts`: pure geometry: orientation, cell size, anchors, footprints, keep-clear boxes;
- `slots.ts`: pure free-rectangle finder for projects outside the overlay;
- `life.ts`: world stepping and heat, seeding, keep-clear, the glider fed from an edge;
- `structures.ts`: private boards per pattern, intrusion, release, regrowth, healing, the gun;
- `patterns.ts`: Life patterns (pulsar, penta, blinkers, galaxy, beacon, toad, beehive, gun);
- `input.ts`: drag to draw (continuous strokes), tap for a glider;
- `render.ts`: canvas drawing;
- `return-flag.ts`: the `jpc-from` session flag that replays the reverse zoom on Back.

Names and links are server-rendered: each pattern has a real `<a>` that the script positions:
a hit area over the pattern framed by pixel corners, the name in a small ink tab and, for
projects, the language tag under it. Hover or focus turns the corners, the tab and the
pattern to the accent colour.

Controls: drag to draw, click empty space to drop a glider, click a name to dive. A dive
scales the stage 16× toward the pattern (about 750 ms), then navigates. `?from=<slug>` starts
at that scale on that pattern and animates back to 1. A browser Back finds the same slug in
`sessionStorage` (`jpc-from`); the board puts it back on `pagehide`, so Back, Forward, Back
replays it again. Contact goes to `mailto:` or the first profile, no dive.

`prefers-reduced-motion` disables the simulation steps (the board is static, drawing still
works), the intro and the dive: links navigate directly.

The theme is stored under `jpc-theme` and applied inline before paint so night mode does not
flash (19:00–6:59 by default). The HUD and every page bar carry the same two flags (FR / EN,
linking to the other language's equivalent page) and the 7×7 pixel sun/moon toggle, which
shows the theme you switch to.

### Pixelated previews

Project pages draw the capture into a 160-px-wide canvas and quantise it to five ink levels
between paper and ink (light is paper on the paper theme, ink at night) plus the accent for
saturated colours (`src/scripts/pixel/quantize.ts`, pure and tested), shown upscaled with
`image-rendering: pixelated` and re-coloured when the theme changes. The lab page does the
same with the three.js render (`src/scripts/lab/model.ts`).

## Tests and screenshots

```bash
npm test
npm run check
```

The optional screenshot script compares the Astro home page with
`design/board-v2.html`:

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
- `try_files` for HTML routing (maps directory URLs to `.html` files)
- Long immutable cache for `/_astro/*` (1 year)
- Short revalidation for `/media/*` and `/fonts/*` (1 day, via ETag)
- Default short cache for HTML (1 hour)
- `handle_errors` serves `/404.html` with HTTP 404 status
- Health check via `wget` to `http://127.0.0.1/`

To build and test locally:
```bash
docker build -t portfolio .
docker run -d --name portfolio -p 127.0.0.1:18080:80 portfolio
curl http://127.0.0.1:18080/
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
4. Waits for the intro (cells fade in over about 1.4 s)
5. Hides the HUD
6. Screenshots the result to `public/og.png`

The Playwright binary is at `/tmp/shot/node_modules/playwright/index.mjs`
(pre-built, not a project dependency).

### Video compression

The project includes two dithered Game of Life videos:
- `public/media/conway.mp4` (~938 KB, 62.93 sec)
- `public/media/blink.mp4` (~321 KB, 46.55 sec)

Both are H.264 at reduced resolution (320px for conway, 480px for blink) and optimized bitrate.

To re-encode from the original (stored on the `redesign` branch):
1. Download ffmpeg ARM64 static build:
   ```bash
   mkdir /tmp/ffmpeg-dl
   cd /tmp/ffmpeg-dl
   curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz -o ffmpeg.tar.xz
   tar xf ffmpeg.tar.xz
   ```
2. Extract the original and re-encode with two-pass ABR:
   ```bash
   ffmpeg_bin="./ffmpeg-*/ffmpeg"
   git show redesign:public/media/conway.mp4 > conway-orig.mp4
   "$ffmpeg_bin" -y -i conway-orig.mp4 -vf "scale=320:-2,fps=15" -c:v libx264 -b:v 100k -pass 1 -an -f mp4 /dev/null
   "$ffmpeg_bin" -y -i conway-orig.mp4 -vf "scale=320:-2,fps=15" -c:v libx264 -b:v 100k -pass 2 -an -movflags +faststart -f mp4 conway.tmp.mp4
   ```
3. Verify duration and move:
   ```bash
   ffmpeg -i conway.tmp.mp4 2>&1 | grep Duration
   mv conway.tmp.mp4 <path>/public/media/conway.mp4
   ```

The Game of Life simulation steps slowly, so 15 fps preserves the visual effect while reducing file size.
