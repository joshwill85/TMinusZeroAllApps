import { fetchArtemisTimelineViewModel } from '@/lib/server/artemisUi';

async function main() {
  const view = await fetchArtemisTimelineViewModel({
    mode: 'explorer',
    mission: 'all',
    sourceType: 'all',
    sourceClass: 'all',
    includeSuperseded: false,
    from: null,
    to: null,
    cursor: null,
    limit: 100
  });

  const refreshed = view.events
    .filter((event) => event.title.toLowerCase().includes('refreshed'))
    .map((event) => ({
      id: event.id,
      title: event.title,
      summary: event.summary,
      date: event.date,
      sourceType: event.source.type,
      sourceHref: event.source.href || null,
      status: event.status
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const keyCounts: Record<string, number> = {};
  for (const item of refreshed) {
    const day = item.date.slice(0, 10);
    const key = `${item.title}|${item.sourceType}|${day}`;
    keyCounts[key] = (keyCounts[key] || 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        totalEvents: view.events.length,
        refreshedEvents: refreshed.length,
        refreshed,
        keyCounts
      },
      null,
      2
    )
  );
}

void main();
