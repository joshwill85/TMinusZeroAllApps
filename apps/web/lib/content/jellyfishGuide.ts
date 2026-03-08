export type JellyfishGuideSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export type JellyfishGuideTocItem = {
  id: string;
  label: string;
};

export const JELLYFISH_GUIDE_LAST_UPDATED = '2026-03-05';

export const JELLYFISH_GUIDE_TITLE =
  'The Rocket Jellyfish Effect: What It Is and How to See One';

export const JELLYFISH_GUIDE_INTRO =
  "You're watching a rocket climb into a twilight sky. Then the trail blooms — a glowing dome spreading outward like something alive, tendrils drifting behind it. It looks like a giant luminous jellyfish floating through space. You're not imagining things. This is real, it has a name, and with the right timing, you can plan to see one.";

export const JELLYFISH_ALIAS_LABELS = [
  'Space jellyfish',
  'Rocket jellyfish',
  'Twilight plume',
  'Jellyfish UFO',
  'That weird glowing cloud'
] as const;

export const JELLYFISH_ALIAS_NOTE =
  'People sometimes call spirals "jellyfish" too, but they\'re different phenomena (more on that below).';

export const JELLYFISH_QUICK_VIBE =
  "Not a UFO. Not an explosion. Not secret alien propulsion. Just rocket exhaust catching sunlight at the exact right moment — and looking absolutely unreal because of it.";

export const JELLYFISH_QUICK_ANSWER =
  "A rocket's exhaust expands massively once it reaches thin upper atmosphere. When that happens during twilight — with the rocket in sunlight but you in darkness — the plume glows against the dark sky. The shape, the tendrils, the organic movement... your brain reads it as a giant glowing sea creature. Because honestly, that's exactly what it looks like.";

