import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Media {
  video?: string;
  image?: string;
  /** The image as WebP, when a file of that name exists: the smaller source for a browser that reads it. */
  webp?: string;
}

const VIDEOS = ['mp4', 'webm'];
const IMAGES = ['jpg', 'jpeg', 'png', 'webp'];

const MEDIA_DIR = join(process.cwd(), 'public', 'media');

/** Build-time check (Astro runs from the project root): is there a file in public/media? */
const inMediaDir = (file: string): boolean => existsSync(join(MEDIA_DIR, file));

/**
 * A capture dropped in public/media as `<slug>.<ext>` needs no other setup. The first slug
 * that has a file wins; for one slug a video wins over an image, and an image gets its
 * `<slug>.webp` twin when there is one.
 */
export function findMedia(slugs: string[], exists: (file: string) => boolean = inMediaDir): Media | undefined {
  for (const slug of slugs) {
    if (!slug) continue;
    const video = VIDEOS.find((ext) => exists(`${slug}.${ext}`));
    if (video) return { video: `/media/${slug}.${video}` };
    const image = IMAGES.find((ext) => exists(`${slug}.${ext}`));
    if (image) {
      const twin = image !== 'webp' && exists(`${slug}.webp`);
      return { image: `/media/${slug}.${image}`, ...(twin ? { webp: `/media/${slug}.webp` } : {}) };
    }
  }
  return undefined;
}
