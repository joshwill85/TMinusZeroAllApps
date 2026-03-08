import { FAQ_REGISTRY } from '@/lib/content/faq/registry';
import type { FaqCanonicalEntry, FaqRenderItem, FaqSurfaceId, FaqTemplateContext } from '@/lib/content/faq/types';

export type FaqQuestionAnswer = {
  question: string;
  answer: string;
};

export type FaqQuestionAnswerShort = {
  q: string;
  a: string;
};

export function getFaqEntriesForSurface(surface: FaqSurfaceId, context: FaqTemplateContext = {}): FaqRenderItem[] {
  return FAQ_REGISTRY.filter((entry) => entry.surfaces.includes(surface))
    .sort((a, b) => a.order - b.order)
    .map((entry) => renderEntry(entry, context));
}

export function resolveDocsFaqEntries(): FaqQuestionAnswer[] {
  return toQuestionAnswer(getFaqEntriesForSurface('docs-faq'));
}

export function resolveHomeFaqEntries(): FaqQuestionAnswerShort[] {
  return getFaqEntriesForSurface('home').map((entry) => ({
    q: entry.question,
    a: entry.answer
  }));
}

export function resolveArtemisFaq(scope: 'program' | 'mission'): FaqQuestionAnswer[] {
  return toQuestionAnswer(getFaqEntriesForSurface(scope === 'mission' ? 'artemis-mission' : 'artemis-program'));
}

export function resolveArtemisMissionPageFaq(missionKey: 'artemis-i' | 'artemis-iii'): FaqQuestionAnswer[] {
  const surface = missionKey === 'artemis-i' ? 'artemis-i-page' : 'artemis-iii-page';
  return toQuestionAnswer(getFaqEntriesForSurface(surface));
}

export function resolveArtemisWorkbenchFaq(missionKey: 'artemis-i' | 'artemis-iii'): FaqQuestionAnswer[] {
  const surface = missionKey === 'artemis-i' ? 'artemis-workbench-artemis-i' : 'artemis-workbench-artemis-iii';
  return toQuestionAnswer(getFaqEntriesForSurface(surface));
}

export function resolveStarshipFaq(scope: 'program' | 'flight', flightNumber?: number): FaqQuestionAnswer[] {
  if (scope === 'program') return toQuestionAnswer(getFaqEntriesForSurface('starship-program'));

  const normalized = Number.isFinite(flightNumber as number)
    ? Math.max(1, Math.trunc(Number(flightNumber)))
    : undefined;

  return toQuestionAnswer(
    getFaqEntriesForSurface('starship-flight', {
      flightNumber: normalized
    })
  );
}

export function resolveContractsCanonicalFaq(scope: 'index' | 'detail'): FaqQuestionAnswer[] {
  const surface =
    scope === 'detail'
      ? 'contracts-canonical-detail'
      : 'contracts-canonical-index';
  return toQuestionAnswer(getFaqEntriesForSurface(surface));
}

function toQuestionAnswer(entries: FaqRenderItem[]): FaqQuestionAnswer[] {
  return entries.map((entry) => ({ question: entry.question, answer: entry.answer }));
}

function renderEntry(entry: FaqCanonicalEntry, context: FaqTemplateContext): FaqRenderItem {
  return {
    id: entry.id,
    question: renderTemplate(entry.question, context),
    answer: renderTemplate(entry.answer, context)
  };
}

function renderTemplate(value: string, context: FaqTemplateContext): string {
  const flightNumberLabel =
    context.flightNumber != null && Number.isFinite(context.flightNumber)
      ? String(Math.max(1, Math.trunc(context.flightNumber)))
      : 'this';

  return value.replace(/\{\{\s*flightNumber\s*\}\}/g, flightNumberLabel);
}
