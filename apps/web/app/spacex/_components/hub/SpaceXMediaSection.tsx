import { XTweetEmbed } from '@/components/XTweetEmbed';
import { SPACEX_IMAGE_POLICY_NOTES, SPACEX_MEDIA_ARCHIVE } from '@/lib/content/programMedia';
import type { SpaceXEmbeddedPost, SpaceXVideoArchiveEntry } from '@/lib/utils/spacexHub';

export function SpaceXMediaSection({
  embeddedPosts,
  videoArchive
}: {
  embeddedPosts: SpaceXEmbeddedPost[];
  videoArchive: SpaceXVideoArchiveEntry[];
}) {
  return (
    <section id="media" className="scroll-mt-24">
      <section className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-text1">Latest SpaceX posts (X)</h2>
            <a
              href="https://x.com/SpaceX"
              target="_blank"
              rel="noreferrer"
              className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80"
            >
              Official feed
            </a>
          </div>
          {embeddedPosts.length ? (
            <ul className="mt-3 space-y-3">
              {embeddedPosts.map((post) => (
                <li key={post.id} className="overflow-hidden rounded-xl border border-stroke bg-surface-0 p-2">
                  <XTweetEmbed tweetId={post.tweetId} tweetUrl={post.tweetUrl} theme="dark" conversation="none" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text3">No embedded X posts are currently available.</p>
          )}
        </section>

        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Official media archive</h2>
          <ul className="mt-3 space-y-2 text-sm text-text2">
            {SPACEX_MEDIA_ARCHIVE.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                <div className="flex items-center justify-between gap-2">
                  <a href={entry.url} target="_blank" rel="noreferrer" className="font-semibold text-text1 hover:text-primary">
                    {entry.title}
                  </a>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-text3">{entry.kind}</span>
                </div>
                <p className="mt-1 text-xs text-text3">{entry.notes}</p>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-text3">Tracked webcast/video archive</p>
            {videoArchive.length ? (
              <ul className="mt-2 space-y-2 text-xs text-text2">
                {videoArchive.map((entry) => (
                  <li key={entry.id}>
                    <a href={entry.url} target="_blank" rel="noreferrer" className="font-semibold text-text1 hover:text-primary">
                      {entry.label}
                    </a>
                    <p className="mt-0.5 text-text3">
                      {entry.launchName} • {entry.dateLabel}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-text3">No webcast links are currently present in the launch snapshot.</p>
            )}
          </div>
          <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-text3">Image use policy checks</p>
            <ul className="mt-2 space-y-2 text-xs text-text2">
              {SPACEX_IMAGE_POLICY_NOTES.map((note) => (
                <li key={note.id}>
                  <a href={note.url} target="_blank" rel="noreferrer" className="font-semibold text-text1 hover:text-primary">
                    {note.title}
                  </a>
                  <p className="mt-0.5 text-text3">{note.guidance}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </section>
    </section>
  );
}
