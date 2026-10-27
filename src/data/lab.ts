import type { Lang } from '../lib/resume';

export interface Experiment {
  slug: string;
  title: Record<Lang, string>;
  description: Record<Lang, string>;
  /** What the lab page mounts for this experiment. */
  kind: 'pixel-model';
  /** Source of the experiment's asset. */
  src: string;
}

export const EXPERIMENTS: Experiment[] = [
  {
    slug: 'arduino-pixels',
    title: { fr: "L'Arduino en pixels", en: 'The Arduino in pixels' },
    description: {
      fr: 'Un modèle 3D d’Arduino, rendu en direct avec three.js puis pixelisé en cinq niveaux d’encre. Glisse pour le faire tourner.',
      en: 'A 3D model of an Arduino, rendered live with three.js and pixelated to five ink levels. Drag to rotate it.',
    },
    kind: 'pixel-model',
    src: '/media/arduino.glb',
  },
];
