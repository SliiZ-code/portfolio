// Magnet type: in the project index, each letter of a name swells toward the pointer. The weight of a letter
// follows its distance to the pointer on a smooth falloff, eased frame to frame, on the variable font's wght axis.
// Desktop with a mouse only, never under reduced motion. `magnetWeight` is pure and tested.

/** Weight at rest and at the pointer. */
export const REST_WEIGHT = 320;
export const PEAK_WEIGHT = 880;
/** Distance (px) at which a letter stops feeling the pointer. */
export const RADIUS = 140;
/** Share of the way to the target a letter moves each frame. */
export const EASE = 0.18;

/** The target weight of a letter at `distance` px from the pointer: a smoothstep falloff to the rest weight. */
export function magnetWeight(distance: number, radius = RADIUS, rest = REST_WEIGHT, peak = PEAK_WEIGHT): number {
  const t = Math.min(1, Math.max(0, 1 - distance / radius));
  return rest + (peak - rest) * t * t * (3 - 2 * t);
}

/** Wraps each letter of the link's text in a span; the link keeps its name for assistive tech. */
function splitLetters(link: HTMLAnchorElement): HTMLSpanElement[] {
  const text = link.textContent ?? '';
  link.setAttribute('aria-label', text);
  link.textContent = '';
  const letters: HTMLSpanElement[] = [];
  for (const word of text.split(/(\s+)/)) {
    if (/^\s+$/.test(word)) {
      link.append(word);
      continue;
    }
    const group = document.createElement('span');
    group.className = 'mt-word';
    group.setAttribute('aria-hidden', 'true');
    for (const char of Array.from(word)) {
      const span = document.createElement('span');
      span.className = 'mt-letter';
      span.textContent = char;
      group.append(span);
      letters.push(span);
    }
    link.append(group);
  }
  return letters;
}

export function initMagnetType(list: HTMLElement): void {
  const fine = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  if (!fine.matches || still.matches) return;

  const letters = [...list.querySelectorAll<HTMLAnchorElement>('.hc-project-name a')].flatMap(splitLetters);
  if (letters.length === 0) return;
  list.classList.add('is-magnet');
  const weights = new Float32Array(letters.length).fill(REST_WEIGHT);

  let px = 0;
  let py = 0;
  let inside = false;
  let frame = 0;

  const tick = () => {
    frame = 0;
    if (!fine.matches || still.matches) return;
    // read every letter's place first (one layout), then write every weight
    const targets = letters.map((letter) => {
      if (!inside) return REST_WEIGHT;
      const box = letter.getBoundingClientRect();
      return magnetWeight(Math.hypot(box.left + box.width / 2 - px, box.top + box.height / 2 - py));
    });
    let moving = false;
    for (let i = 0; i < letters.length; i++) {
      const delta = targets[i] - weights[i];
      if (Math.abs(delta) > 0.5) {
        weights[i] += delta * EASE;
        moving = true;
      } else {
        weights[i] = targets[i];
      }
      letters[i].style.setProperty('--w', weights[i].toFixed(0));
    }
    if (moving) frame = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  list.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    px = event.clientX;
    py = event.clientY;
    inside = true;
    wake();
  });
  list.addEventListener('pointerleave', () => {
    inside = false;
    wake();
  });
  // the page can scroll under a still pointer
  window.addEventListener('scroll', () => inside && wake(), { passive: true });
}
