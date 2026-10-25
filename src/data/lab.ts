import type { Lang } from '../lib/resume';

export interface Experiment {
  slug: string;
  title: Record<Lang, string>;
  description: Record<Lang, string>;
  /** What the lab page mounts for this experiment. */
  kind: 'ascii-model';
  /** Source of the experiment's asset. */
  src: string;
}

export const EXPERIMENTS: Experiment[] = [
  {
    slug: 'arduino-ascii',
    title: { fr: "L'Arduino en ASCII", en: 'The Arduino as ASCII' },
    description: {
      fr: 'Un modèle 3D d’Arduino, dessiné en caractères en direct avec three.js. Glisse pour le faire tourner.',
      en: 'A 3D model of an Arduino, drawn live in characters with three.js. Drag to rotate it.',
    },
    kind: 'ascii-model',
    src: '/media/arduino.glb',
  },
];
