import { redirect } from 'next/navigation';
import { buildPreferencesHref } from '@tminuszero/navigation';

export default function LegacyPreferencesRedirectPage() {
  redirect(buildPreferencesHref());
}
