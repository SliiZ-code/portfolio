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

three.js is used only by a project page that mounts a live 3D model (loaded on demand); no GSAP, Lenis or client-side framework.

## Commands

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static pages in dist/
npm run preview    # serve dist/
npm run check      # astro check
npm test           # vitest run
npm run sync:resume
npm run screenshots # optional, needs Playwright (see below)
```

## Content flow

RxResume is the source of truth. The public data is synced into two sanitised JSON
files (on every Docker build when a key is configured, see Deployment), which are
then validated by Zod:

```text
RxResume API
  -> scripts/sync-resume.mjs   (structural sanitiser)
  -> src/data/resume.fr.json / resume.en.json
  -> src/lib/resume.ts         (Zod validation, HTML sanitiser, slugs)
  -> pages and components
```

Create `.env` from `.env.example` and fill in the required values (the last two are
optional, see "CV PDF" below):

```bash
RXRESUME_URL=https://rxresu.me
RXRESUME_API_KEY=...
RXRESUME_ID_FR=...
RXRESUME_ID_EN=...
RXRESUME_PDF_ID_FR=...
RXRESUME_PDF_ID_EN=...
```

Then run `npm run sync:resume`. The script calls
`GET /api/openapi/resumes/:id` for each language and keeps only the fields the
site renders. It deliberately drops:

- resume metadata and private notes;
- hidden sections, hidden items and hidden custom fields (one exception: hiding a
  *project* only keeps it off the PDF, the site still shows it);
- the profile picture;
- custom sections.

Descriptions are sanitised again at load time: only `p`, `ul`, `ol`, `li`,
`strong`, `em`, `a[href]` and `br` survive; links are restricted to `http(s)`,
`mailto`, `tel`, root-relative paths and fragments.

The checked-in JSON files are the last real sync; they are what the build uses
when no key is available or RxResume is unreachable. Do not invent facts about
Julien in this repository: names, descriptions, periods and links come from RxResume, the
board only adds its own voice (margin notes, hints, UI strings).

### CV PDF

The public PDF is not rendered from the main resumes, which carry a phone number. Create in
RxResume a second resume per language (a "web resume"), used only for the PDF, and put their IDs
in `RXRESUME_PDF_ID_FR` / `RXRESUME_PDF_ID_EN`. **The web resumes are overwritten from the main
resumes at each sync: don't edit them by hand**, edit the main ones. A web ID must never be a
main resume ID, and the two must differ: the sync refuses to run otherwise. A locked web resume
can't be written, so its PDF stays at the previous version until it is unlocked. Before downloading, the sync
copies the main resume's whole `data` (basics, summary, sections, custom sections, metadata,
picture) into the web resume through `PATCH /api/openapi/resumes/:id` (JSON Patch with
`expectedUpdatedAt`, so a concurrent edit is refused instead of lost), with `basics.phone` emptied
and any custom field that holds the phone removed. It writes only when something differs, and
never writes data that still holds the phone. For each language that has
an ID the sync downloads `GET /api/openapi/resumes/:id/pdf` into
`public/cv/julien-petit-colboc-fr.pdf` / `julien-petit-colboc-en.pdf`. These files are committed
like the JSON, so a build without RxResume still has them.

Before writing a PDF the sync reads the web resume back after that copy and refuses it (that
language fails, the previous file is kept, the script exits with an error and the deploy builds
with the committed files) if `basics.phone` is not empty, if the
phone of the main resume appears anywhere in the web resume, or if the response does not start
with `%PDF-`. The other language is not affected. The resume JSON is still updated, so until
the problem is fixed the PDF can lag behind the CV page; it never carries the phone number.
The phone check compares against the main resume's `basics.phone`: keep the number there, not
in a custom field, or the sync can't recognise it (it warns when that field is empty).

The PDF link (board HUD, no-JavaScript list, CV page) points to the file only when it exists at
build time; without it the HUD and the list link to the HTML CV page, which offers print.

### Project slugs

Slugs are computed from the RxResume project names (`slugify`), for example
`Jeu de la vie` becomes `/projets/jeu-de-la-vie/`. Seed, tag, page note, capture and optional live
experiment are a site-only overlay in `src/data/board.ts`, keyed by that slug. A project that
exists in RxResume but not in the overlay is still rendered, in the board list, in the
no-JavaScript list and as a page: it gets no tag and a methuselah picked from its slug
(`METHUSELAHS[hash(slug) % length]`, always the same one). An overlay entry without a matching
RxResume project is ignored (RxResume stays the source of truth for projects).

Each project has a seed, a methuselah (a few cells that run for a long time): `seed` in the
overlay, one of `r-pentomino`, `acorn`, `diehard`, `b-heptomino`, `pi-heptomino` (`patterns.ts`).
Its page note, in the margin of the project page, describes it. Hovering or focusing the project
on the board fires that seed (see Board).

The FR and EN versions of a project are matched by the RxResume item `id` (a duplicated
resume keeps the ids), then by overlay key, then by position.

A project's meta line (project page, no-JavaScript list) is the overlay tag and the RxResume
period joined by ` · `; an empty part is skipped.

Captures need no overlay entry: drop `<slug>.mp4`, `.webm`, `.jpg`, `.jpeg`, `.png` or `.webp`
in `public/media/` (video wins over image). The project's own slug is tried first, then its
overlay key, then the slug of its other-language twin. An explicit `media` in the overlay
still wins.

## Routes

| FR | EN |
| --- | --- |
| `/` | `/en/` |
| `/projets/<slug>/` | `/en/projects/<slug>/` |
| `/cv/` | `/en/cv/` |

`/labo/`, `/histoire/`, `/en/lab/` and `/en/story/` no longer exist: `redirects` in
`astro.config.mjs` sends them to the board (they are not in the sitemap).

`<html lang>` follows the route. Every page has a canonical URL, `hreflang`
alternates and its own title/description. The project list is generated at build
time, not rendered on the client.

## Site configuration

`src/data/site.ts`:

- `url`: absolute site origin for canonical and `hreflang` URLs. Empty means
  relative URLs, which is fine for local/preview builds.

## Live experiment on a project page

A project can replace its pixelated capture with a live 3D viewer: give its overlay entry
`experiment: { kind: 'pixel-model', src: '/media/arduino.glb' }`. "L'Arduino en pixels" /
"The Arduino in pixels" (overlay key `larduino-en-pixels`, alias `the-arduino-in-pixels`, seed
`b-heptomino`) uses it; name, description, period and link come from RxResume like any project, and it
only appears once RxResume has the project. The page renders `public/media/arduino.glb` with
three.js at 320×200, then pixelates it (see below); drag to rotate, it turns by itself unless
reduced motion is requested, and it follows the theme. three.js is imported only once the
viewer is on screen, and without WebGL the page shows a message instead.

## Board

The board fits the viewport exactly: no pan, no zoom. The name is rasterized at the font's
half-pixel resolution and sets the cell size (about 40% of the width in landscape, two thirds
on phones, cells between 3 and 8px) and the grid covers the screen. The name is the only drawing;
right under it hangs the resume headline (`#headline`, Geist Mono, ink on a paper chip, from the resume at
build time), then the handwritten note; the projects are an HTML list and the links (GitHub, LinkedIn, Contact, CV) are the bottom-right
HUD. The engine lives in `src/scripts/board/`:

- `index.ts`: bootstrap, layout (re-run on resize), generation loop, opening, seeds, dive and return;
- `layout.ts`: pure geometry: orientation, cell size, name placement, keep-clear boxes;
- `projects.ts`: pure geometry of the project list (where it sits), of the seeds (where one lands)
  and of the opening shockwave;
- `life.ts`: world stepping and per-cell age, seeding, keep-clear, the glider fed from an edge;
- `structures.ts`: the name's own cells: intrusion, release, regrowth, healing;
- `patterns.ts`: gliders and the five methuselahs;
- `input.ts`: drag to draw (continuous strokes), tap for a glider;
- `render.ts`: canvas drawing, colour buckets by age, the shockwave ring;
- `return-flag.ts`: the `jpc-from` session flag that replays the reverse zoom on Back.

**Colour by age.** Every free cell has an age: 0 when it is born (or painted, dropped, fired,
or released by a structure), +1 for each generation it survives. A newborn cell is drawn bright
and fades through a warm-to-cool ramp (`--life-0` … `--life-3`, defined for both themes in
`global.css`; ages 0–2, 3–6, 7–11, 12–17) to the calm resting grey, the ink at half opacity.
Still lifes and old patterns are therefore grey; whatever moves or flickers shows colour (the
ends of a blinker are reborn every generation, so they stay bright). The name is solid ink. The draw loop sorts the live cells into five buckets in one pass and sets
one `fillStyle` per bucket; it allocates nothing per frame and redraws only when something changed.

