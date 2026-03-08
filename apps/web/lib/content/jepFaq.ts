export type JepFaqItem = {
  question: string;
  answer: string;
};

export const JEP_FAQ_LAST_UPDATED = '2026-03-05';

export const JEP_FAQ_ITEMS: JepFaqItem[] = [
  {
    question: 'What exactly is the jellyfish effect?',
    answer:
      "It's a twilight phenomenon where rocket exhaust expands at high altitude and stays lit by the sun while you're in darkness below. The glowing plume looks like a giant jellyfish — dome-shaped body, trailing tendrils, the whole thing."
  },
  {
    question: 'Why does the plume glow when it\'s dark outside?',
    answer:
      "Altitude. The rocket climbs high enough that sunlight still hits the exhaust even after sunset (or before sunrise) at ground level. Meanwhile, the expanded plume acts like a massive screen catching that light against your darker sky."
  },
  {
    question: 'Is this a UFO or something dangerous?',
    answer:
      "No. It's well-understood physics — dark foreground, sunlit high-altitude exhaust, atmospheric expansion. Looks wild, but the explanation is straightforward. It's not a hazard to viewers under normal launch conditions."
  },
  {
    question: 'How far away can you see one?',
    answer:
      "Pretty far, honestly. The plume is big, bright, and high. Distance isn't usually the problem — clouds, haze, light pollution, and blocked horizons are what stop most people from seeing it."
  },
  {
    question: 'When\'s the best time to catch one?',
    answer:
      "Twilight launches — around sunrise or sunset. You need enough darkness for contrast but the right sun angle to illuminate the plume. That window is narrow, which is why not every launch produces one."
  },
  {
    question: 'What\'s JEP?',
    answer:
      "Jellyfish Exposure Potential. It's our estimate of how likely you are to see a jellyfish effect for a given launch. Shows up as a score and probability on launch detail pages."
  },
  {
    question: 'What does the JEP percentage mean?',
    answer:
      "It's a likelihood estimate. Higher numbers mean timing, sun angle, and conditions look more favorable. Lower numbers mean the geometry isn't ideal. It's not a guarantee either way."
  },
  {
    question: 'What goes into the JEP calculation?',
    answer:
      "Four main things: twilight geometry (sun angle vs. launch time), launch schedule certainty, expected line-of-sight from your region, and weather visibility factors like cloud cover."
  },
  {
    question: 'Where does the data come from?',
    answer:
      "Launch schedules and mission data come from Launch Library 2. Weather inputs use Open-Meteo as the primary source with NOAA NWS as backup."
  },
  {
    question: 'JEP changed since yesterday. Why?',
    answer:
      "Probably a schedule shift, window adjustment, or forecast update. JEP recalculates as inputs change. A launch moving 30 minutes can significantly change the score."
  },
  {
    question: 'JEP was high but I didn\'t see anything. What happened?',
    answer:
      "Local conditions. Cloud cover in your specific spot, haze you couldn't see through, something blocking your horizon, or a last-minute schedule change after JEP was calculated. The physics worked — your viewing situation didn't."
  },
  {
    question: 'JEP was low but people posted amazing photos. How?',
    answer:
      "They had better geometry or clearer weather. Someone 50 miles away with a perfect horizon and no haze can have a completely different experience than someone in the city with a blocked view."
  },
  {
    question: 'Are spirals and jellyfish the same?',
    answer:
      "Not quite. Both involve sunlit exhaust, but spirals usually come from upper-stage venting or spin dynamics — more symmetric and circular. Jellyfish are the broader, organic-looking plume expansion during ascent."
  },
  {
    question: 'How do I actually maximize my chances?',
    answer:
      "Check JEP before the launch. Get to a spot with a clear low horizon. Face the launch direction. Arrive before T-0. And stay for at least 10 minutes — sometimes the best visuals come after the initial bloom."
  },
  {
    question: 'Does JEP track my location?',
    answer:
      "JEP works without location tracking. If you enable location features on your account, that can improve local relevance, but it's optional."
  },
  {
    question: 'Why did you build JEP?',
    answer:
      "People kept asking which launches would produce jellyfish effects. JEP gives you a quick read on whether a launch is worth planning your evening around."
  }
];

export const JEP_GLOSSARY: Array<{ term: string; definition: string }> = [
  {
    term: 'NET',
    definition: 'No Earlier Than. The earliest scheduled liftoff time.'
  },
  {
    term: 'Launch window',
    definition: 'A time range in which launch can occur while still meeting mission constraints.'
  },
  {
    term: 'Twilight plume',
    definition: 'Sunlit rocket exhaust visible against a darker local sky.'
  }
];
