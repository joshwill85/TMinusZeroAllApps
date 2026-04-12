import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import {
  buildBreadcrumbJsonLd,
  buildPageMetadata,
  buildWebPageJsonLd
} from '@/lib/server/seo';
import { AboutPortrait } from '@/components/AboutPortrait';

const ABOUT_TITLE = `About ${BRAND_NAME} | Launch Tracker Story & Mission`;
const ABOUT_DESCRIPTION = `Learn why ${BRAND_NAME} exists, who built it, and the mission behind this rocket launch tracker.`;

export const metadata: Metadata = buildPageMetadata({
  title: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  canonical: '/about'
});

export default function AboutPage() {
  const jsonLd = [
    buildBreadcrumbJsonLd([
      { name: 'Home', item: '/' },
      { name: 'About', item: '/about' }
    ]),
    buildWebPageJsonLd({
      canonical: '/about',
      name: 'About T-Minus Zero',
      description: ABOUT_DESCRIPTION
    })
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:px-8">
      <JsonLd data={jsonLd} />
      <div className="flex flex-col gap-6">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.14em] text-text3">
            About Me
          </p>
          <h1 className="text-3xl font-semibold text-text1">
            Hi, I&apos;m Josh.
          </h1>
          <p className="max-w-2xl text-sm text-text2">
            I was born and raised in Central Florida, around Orlando — close
            enough to the Space Coast that launches weren&apos;t just something
            you read about. On the right day, they were something you could
            experience.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-6 rounded-2xl border border-stroke bg-surface-1 p-6 text-sm text-text2">
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-text1">
                Where it started
              </h2>
              <p>
                As a kid, I learned pretty quickly that space doesn&apos;t
                always announce itself with a big visible show.
              </p>
              <p>
                Sometimes it was just a normal evening at home… and then two
                sharp cracks would roll in from the east. The windows would
                buzz. The walls would thump — not like thunder, more like the
                house itself had flinched.
              </p>
              <p>
                That&apos;s the kind of moment Central Florida space fans
                recognize: a booster coming back, a mission with a
                return-to-land profile where the first stage descends toward
                Cape Canaveral and the sonic booms can carry inland. Not every
                launch does it, and not everyone in Florida hears it — but when
                it lines up, you don&apos;t forget it.
              </p>
              <p>
                Back then, those moments felt like magic. Space didn&apos;t feel
                distant. It felt nearby.
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-text1">
                Then I lost the spark
              </h2>
              <p>
                School turned into work. Work turned into responsibility. The
                days got louder and faster, and somewhere along the way, space
                became a &quot;later&quot; thing. I still cared — but it
                wasn&apos;t that electric, stop-you-in-your-tracks kind of
                wonder anymore.
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-text1">
                The spark came back
              </h2>
              <p>In 2021, my wife and I had our daughter, Winnie.</p>
              <p>
                And not long after, I saw it — that same look I remember from my
                childhood — when she stared up at the sky like it was trying to
                tell her something. &quot;Space.&quot; &quot;Star.&quot; Simple
                words, huge meaning. Watching her light up didn&apos;t just
                remind me why I loved it… it pulled that part of me back to the
                surface.
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-text1">
                Artemis reminded me to look up
              </h2>
              <p>
                In 2022, I watched the Artemis I night launch. I didn&apos;t
                wake Winnie — she was only one — and I still regret it.
              </p>
              <p>
                The sky didn&apos;t just glow. It transformed. Like Florida got
                a brief second sunrise and everyone got the same message: go
                outside. Look up.
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-text1">
                Then SpaceX did something that felt impossible
              </h2>
              <p>
                And then came the moment that didn&apos;t just bring the spark
                back — it amplified it.
              </p>
              <p>
                I watched SpaceX do something that looked like straight-up
                science fiction: a giant booster returning to the launch site
                and getting caught by the tower&apos;s massive mechanical arms —
                the &quot;chopsticks.&quot; No landing legs. No gentle touchdown
                on a pad out in the distance. Just a controlled descent into a
                robotic catch like the future showed up early.
              </p>
              <p>
                That&apos;s when it clicked for me: this isn&apos;t just
                &quot;cool rockets.&quot; We&apos;re watching a new era get
                built in real time.
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-text1">
                Why I built this site
              </h2>
              <p>
                This started as a passion project — but honestly, it&apos;s a
                time-with-my-daughter project.
              </p>
              <p>
                Launch info is often scattered, easy to miss, and weirdly hard
                to follow if your goal is simple: step outside and share the
                moment with someone you love.
              </p>
              <p>So I built one place that makes it easy to:</p>
              <ul className="space-y-2 pl-4">
                <li className="list-disc">
                  See what&apos;s launching and when (including clear
                  &quot;NET&quot; timing when that&apos;s all we&apos;ve got)
                </li>
                <li className="list-disc">
                  Get reminders so you actually go outside
                </li>
                <li className="list-disc">
                  Catch the most relevant updates without hunting aimlessly
                </li>
              </ul>
              <p>
                Because in Central Florida, the best space moments aren&apos;t
                just the ones you stream — they&apos;re the ones you feel in
                real life: the bright streak in the distance, the sky changing
                color… and, on certain landings, that unmistakable double-boom
                that reminds you the mission didn&apos;t just go up — it came
                back.
              </p>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="overflow-hidden rounded-2xl border border-stroke bg-surface-1">
              <AboutPortrait
                src="/assets/images/about/AboutMe_Josh_Winnie.jpg"
                alt="Josh and Winnie smiling together"
              />
            </div>

            <div className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] p-5 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.14em] text-text3">
                The goal
              </div>
              <p className="mt-3 text-lg font-semibold text-text1">
                More launches watched. More &quot;look up&quot; moments. More
                memories that stick.
              </p>
              <p className="mt-3">
                And if this site ever makes enough to pay for itself (and then
                some), my first proceeds goal is simple: buy our first telescope
                — so I can show Winnie Jupiter&apos;s moons and Saturn&apos;s
                rings in a way that makes the universe feel personal.
              </p>
            </div>

            <div className="rounded-2xl border border-stroke bg-surface-1 p-5">
              <p className="text-sm text-text2">
                Thanks for being here. If this site helps you catch a launch you
                would&apos;ve missed — that&apos;s a win.
              </p>
              <p className="mt-4 text-sm font-semibold text-text1">— Josh</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