export const JELLYFISH_GUIDE_SECTIONS: JellyfishGuideSection[] = [
  {
    id: 'what-it-is',
    title: 'What You\'re Actually Seeing',
    paragraphs: [
      'The jellyfish effect is an optical phenomenon. Rocket exhaust stays lit by the sun while the ground below has already slipped into twilight or darkness.',
      'From where you stand, it looks like a glowing bell, a translucent dome, or a bright core with drifting streamers. The shape keeps changing — expanding, rippling, splitting into layers. Your eyes don\'t know how to categorize it because you\'ve never seen anything like it.'
    ]
  },
  {
    id: 'why-plumes-bloom',
    title: 'Why the Plume Expands Like That',
    paragraphs: [
      'Near the ground, rocket exhaust stays relatively narrow. Air pressure keeps it contained. But as the rocket climbs, pressure drops fast. By the time it hits the upper atmosphere, there\'s almost nothing holding the exhaust together anymore.',
      'The plume spreads outward aggressively — ballooning into a massive cloud. Sunlight catches this expanded surface, and suddenly you\'ve got a three-dimensional glowing structure where there used to be a thin trail. The colors come from light scattering at different angles, not from exotic fuel chemistry.'
    ]
  },
  {
    id: 'geometry',
    title: 'The Three Things That Have to Line Up',
    paragraphs: [
      'Jellyfish visibility comes down to geometry. Three conditions, and all three have to work:',
      'First, you need to be in darkness or twilight. The darker your sky, the better the contrast. Second, the plume up there needs sunlight. The rocket has to be high enough that the sun still hits the exhaust even though it\'s already set for you. Third, you need a clear view toward the launch corridor — buildings, trees, or clouds in the wrong place will block it.'
    ],
    bullets: [
      'Your sky: dark enough for contrast',
      'The plume: still catching sunlight at altitude',
      'Your sightline: clear toward the rocket\'s path'
    ]
  },
  {
    id: 'minute-by-minute',
    title: 'How It Unfolds (Minute by Minute)',
    paragraphs: [
      'Strong jellyfish events follow a pattern. Knowing what to expect helps you not look away at the wrong moment.'
    ],
    bullets: [
      'T+0 to T+1: Looks like a normal launch — bright point, regular trail. Nothing special yet.',
      'T+1 to T+3: The bloom starts. The trail fans out into that dome or umbrella shape. This is when people start grabbing their phones.',
      'T+2 to T+8: Complex structures appear — bright knots, layered shells, streamers that look like tentacles. Wind shear and stage events make it seem alive.',
      'T+5 to T+30: The glow fades as geometry shifts. What\'s left is a broad, ghostly veil that slowly disperses.'
    ]
  },
  {
    id: 'best-times',
    title: 'When to Watch For It',
    paragraphs: [
      'The sweet spot is a narrow window around sunrise or sunset. Too early, your sky is too bright for contrast. Too late, the plume can\'t catch sunlight anymore.',
      'This is why launch delays matter more than you\'d think. Earth keeps rotating. A 30-minute slip can move a launch completely out of the optimal window. A launch that looked perfect on paper might produce nothing visible if it slides into full darkness.'
    ]
  },
  {
    id: 'viewing-range',
    title: 'How Far Away Can You See It?',
    paragraphs: [
      'Farther than you\'d expect. The plume is high, bright, and huge. Distance alone rarely kills visibility.',
      'What kills it: low clouds blocking your view, haze reducing contrast, city light pollution washing out detail, or trees and buildings cutting off your horizon. The plume can be spectacular 200 miles away — you just need a clear channel to see it.'
    ]
  },
  {
    id: 'jellyfish-vs-spiral',
    title: 'Jellyfish vs. Spiral — Not the Same Thing',
    paragraphs: [
      'People use "jellyfish" to describe any weird launch phenomenon, but spirals are actually different.',
      'Jellyfish happen during ascent — broad, organic plume expansion in twilight light. Spirals usually show up later, often from upper-stage fuel venting or spinning debris. They look more symmetric and circular, like a perfect expanding ring. Both are real. Both look wild. But they\'re caused by different things.'
    ]
  },
  {
    id: 'hard-science',
    title: 'The Numbers (For the Skeptics)',
    paragraphs: [
      'For anyone who wants the peer-reviewed version: these clouds get genuinely massive. In strong cases, the illuminated cloud can cover an area larger than Texas. These are measured ranges from published research, not guesses.',
      'The scale surprises people. A single launch can temporarily punch a 900+ km hole in the ionosphere. The plume can expand at 2-3 km per second. We\'re not talking about subtle atmospheric effects — we\'re talking about structures visible across entire regions.'
    ],
    bullets: [
      'Plume expansion: 0.5-3 km/s depending on altitude and conditions',
      'Cloud diameter: can exceed 1,500 km in favorable conditions',
      'Ionosphere effects: documented depletions over 900 km wide, recovering in 2-3 hours',
      'Current global impact: less than 0.1% annual stratospheric ozone, though projections rise with launch rates'
    ]
  },
  {
    id: 'maximize-chances',
    title: 'How to Actually See One',
    paragraphs: [
      'Treat a high-probability launch like a field operation, not a casual glance out the window. Most missed events are execution failures — people who showed up late, faced the wrong direction, or gave up too early.'
    ],
    bullets: [
      'Arrive before T-0 with time to spare. Rushing in at liftoff means you\'re not set up.',
      'Know where to look. Pad direction for liftoff, then track the expected trajectory downrange.',
      'Pick a spot with good horizon. A rooftop beats a parking lot. An open field beats a city street.',
      'Stay for at least 10 minutes. The best visuals sometimes come at T+5 or later.'
    ]
  },
  {
    id: 'photograph-it',
    title: 'Taking Photos Without Missing the Show',
    paragraphs: [
      'Real talk: if you spend the whole event looking at your phone screen, you\'ll get footage but miss the experience. Phone cameras struggle with bright rocket flame versus dim plume detail — auto-exposure can\'t handle both.',
      'A better approach: watch with your eyes for the first minute or two. Once the big structure forms and you know what you\'re working with, then grab the camera.'
    ],
    bullets: [
      'Video: start at T-0, wide frame, lock exposure if your app allows it',
      'Photos: wide lens, shoot bursts during brightness transitions',
      'Post-processing: go easy. Heavy filters make real footage look fake and feed misinformation'
    ]
  },
  {
    id: 'misconceptions',
    title: 'Why People Get It Wrong',
    paragraphs: [
      'Misidentification is normal. The event is rare, high-contrast, and changes fast. Most people have never seen anything like it, so their brain reaches for explanations: UFO, explosion, some kind of weapon test.',
      'Two people in nearby towns can have completely different experiences. One catches it perfectly through a gap in the clouds; the other sees nothing because of a treeline. Twilight alone doesn\'t guarantee a jellyfish — geometry has to be right, weather has to cooperate, and you have to be looking in the right direction at the right time.'
    ]
  },
  {
    id: 'using-jep',
    title: 'Using JEP to Plan Your Night',
    paragraphs: [
      'JEP — Jellyfish Exposure Potential — is our way of turning the physics into a planning tool. It shows up on launch detail pages as a score and probability estimate.',
      'JEP combines timing geometry, sun angle, and weather forecasts to give you a read on whether tonight\'s launch is worth rearranging your evening for. It updates as conditions change.',
      'Important caveat: JEP is a decision tool, not a promise. High JEP means conditions look favorable. Low JEP means geometry is weak right now. But local weather, last-minute schedule changes, and your specific viewing location all matter.'
    ],
    bullets: [
      'High JEP: worth prioritizing — show up early, stay for 10+ minutes',
      'Medium JEP: worth the effort, but outcomes depend more on local conditions',
      'Low JEP: geometry isn\'t great, though conditions can improve if timing shifts',
      'Pro tip: track how JEP changes as you get closer to T-0, not just a single snapshot'
    ]
  }
];

export const JELLYFISH_GUIDE_TOC: JellyfishGuideTocItem[] = [
  ...JELLYFISH_GUIDE_SECTIONS.map((section) => ({ id: section.id, label: section.title })),
  { id: 'faq', label: 'FAQ' }
];

export const JELLYFISH_GUIDE_WORD_COUNT = countWords([
  JELLYFISH_GUIDE_TITLE,
  JELLYFISH_GUIDE_INTRO,
  JELLYFISH_QUICK_VIBE,
  JELLYFISH_QUICK_ANSWER,
  ...JELLYFISH_GUIDE_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs, ...(section.bullets || [])])
]);

function countWords(values: string[]) {
  const text = values
    .join(' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 0;
  return text.split(' ').length;
}
