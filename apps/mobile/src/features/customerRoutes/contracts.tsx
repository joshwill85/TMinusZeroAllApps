import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { CanonicalContractDetailV1, CanonicalContractsResponseV1 } from '@tminuszero/contracts';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { formatRouteDate, openExternalCustomerUrl, RouteKeyValueRow, RouteListRow } from './shared';
import { useCanonicalContractDetailQuery, useCanonicalContractsQuery } from './queries';

const CONTRACT_SCOPES: Array<CanonicalContractsResponseV1['scope']> = ['all', 'spacex', 'blue-origin', 'artemis'];

export function ContractsIndexScreen() {
  const router = useRouter();
  const [scope, setScope] = useState<CanonicalContractsResponseV1['scope']>('all');
  const [queryText, setQueryText] = useState('');
  const query = useCanonicalContractsQuery({
    scope,
    q: queryText.trim() || null
  });
  const payload = query.data as CanonicalContractsResponseV1 | null;
  const items: CanonicalContractsResponseV1['items'] = payload?.items ?? [];
  const stats = useMemo(() => payload?.totals ?? null, [payload]);

  return (
    <AppScreen testID="contracts-screen">
      <CustomerShellHero eyebrow="Contracts" title={payload?.title ?? 'Government Contracts'} description={payload?.description ?? 'Canonical contract intelligence with exact and pending story joins.'}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={payload ? `${items.length} rows` : 'Loading'} tone="accent" />
          <CustomerShellBadge label={scope} />
          {queryText.trim() ? <CustomerShellBadge label={queryText.trim()} tone="warning" /> : null}
        </View>
      </CustomerShellHero>

      {stats ? (
        <CustomerShellPanel title="Snapshot" description="The current contract inventory summary.">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <CustomerShellMetric label="All" value={String(stats.all)} />
            <CustomerShellMetric label="Exact" value={String(stats.exact)} />
            <CustomerShellMetric label="Pending" value={String(stats.pending)} />
            <CustomerShellMetric label="SpaceX" value={String(stats.spacex)} />
            <CustomerShellMetric label="Blue Origin" value={String(stats.blueOrigin)} />
            <CustomerShellMetric label="Artemis" value={String(stats.artemis)} />
          </View>
        </CustomerShellPanel>
      ) : null}

      <CustomerShellPanel title="Search" description="Filter the contract index by text or program scope.">
        <View style={{ gap: 12 }}>
          <View
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: 'rgba(234, 240, 255, 0.1)',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              paddingHorizontal: 14,
              paddingVertical: 12
            }}
          >
            <Text style={{ color: '#9bb0bf', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Search contracts
            </Text>
            <TextInput
              value={queryText}
              onChangeText={setQueryText}
              placeholder="award id, PIID, contract key, mission"
              placeholderTextColor="#8c9cad"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ color: '#eaf0ff', fontSize: 16, marginTop: 8, paddingVertical: 0 }}
            />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CONTRACT_SCOPES.map((option) => (
              <ScopeChip
                key={option}
                label={option}
                active={scope === option}
                onPress={() => {
                  setScope(option);
                }}
              />
            ))}
          </View>
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Index" description="Tap a contract row to open the native detail page.">
        <View style={{ gap: 10 }}>
          {query.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading contracts…</Text>
          ) : query.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {query.error instanceof Error ? query.error.message : 'Unable to load contracts.'}
            </Text>
          ) : items.length ? (
            items.map((contract: CanonicalContractsResponseV1['items'][number]) => (
              <RouteListRow
                key={contract.uid}
                title={contract.title}
                subtitle={buildContractSubtitle(contract)}
                meta={buildContractMeta(contract)}
                badge={contract.storyStatus === 'exact' ? 'exact story' : 'pending'}
                onPress={() => {
                  router.push(contract.canonicalPath as Href);
                }}
              />
            ))
          ) : (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>No contracts matched the current filters.</Text>
          )}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

