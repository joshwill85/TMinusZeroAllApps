import { LegalSummaryScreen } from '@/src/features/account/LegalSummaryScreen';

export default function DataAttributionRoute() {
  return (
    <LegalSummaryScreen
      testID="legal-data-screen"
      eyebrow="Legal"
      title="Data & Attribution"
      description="Data sources, attribution, and usage notes for T-Minus Zero."
      lastUpdated="Jan 20, 2026"
      actions={[
        { label: 'Privacy notice', href: '/legal/privacy' },
        { label: 'Privacy choices', href: '/legal/privacy-choices', variant: 'secondary' }
      ]}
      sections={[
        {
          title: 'Core feed sources',
          body: 'The app uses a mix of launch, news, and catalog providers to keep the customer surfaces current.',
          bullets: [
            'Launch, status, and trajectory data are pulled from the shared launch API.',
            'News, contracts, satellites, and catalog content come from their respective native API slices.',
            'External resources remain external and are not re-hosted inside the app.'
          ]
        },
        {
          title: 'Feature-specific sources',
          body: 'Some customer surfaces depend on specialty feeds or derived views for richer context.',
          bullets: [
            'Program hubs combine canonical route data with content-specific views.',
            'Reference pages can include derived launch associations and owner metadata.',
            'Attribution and source notes should stay visible wherever the data is presented.'
          ]
        },
        {
          title: 'Usage notes',
          body: 'Source-specific limitations are expected and should be presented as part of the product rather than hidden.',
          bullets: [
            'Not every surface will have complete history.',
            'Pending records may appear before story joins land.',
            'Mobile should keep first-party routing native whenever possible.'
          ]
        }
      ]}
    />
  );
}
