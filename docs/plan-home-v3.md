# Home v3: the board becomes the hero, a real page scrolls under it

Goal: advertise Julien for a research internship abroad (June 2027, 12–17 weeks, AI / VR / robotics).
A reader must learn who he is, what he wants and the proof in under 30 seconds, after a memorable hero.

Research behind it (Nov 2026): award juror rules (art direction + directed motion + performance; the static
frame must hold), research homepages (Jon Barron: media, title, one sentence, links), design-engineer craft
(Rauno, Paco, Brittany Chiang), Anthropic's frontend guidance (one orchestrated load, distinctive type,
no Inter / purple gradients).

## Shape of the page

1. **Hero (100svh)**: the Game of Life board as it is today: name, headline, project list, drawing, seeds.
   A small scroll cue at the bottom.
2. **Content** (opaque paper, slides over the fixed board):
   1. Status line + short bio + CV / contact.
   2. Experience as case studies: CAPFI / Cerebro, CESI LINEACT.
   3. Projects in research-homepage format: media (or the seed glyph as poster), title, one sentence, stack, links.
   4. Compact: skills, education, activities, languages.
   5. Footer: GitHub, LinkedIn, CV, email.
   Everything comes from the RxResume JSON already synced into `src/data/resume.*.json`.

## Architecture

- `#stage` stays `position: fixed`, so none of the board's coordinate maths changes. A `100svh` spacer follows it,
  then `<HomeContent>` (`position: relative; z-index: 3; background: var(--paper)`).
- Scrolling is enabled on the home page only (`html.home`), so the other pages keep their current behaviour.
- The board's loop pauses when the hero is fully covered.
- On touch, a vertical drag scrolls (`touch-action: pan-y`); a tap still drops a glider.

## Waves and ownership (parallel builders, one worktree each)

Wave 0 (orchestrator): stubs `src/components/home/HomeContent.astro`, `src/components/home/ProjectMedia.astro`,
`src/styles/home.css`, and this plan.

Wave 1 (parallel):
- **A, hero shell**: `BoardPage.astro`, `global.css`, `scripts/board/index.ts`, `scripts/board/input.ts`,
  `BoardHud.astro`. Scroll, spacer, pausing, touch, scroll cue, HUD on scroll.
- **B, content sections**: `src/components/home/*` (except `ProjectMedia.astro`), `home.css`, the `home` block in i18n.
- **C, dithered media**: `ProjectMedia.astro` + `src/scripts/dither.ts`. Media drawn in the ink palette with
  ordered dithering, full colour on hover or focus; the seed glyph as a poster when there is no media.

Wave 2 (after merging wave 1):
- **D, scroll transition**: as the hero scrolls away the board slows, dims and its cells settle; content reveals
  with CSS scroll-driven animations (`animation-timeline: view()`), all off under reduced motion.
- **E, review**: bugs, accessibility, reduced motion, phone layout, performance with the CPU throttled.

Later (needs Julien): videos or screenshots of Cerebro (blurred), the VR teleoperation app and Blink.

## Rules for every builder

- `npm test` and `npm run build` must pass; commit on your branch, never push.
- Servers only on 127.0.0.1:18081.
- The phone number must never reach the site.
- Respect `prefers-reduced-motion` and the night theme (`data-theme="night"`).

## Wave 3: life leaks into the page

Feedback after launch: the hero is great, the rest is boring. The content must carry the board's identity.

- **F, pixel titles**: section titles become huge Geist Pixel words (about 3× the current size) that assemble from scattered
  cells as they enter the view, then settle into crisp text. Owns `HomeSection.astro`, new `PixelTitle.astro`,
  `src/scripts/pixel-title.ts`.
- **G, living media**: the dithered picture of a project is a Game of Life seed. Hovering (or entering the view on
  touch) runs Life on it for a moment, coloured by age like the board, then it resolves to the full-colour media.
  Owns `ProjectMedia.astro`, `src/scripts/dither.ts`.
- **H, proof and rhythm**: key figures as big pixel numerals in the experience case studies (from a small overlay,
  `src/data/highlights.ts`, FR/EN). An asymmetric project grid: the first project large, then two columns. A sharper
  about section. Owns `HomeIntro/Experience/Projects/About/Footer.astro`, `home.css`, `highlights.ts`.
- **I, glider margins**: a sparse Game of Life lives in the page's side margins. Glider guns at section edges fire
  gliders down the gutters. It only runs while visible, is cheap, and is off under reduced motion. Owns
  `HomeContent.astro`, new `MarginLife.astro`, `src/scripts/margin-life.ts`.
