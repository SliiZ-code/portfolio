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

three.js is used only by the lab page (loaded on demand); no GSAP, Lenis or client-side framework.

## Commands

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # 16 static pages in dist/
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

Two hand-placed structures sit on the board next to the projects: the lab (`labo`, a
beacon) and "mon histoire" / "my story" (a toad). Their position, emblem and size live in
`BOARD_PAGES` in `src/data/board.ts`; their text, label and margin note in `src/i18n`.
They are kept clear of the name, the CV, the gun and its glider lane, and auto-placed
RxResume projects avoid them too (`tests/board-pages.test.ts`).

- The lab page lists the experiments of `src/data/lab.ts`. The first one renders
  `public/media/arduino.glb` as live ASCII with three.js `AsciiEffect`; drag to rotate,
  it turns by itself unless reduced motion is requested, and follows the theme.
  three.js is imported only once the viewer is on screen.
- The story page is a placeholder (`[placeholder]` copy) until the real text is written.

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
- `return-flag.ts`: the `jpc-from` session flag that replays the reverse zoom on Back;
- `minimap.ts`: minimap rendering.

Controls: drag to explore, wheel/pinch to zoom, click an empty cell to drop a
glider, `[✎ dessiner]` to paint, project/CV text to dive. Activating contact goes
to `mailto:` or the first profile. `?from=<slug>` starts zoomed on that project
and plays the reverse zoom-out. A browser Back finds the same slug in `sessionStorage`
(`jpc-from`); the board puts it back on `pagehide`, so Back, Forward, Back replays it again.

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

`npm run build` produces a static `dist/`. Any static host works. Set `site.url`
before deploying if canonical/`hreflang` URLs must be absolute.
