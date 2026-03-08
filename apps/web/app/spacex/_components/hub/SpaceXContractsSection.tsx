import Link from 'next/link';
import { ProgramContractDiscoveryList } from '@/components/contracts/ProgramContractDiscoveryList';
import { buildSpaceXContractSlug } from '@/lib/server/spacexProgram';
import type { ContractStoryDiscoveryItem } from '@/lib/types/contractsStory';
import type { SpaceXContract } from '@/lib/types/spacexProgram';

export function SpaceXContractsSection({
  contracts,
  discoveryItems
}: {
  contracts: SpaceXContract[];
  discoveryItems: ContractStoryDiscoveryItem[];
}) {
  return (
    <section id="contracts" className="scroll-mt-24 space-y-4">
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Contracts and procurement</h2>
        {contracts.length ? (
          <ul className="mt-3 space-y-2 text-sm text-text2">
            {contracts.slice(0, 8).map((contract) => (
              <li key={contract.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/spacex/contracts/${buildSpaceXContractSlug(contract.contractKey)}`}
                    className="font-semibold text-text1 hover:text-primary"
                  >
                    {contract.title}
                  </Link>
                  <span className="text-xs text-text3">{contract.awardedOn || 'Date pending'}</span>
                </div>
                <p className="mt-1">{contract.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text3">
                  <span>{contract.agency || contract.customer || 'Public record'}</span>
                  {contract.sourceUrl ? (
                    <a href={contract.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
                      Source
                    </a>
                  ) : null}
                </div>
                <div className="mt-3 rounded-md border border-stroke/70 bg-surface-1/40 p-2 text-[11px] text-text3">
                  {contract.storyPresentation?.state === 'exact' && contract.contractStory ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-success">
                            Exact story
                          </span>
                          <span>
                            {contract.contractStory.actionCount} actions • {contract.contractStory.noticeCount} notices • {contract.contractStory.spendingPointCount} spending points
                          </span>
                        </div>
                        {contract.storyPresentation.canonicalPath ? (
                          <Link
                            href={contract.storyPresentation.canonicalPath}
                            className="rounded border border-stroke px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-text2 hover:text-text1"
                          >
                            Open full story
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ) : contract.storyPresentation?.state === 'lead' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
                          Related leads
                        </span>
                        <span>
                          {contract.storyPresentation.leadCount} SAM record{contract.storyPresentation.leadCount === 1 ? '' : 's'} tracked separately until an exact story join lands.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-stroke px-2 py-0.5">
                        Story pending
                      </span>
                      <span>No exact contract story is attached yet.</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No contract records are currently available.</p>
        )}
        <div className="mt-3">
          <Link href="/spacex/contracts" className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80">
            Open contracts page
          </Link>
        </div>
      </section>

      <ProgramContractDiscoveryList
        title="Related procurement leads"
        subtitle="Relevant SpaceX procurement records that are tracked separately until an exact contract-story join lands."
        items={discoveryItems}
        emptyMessage="Relevant SAM.gov leads will appear here when records are related to SpaceX but not yet safely attached to an exact contract story."
      />
    </section>
  );
}