**Projects.** The projects are a real HTML list on the board (`#projects`, Geist Mono, name plus
muted `tag · period`): a column hugging the right gutter, vertically centred and clear of the name,
its headline, its note and the corners, in landscape; full width under the name and its note on a phone. If it does not
fit it tightens (`compact`), drops the meta column (`narrow`) and finally scrolls, but never overlaps
anything. Its box is a keep-clear zone: the soup dies under it. Hovering or focusing a row (a touch
on a phone) fires its seed as newborn cells just outside the list, on the side facing the open
board and level with the row (or the nearest free rows when that level is taken), then Life runs
it; one firing per row every 1.5 s. With reduced motion the seed is still stamped and the board
advances one generation. Without JavaScript the same projects are in the plain list (`BoardList`).

**Opening.** On a fresh load (`data-entry="intro"` on the canvas) the board starts empty and a
shockwave leaves the centre of the name in about 1.8 s: a ring of newborn-coloured cells, with the
seeded soup (age 0) appearing behind it, the name as it passes it, and
the headline, the note and project rows fading in once it has passed their position. The simulation starts when
the ring has left. There is no opening on the return zoom-out (`zoom-out`) or with reduced motion
(`direct`).

**HUD.** Names and links are server-rendered. The bottom-right HUD reads GitHub · LinkedIn ·
Contact · CV: the first two come from the resume's profiles, Contact is a `mailto:` to the resume's
email (left out without one), and CV opens the PDF in the same tab (`type="application/pdf"`), or
the HTML CV page (`/cv/`, `/en/cv/`) when the PDF is missing at build time. Contact and CV are
drawn as ink chips (accent on hover or focus), the two calls to action. On a phone the four fit on
one row and the bottom-left counters are hidden, so the HUD never overlaps; the project list
is placed above the HUD's top edge.

Controls: drag to draw, click empty space to drop a glider, click a project to dive. A dive
scales the stage 16× toward the clicked row (about 750 ms), then navigates. `?from=<slug>`
starts at that scale on that project's row and animates back to 1. A browser Back finds the same
slug in `sessionStorage` (`jpc-from`); the board puts it back on `pagehide`, so Back, Forward, Back
replays it again. The HUD links navigate directly, no dive.

`prefers-reduced-motion` disables the simulation steps (the board only advances when the user draws
or fires a seed), the opening and the dive: links navigate directly.

The theme is stored under `jpc-theme` and applied inline before paint so night mode does not
flash (19:00–6:59 by default). The HUD and every page bar carry the same two flags (FR / EN,
linking to the other language's equivalent page) and the 7×7 pixel sun/moon toggle, which
shows the theme you switch to.

### Pixelated previews

Project pages draw the capture into a 160-px-wide canvas and quantise it to five ink levels
between paper and ink (light is paper on the paper theme, ink at night) plus the accent for
saturated colours (`src/scripts/pixel/quantize.ts`, pure and tested), shown upscaled with
`image-rendering: pixelated` and re-coloured when the theme changes. An experiment does the
same with the three.js render (`src/scripts/pixel/model.ts`).

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
- The builder stage runs `npm run sync:resume` before `npm run build` when
  `RXRESUME_API_KEY` is set. If the sync fails it prints a warning and builds with the
  committed JSON and PDFs, so a RxResume outage never breaks a deploy
- The settings below exist only in the builder stage, never in the Caddy image. The API
  key is mounted as a build secret, so it stays out of the image history and build cache
- Runs on port 80

**Build variables** (Coolify → Configuration → Environment Variables, tick
"Build Variable", and turn on "Use Docker Build Secrets" in the advanced settings so the
key arrives as a secret; with plain Docker use `--build-arg` for the URL and IDs and
`--secret id=RXRESUME_API_KEY,env=RXRESUME_API_KEY` for the key):

| Variable | Meaning |
| --- | --- |
| `RXRESUME_URL` | RxResume base URL, `https://` only (default `https://rxresu.me`) |
| `RXRESUME_API_KEY` | API key, passed as a build secret; without it the sync is skipped and the committed JSON is used |
| `RXRESUME_ID_FR` | ID of the French resume |
| `RXRESUME_ID_EN` | ID of the English resume |
| `RXRESUME_PDF_ID_FR` | Optional. ID of the French web resume (without phone number), whose PDF is published |
| `RXRESUME_PDF_ID_EN` | Optional. ID of the English web resume (without phone number), whose PDF is published |

Since the resumes are only fetched at build time, redeploy after editing RxResume.

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
