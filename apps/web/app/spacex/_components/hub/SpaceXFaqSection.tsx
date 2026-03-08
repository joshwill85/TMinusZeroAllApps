import Link from 'next/link';
import type { SpaceXProgramFaqItem } from '@/lib/types/spacexProgram';

export function SpaceXFaqSection({ faqItems }: { faqItems: SpaceXProgramFaqItem[] }) {
  return (
    <section id="faq" className="scroll-mt-24 space-y-4">
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Program FAQ</h2>
        <p className="mt-2 text-sm text-text2">
          For jellyfish plume visibility and JEP scoring specifics, use the dedicated{' '}
          <Link href="/jellyfish-effect" className="text-primary hover:text-primary/80">
            jellyfish effect guide and FAQ
          </Link>
          .
        </p>
        <dl className="mt-4 space-y-4">
          {faqItems.map((entry) => (
            <div key={entry.question}>
              <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
              <dd className="mt-1 text-sm text-text2">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link
          href="/spacex/missions/starship"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Starship Mission
        </Link>
        <Link
          href="/blue-origin"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Blue Origin
        </Link>
        <Link
          href="/jellyfish-effect"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Jellyfish Effect FAQ
        </Link>
        <Link
          href="/spacex/drone-ships"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Drone Ships
        </Link>
        <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis
        </Link>
      </div>
    </section>
  );
}
