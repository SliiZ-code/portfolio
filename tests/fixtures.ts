import { parseResume, type Lang, type Resume } from '../src/lib/resume';

const NAMES = ['Jeu de la vie', 'Blink', 'Thrive', 'Worldwide Weather Watcher'];

/** A fixed resume with the four projects the board overlay knows, whatever the synced data holds. */
export const sampleResume = (lang: Lang): Resume =>
  parseResume(
    {
      basics: { name: 'Julien Petit--Colboc', headline: 'Étudiant', email: '', location: 'Rouen', website: { url: '', label: '' } },
      summary: { title: 'Profil', hidden: false, content: '<p>Bonjour</p>' },
      sections: {
        projects: {
          title: 'Projets',
          hidden: false,
          items: NAMES.map((name, index) => ({
            id: `sample-${index}`,
            hidden: false,
            name,
            period: '',
            website: { url: '', label: '' },
            description: '<p>ok</p>',
          })),
        },
      },
    },
    lang,
  );
