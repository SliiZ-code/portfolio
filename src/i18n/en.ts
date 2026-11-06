import type { UIStrings } from './fr';

const en = {
  lang: 'en',
  board: {
    title: (name: string) => `${name} — board`,
    description: (text: string) => text,
    listLabel: 'List view',
    projects: 'Projects',
    elsewhere: 'Elsewhere',
    cv: 'CV',
    contact: 'Contact',
    email: 'Email',
    generation: 'generation',
    cells: 'cells',
    hint: 'drag to draw · click empty space to drop a glider',
    scroll: 'Scroll',
    home: 'jpc',
    themeNight: 'Night mode',
    themePaper: 'Paper mode',
  },
  project: {
    back: '← back to the board',
    stamp: 'project page',
    capture: 'capture · pixelated live',
    live: '3D model · pixelated live · drag to rotate',
    loading: 'loading…',
    unavailable: '[WebGL unavailable: no experiment here]',
    noCapture: '[no capture yet]',
    visit: 'view the project ↗',
    backBoard: 'back to the board',
  },
  cv: {
    back: '← back to the board',
    stamp: 'curriculum vitæ',
    print: 'print',
    pdf: 'CV.pdf ↓',
    email: 'Email',
    location: 'Location',
    website: 'Website',
    present: 'present',
    level: 'level',
    grade: 'grade',
    projectPage: 'view the page ↗',
    contactHeading: 'Contact',
    linksHeading: 'Links',
  },
  nav: {
    language: 'Language',
    theme: 'Theme',
  },
  home: {
    status: 'Looking for a research internship abroad · from June 2027 · 12 to 17 weeks',
    footerNav: 'Links',
    cv: 'CV',
    cvPdf: 'CV (PDF)',
    about: 'About',
    moreProjects: 'More projects',
    projectPage: 'project page',
    madeWith: 'made with a Game of Life',
    top: '↑ back to top',
    /** Phrases of the bio drawn with a highlighter; each must match the summary text exactly. */
    introMarks: ['Cerebro', 'LLM', 'VR', 'abroad'],
    /** The handwritten note beside the calls to action. */
    replyNote: 'reply within 48\u00a0h',
    /** The big closing line, which links to the e-mail. */
    closing: 'Let’s talk.',
  },
} satisfies UIStrings;

export default en;