export function ContractDetailScreen({ contractUid }: { contractUid: string }) {
  const router = useRouter();
  const query = useCanonicalContractDetailQuery(contractUid);
  const payload = query.data as CanonicalContractDetailV1 | null;
  const contract = payload?.contract ?? null;

  return (
    <AppScreen testID="contract-detail-screen">
      <CustomerShellHero
        eyebrow="Contracts"
        title={contract?.title ?? 'Contract detail'}
        description={payload?.description ?? 'Canonical contract detail with story, facts, and related launches.'}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={contract?.scope ?? 'loading'} tone="accent" />
          <CustomerShellBadge label={contract?.storyStatus ?? 'loading'} />
          {contract?.amount != null ? <CustomerShellBadge label={formatAmount(contract.amount)} tone="success" /> : null}
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Status" description={payload?.title ?? 'Canonical contract intelligence'}>
        <View style={{ gap: 10 }}>
          {query.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading contract detail…</Text>
          ) : query.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {query.error instanceof Error ? query.error.message : 'Unable to load contract detail.'}
            </Text>
          ) : contract ? (
            <>
              <RouteKeyValueRow label="Mission" value={contract.missionLabel} />
              <RouteKeyValueRow label="Recipient" value={contract.recipient || '—'} />
              <RouteKeyValueRow label="Customer" value={contract.customer || '—'} />
              <RouteKeyValueRow label="Awarded" value={formatRouteDate(contract.awardedOn)} />
              <RouteKeyValueRow label="Status" value={contract.status || '—'} />
              <RouteKeyValueRow label="Contract key" value={contract.contractKey} />
            </>
          ) : null}
        </View>
      </CustomerShellPanel>

      {payload?.facts?.length ? (
        <CustomerShellPanel title="Facts" description="The contract detail facts rendered natively.">
          <View style={{ gap: 10 }}>
            {payload.facts.map((fact: CanonicalContractDetailV1['facts'][number]) => (
              <RouteKeyValueRow key={`${fact.label}:${fact.value}`} label={fact.label} value={fact.value} />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      {payload?.links?.length ? (
        <CustomerShellPanel title="Links" description="Open the connected contract resources.">
          <View style={{ gap: 10 }}>
            {payload.links.map((link: CanonicalContractDetailV1['links'][number]) => (
              <RouteListRow
                key={`${link.label}:${link.href}`}
                title={link.label}
                subtitle={link.external ? 'External resource' : 'Native contract surface'}
                badge={link.external ? 'external' : 'native'}
                onPress={() => {
                  if (link.external) {
                    void openExternalCustomerUrl(link.href);
                    return;
                  }
                  router.push(link.href as Href);
                }}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      {payload?.familyMembers?.length ? (
        <CustomerShellPanel title="Family members" description="Related exact or pending contract rows.">
          <View style={{ gap: 10 }}>
            {payload.familyMembers.map((member: CanonicalContractDetailV1['familyMembers'][number]) => (
              <RouteListRow
                key={member.uid}
                title={member.title}
                subtitle={buildContractSubtitle(member)}
                meta={member.scope}
                badge={member.storyStatus === 'exact' ? 'exact' : 'pending'}
                onPress={() => {
                  router.push(member.canonicalPath as Href);
                }}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      <CustomerShellPanel title="Browse" description="Return to the contract index or jump to another route.">
        <View style={{ gap: 10 }}>
          <CustomerShellActionButton
            label="Open contract index"
            onPress={() => {
              router.push('/contracts' as Href);
            }}
          />
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

function ScopeChip({
  label,
  active,
  onPress
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? 'rgba(34, 211, 238, 0.22)' : 'rgba(234, 240, 255, 0.08)',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.1)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 8
      })}
    >
      <Text style={{ color: active ? '#6fe8ff' : '#d4e0eb', fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function buildContractSubtitle(contract: CanonicalContractsResponseV1['items'][number]) {
  return [contract.missionLabel, contract.description || contract.status || ''].filter(Boolean).join(' • ');
}

function buildContractMeta(contract: CanonicalContractsResponseV1['items'][number]) {
  return [contract.scope, contract.piid || contract.usaspendingAwardId || 'No award id'].filter(Boolean).join(' • ');
}

function formatAmount(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}
