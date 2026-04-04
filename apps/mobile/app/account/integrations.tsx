import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Share as NativeShare, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { CalendarFeedV1, EmbedWidgetV1, RssFeedV1 } from '@tminuszero/api-client';
import {
  useCalendarFeedsQuery,
  useCreateCalendarFeedMutation,
  useCreateEmbedWidgetMutation,
  useCreateRssFeedMutation,
  useDeleteCalendarFeedMutation,
  useDeleteEmbedWidgetMutation,
  useDeleteRssFeedMutation,
  useEmbedWidgetsQuery,
  useRotateCalendarFeedMutation,
  useRotateEmbedWidgetMutation,
  useRotateRssFeedMutation,
  useRssFeedsQuery,
  useUpdateCalendarFeedMutation,
  useUpdateEmbedWidgetMutation,
  useUpdateRssFeedMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { getPublicSiteUrl } from '@/src/config/api';
import { AccountDetailRow, AccountNotice, AccountTextField } from '@/src/features/account/AccountUi';
import { MOBILE_BRAND_NAME } from '@/src/features/account/constants';

type Notice = { tone: 'success' | 'warning' | 'error'; message: string } | null;
type CalendarDraft = { name: string; reminder: string };
type NameDraft = { name: string };

export default function AccountIntegrationsScreen() {
  const router = useRouter();
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const isAuthed = Boolean(viewerSessionQuery.data?.viewerId);
  const isPaid = entitlementsQuery.data?.isPaid === true;
  const baseUrl = useMemo(() => getPublicSiteUrl(), []);
  const calendarFeedsQuery = useCalendarFeedsQuery({ enabled: isPaid });
  const rssFeedsQuery = useRssFeedsQuery({ enabled: isPaid });
  const embedWidgetsQuery = useEmbedWidgetsQuery({ enabled: isPaid });
  const createCalendarFeedMutation = useCreateCalendarFeedMutation();
  const updateCalendarFeedMutation = useUpdateCalendarFeedMutation();
  const deleteCalendarFeedMutation = useDeleteCalendarFeedMutation();
  const rotateCalendarFeedMutation = useRotateCalendarFeedMutation();
  const createRssFeedMutation = useCreateRssFeedMutation();
  const updateRssFeedMutation = useUpdateRssFeedMutation();
  const deleteRssFeedMutation = useDeleteRssFeedMutation();
  const rotateRssFeedMutation = useRotateRssFeedMutation();
  const createEmbedWidgetMutation = useCreateEmbedWidgetMutation();
  const updateEmbedWidgetMutation = useUpdateEmbedWidgetMutation();
  const deleteEmbedWidgetMutation = useDeleteEmbedWidgetMutation();
  const rotateEmbedWidgetMutation = useRotateEmbedWidgetMutation();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [newCalendarName, setNewCalendarName] = useState('');
  const [newCalendarReminder, setNewCalendarReminder] = useState('');
  const [newRssName, setNewRssName] = useState('');
  const [newWidgetName, setNewWidgetName] = useState('');
  const [calendarDrafts, setCalendarDrafts] = useState<Record<string, CalendarDraft>>({});
  const [rssDrafts, setRssDrafts] = useState<Record<string, NameDraft>>({});
  const [widgetDrafts, setWidgetDrafts] = useState<Record<string, NameDraft>>({});

  const calendarFeeds = useMemo(() => (isPaid ? calendarFeedsQuery.data?.feeds ?? [] : []), [calendarFeedsQuery.data?.feeds, isPaid]);
  const rssFeeds = useMemo(() => (isPaid ? rssFeedsQuery.data?.feeds ?? [] : []), [isPaid, rssFeedsQuery.data?.feeds]);
  const embedWidgets = useMemo(() => (isPaid ? embedWidgetsQuery.data?.widgets ?? [] : []), [embedWidgetsQuery.data?.widgets, isPaid]);
  const loadingIntegrations = isPaid && (calendarFeedsQuery.isPending || rssFeedsQuery.isPending || embedWidgetsQuery.isPending);
  const queryError = (isPaid ? calendarFeedsQuery.error || rssFeedsQuery.error || embedWidgetsQuery.error : null) || entitlementsQuery.error || null;

  useEffect(() => {
    setCalendarDrafts((current) => syncCalendarDrafts(current, calendarFeeds));
  }, [calendarFeeds]);

  useEffect(() => {
    setRssDrafts((current) => syncNameDrafts(current, rssFeeds));
  }, [rssFeeds]);

  useEffect(() => {
    setWidgetDrafts((current) => syncNameDrafts(current, embedWidgets));
  }, [embedWidgets]);

  async function createCalendarFeed() {
    const name = newCalendarName.trim();
    if (!name) {
      setNotice({ tone: 'warning', message: 'Calendar feed name is required.' });
      return;
    }

    const reminder = parseReminderMinutes(newCalendarReminder);
    if (newCalendarReminder.trim() && reminder === 'invalid') {
      setNotice({ tone: 'warning', message: 'Calendar reminder must be an integer between 0 and 10080.' });
      return;
    }

    setNotice(null);
    try {
      await createCalendarFeedMutation.mutateAsync({
        name,
        ...(typeof reminder === 'number' || reminder === null ? { alarmMinutesBefore: reminder } : {})
      });
      setNewCalendarName('');
      setNewCalendarReminder('');
      setNotice({ tone: 'success', message: `Created calendar feed "${name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to create calendar feed.') });
    }
  }

  async function createRssFeed() {
    const name = newRssName.trim();
    if (!name) {
      setNotice({ tone: 'warning', message: 'RSS feed name is required.' });
      return;
    }

    setNotice(null);
    try {
      await createRssFeedMutation.mutateAsync({ name });
      setNewRssName('');
      setNotice({ tone: 'success', message: `Created RSS feed "${name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to create RSS feed.') });
    }
  }

  async function createWidget() {
    const name = newWidgetName.trim();
    if (!name) {
      setNotice({ tone: 'warning', message: 'Widget name is required.' });
      return;
    }

    setNotice(null);
    try {
      await createEmbedWidgetMutation.mutateAsync({ name });
      setNewWidgetName('');
      setNotice({ tone: 'success', message: `Created widget "${name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to create widget.') });
    }
  }

  async function saveCalendarFeed(feed: CalendarFeedV1) {
    const draft = calendarDrafts[feed.id];
    if (!draft) return;
    const payload: { name?: string; alarmMinutesBefore?: number | null } = {};
    const nextName = draft.name.trim();
    if (nextName && nextName !== feed.name) {
      payload.name = nextName;
    }

    const reminder = parseReminderMinutes(draft.reminder);
    if (reminder === 'invalid') {
      setNotice({ tone: 'warning', message: 'Calendar reminder must be an integer between 0 and 10080.' });
      return;
    }
    const currentReminder = normalizeReminder(feed.alarmMinutesBefore ?? null);
    if (reminder !== currentReminder) {
      payload.alarmMinutesBefore = reminder;
    }

    if (!Object.keys(payload).length) {
      setNotice({ tone: 'warning', message: 'No calendar feed changes to save.' });
      return;
    }

    const busyKey = `calendar:save:${feed.id}`;
    if (busy[busyKey]) return;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await updateCalendarFeedMutation.mutateAsync({ feedId: feed.id, payload });
      setNotice({ tone: 'success', message: `Updated calendar feed "${payload.name || feed.name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to update calendar feed.') });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function saveRssFeed(feed: RssFeedV1) {
    const draft = rssDrafts[feed.id];
    const nextName = draft?.name.trim() || '';
    if (!nextName || nextName === feed.name) {
      setNotice({ tone: 'warning', message: 'No RSS feed changes to save.' });
      return;
    }

    const busyKey = `rss:save:${feed.id}`;
    if (busy[busyKey]) return;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await updateRssFeedMutation.mutateAsync({ feedId: feed.id, payload: { name: nextName } });
      setNotice({ tone: 'success', message: `Updated RSS feed "${nextName}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to update RSS feed.') });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function saveWidget(widget: EmbedWidgetV1) {
    const draft = widgetDrafts[widget.id];
    const nextName = draft?.name.trim() || '';
    if (!nextName || nextName === widget.name) {
      setNotice({ tone: 'warning', message: 'No widget changes to save.' });
      return;
    }

    const busyKey = `widget:save:${widget.id}`;
    if (busy[busyKey]) return;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await updateEmbedWidgetMutation.mutateAsync({ widgetId: widget.id, payload: { name: nextName } });
      setNotice({ tone: 'success', message: `Updated widget "${nextName}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to update widget.') });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function rotateCalendar(feed: CalendarFeedV1) {
    const busyKey = `calendar:rotate:${feed.id}`;
    if (busy[busyKey]) return;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await rotateCalendarFeedMutation.mutateAsync(feed.id);
      setNotice({ tone: 'success', message: `Rotated token for "${feed.name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to rotate calendar feed token.') });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function rotateRss(feed: RssFeedV1) {
    const busyKey = `rss:rotate:${feed.id}`;
    if (busy[busyKey]) return;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await rotateRssFeedMutation.mutateAsync(feed.id);
      setNotice({ tone: 'success', message: `Rotated token for "${feed.name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to rotate RSS feed token.') });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function rotateWidget(widget: EmbedWidgetV1) {
    const busyKey = `widget:rotate:${widget.id}`;
    if (busy[busyKey]) return;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await rotateEmbedWidgetMutation.mutateAsync(widget.id);
      setNotice({ tone: 'success', message: `Rotated token for "${widget.name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to rotate widget token.') });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function deleteCalendar(feed: CalendarFeedV1) {
    const busyKey = `calendar:delete:${feed.id}`;
    if (busy[busyKey]) return;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await deleteCalendarFeedMutation.mutateAsync(feed.id);
      setNotice({ tone: 'success', message: `Deleted calendar feed "${feed.name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to delete calendar feed.') });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function deleteRss(feed: RssFeedV1) {
    const busyKey = `rss:delete:${feed.id}`;
    if (busy[busyKey]) return;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await deleteRssFeedMutation.mutateAsync(feed.id);
      setNotice({ tone: 'success', message: `Deleted RSS feed "${feed.name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to delete RSS feed.') });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function deleteWidget(widget: EmbedWidgetV1) {
    const busyKey = `widget:delete:${widget.id}`;
    if (busy[busyKey]) return;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await deleteEmbedWidgetMutation.mutateAsync(widget.id);
      setNotice({ tone: 'success', message: `Revoked widget "${widget.name}".` });
    } catch (error) {
      setNotice({ tone: 'error', message: toIntegrationMessage(error, 'Unable to revoke widget.') });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function shareCalendar(feed: CalendarFeedV1) {
    const urls = buildCalendarUrls(baseUrl, feed.token);
    await NativeShare.share({
      message: [urls.httpsUrl, urls.webcalUrl].filter(Boolean).join('\n')
    });
  }

  async function shareRss(feed: RssFeedV1) {
    const urls = buildRssUrls(baseUrl, feed.token);
    await NativeShare.share({
      message: [urls.rssUrl, urls.atomUrl].filter(Boolean).join('\n')
    });
  }

  async function shareWidget(widget: EmbedWidgetV1) {
    const urls = buildEmbedUrls(baseUrl, widget.token);
    await NativeShare.share({
      message: [urls.srcUrl, urls.iframeCode].filter(Boolean).join('\n\n')
    });
  }

  return (
    <AppScreen testID="account-integrations-screen">
      <CustomerShellHero
        eyebrow="Account"
        title="Integrations"
        description="Manage recurring calendar feeds, RSS feeds, and embeddable next-launch widgets natively on mobile."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={isAuthed ? 'Account' : 'Guest'} tone={isAuthed ? 'success' : 'warning'} />
          <CustomerShellBadge label={isPaid ? 'Full access' : 'Public'} tone={isPaid ? 'accent' : 'default'} />
        </View>
      </CustomerShellHero>

      {notice ? <AccountNotice message={notice.message} tone={notice.tone === 'warning' ? 'warning' : notice.tone === 'error' ? 'error' : 'success'} /> : null}
      {queryError ? <AccountNotice message={toIntegrationMessage(queryError, 'Unable to load integrations.')} tone="error" /> : null}

      {!isAuthed ? (
        <CustomerShellPanel title="Sign in required" description="Sign in to manage integrations once Premium is active on your account.">
          <CustomerShellActionButton
            label="Sign in"
            onPress={() => {
              router.push('/sign-in');
            }}
          />
        </CustomerShellPanel>
      ) : !isPaid ? (
        <CustomerShellPanel
          title="Upgrade to Premium"
          description="Public access does not include calendar feeds, RSS feeds, or embeddable widgets. Upgrade to Premium to create and manage them."
        >
          <CustomerShellActionButton
            label="Open account"
            onPress={() => {
              router.push('/profile');
            }}
          />
        </CustomerShellPanel>
      ) : (
        <>
          <CustomerShellPanel
            title="Create calendar feed"
            description="Create a tokenized `.ics` feed. Leave reminder blank for no alarm, or set minutes before launch."
          >
            <View style={{ gap: 12 }}>
              <AccountTextField label="Feed name" value={newCalendarName} onChangeText={setNewCalendarName} placeholder="My calendar feed" />
              <AccountTextField
                label="Reminder minutes"
                value={newCalendarReminder}
                onChangeText={setNewCalendarReminder}
                placeholder="60"
                keyboardType="number-pad"
                autoCapitalize="none"
              />
              <CustomerShellActionButton
                label={createCalendarFeedMutation.isPending ? 'Creating…' : 'Create calendar feed'}
                onPress={() => {
                  void createCalendarFeed();
                }}
                disabled={createCalendarFeedMutation.isPending}
              />
            </View>
          </CustomerShellPanel>

          <FeedSection<CalendarFeedV1>
            title="Calendar feeds"
            description="Private, tokenized `.ics` subscriptions for your live schedule."
            emptyLabel={loadingIntegrations ? 'Loading calendar feeds…' : 'No calendar feeds yet.'}
            items={calendarFeeds}
            renderItem={(feed) => {
              const draft = calendarDrafts[feed.id] ?? {
                name: feed.name,
                reminder: formatReminderDraft(feed.alarmMinutesBefore ?? null)
              };
              const urls = buildCalendarUrls(baseUrl, feed.token);
              return (
                <IntegrationCard key={feed.id}>
                  <AccountTextField
                    label="Feed name"
                    value={draft.name}
                    onChangeText={(value) => {
                      setCalendarDrafts((current) => ({
                        ...current,
                        [feed.id]: {
                          ...draft,
                          name: value
                        }
                      }));
                    }}
                  />
                  <AccountTextField
                    label="Reminder minutes"
                    value={draft.reminder}
                    onChangeText={(value) => {
                      setCalendarDrafts((current) => ({
                        ...current,
                        [feed.id]: {
                          ...draft,
                          reminder: value
                        }
                      }));
                    }}
                    placeholder="Blank for none"
                    keyboardType="number-pad"
                    autoCapitalize="none"
                  />
                  <AccountDetailRow label="HTTPS URL" value={urls.httpsUrl || 'Unavailable'} />
                  <AccountDetailRow label="Webcal URL" value={urls.webcalUrl || 'Unavailable'} />
                  <AccountDetailRow label="Updated" value={formatUpdated(feed.updatedAt || feed.createdAt)} />
                  <IntegrationActions
                    actions={[
                      { label: busy[`calendar:save:${feed.id}`] ? 'Saving…' : 'Save', onPress: () => void saveCalendarFeed(feed), disabled: Boolean(busy[`calendar:save:${feed.id}`]) },
                      { label: 'Share URLs', onPress: () => void shareCalendar(feed), variant: 'secondary' },
                      { label: busy[`calendar:rotate:${feed.id}`] ? 'Rotating…' : 'Rotate token', onPress: () => void rotateCalendar(feed), variant: 'secondary', disabled: Boolean(busy[`calendar:rotate:${feed.id}`]) },
                      { label: busy[`calendar:delete:${feed.id}`] ? 'Deleting…' : 'Delete', onPress: () => void deleteCalendar(feed), variant: 'secondary', disabled: Boolean(busy[`calendar:delete:${feed.id}`]) }
                    ]}
                  />
                </IntegrationCard>
              );
            }}
          />

          <CustomerShellPanel title="Create RSS feed" description="Create an XML/Atom feed for your launch stream.">
            <View style={{ gap: 12 }}>
              <AccountTextField label="Feed name" value={newRssName} onChangeText={setNewRssName} placeholder="My launch RSS" />
              <CustomerShellActionButton
                label={createRssFeedMutation.isPending ? 'Creating…' : 'Create RSS feed'}
                onPress={() => {
                  void createRssFeed();
                }}
                disabled={createRssFeedMutation.isPending}
              />
            </View>
          </CustomerShellPanel>

          <FeedSection<RssFeedV1>
            title="RSS feeds"
            description="Tokenized XML and Atom endpoints for recurring launch updates."
            emptyLabel={loadingIntegrations ? 'Loading RSS feeds…' : 'No RSS feeds yet.'}
            items={rssFeeds}
            renderItem={(feed) => {
              const draft = rssDrafts[feed.id] ?? { name: feed.name };
              const urls = buildRssUrls(baseUrl, feed.token);
              return (
                <IntegrationCard key={feed.id}>
                  <AccountTextField
                    label="Feed name"
                    value={draft.name}
                    onChangeText={(value) => {
                      setRssDrafts((current) => ({
                        ...current,
                        [feed.id]: { name: value }
                      }));
                    }}
                  />
                  <AccountDetailRow label="RSS URL" value={urls.rssUrl || 'Unavailable'} />
                  <AccountDetailRow label="Atom URL" value={urls.atomUrl || 'Unavailable'} />
                  <AccountDetailRow label="Updated" value={formatUpdated(feed.updatedAt || feed.createdAt)} />
                  <IntegrationActions
                    actions={[
                      { label: busy[`rss:save:${feed.id}`] ? 'Saving…' : 'Save', onPress: () => void saveRssFeed(feed), disabled: Boolean(busy[`rss:save:${feed.id}`]) },
                      { label: 'Share URLs', onPress: () => void shareRss(feed), variant: 'secondary' },
                      { label: busy[`rss:rotate:${feed.id}`] ? 'Rotating…' : 'Rotate token', onPress: () => void rotateRss(feed), variant: 'secondary', disabled: Boolean(busy[`rss:rotate:${feed.id}`]) },
                      { label: busy[`rss:delete:${feed.id}`] ? 'Deleting…' : 'Delete', onPress: () => void deleteRss(feed), variant: 'secondary', disabled: Boolean(busy[`rss:delete:${feed.id}`]) }
                    ]}
                  />
                </IntegrationCard>
              );
            }}
          />

          <CustomerShellPanel
            title="Create embed widget"
            description="Create a tokenized next-launch widget. The shared web runtime will render the widget using the mobile-managed token."
          >
            <View style={{ gap: 12 }}>
              <AccountTextField label="Widget name" value={newWidgetName} onChangeText={setNewWidgetName} placeholder="Homepage card" />
              <CustomerShellActionButton
                label={createEmbedWidgetMutation.isPending ? 'Creating…' : 'Create widget'}
                onPress={() => {
                  void createWidget();
                }}
                disabled={createEmbedWidgetMutation.isPending}
              />
            </View>
          </CustomerShellPanel>

          <FeedSection<EmbedWidgetV1>
            title="Embed widgets"
            description="Per-widget tokens and shareable iframe code."
            emptyLabel={loadingIntegrations ? 'Loading widgets…' : 'No widgets yet.'}
            items={embedWidgets}
            renderItem={(widget) => {
              const draft = widgetDrafts[widget.id] ?? { name: widget.name };
              const urls = buildEmbedUrls(baseUrl, widget.token);
              return (
                <IntegrationCard key={widget.id}>
                  <AccountTextField
                    label="Widget name"
                    value={draft.name}
                    onChangeText={(value) => {
                      setWidgetDrafts((current) => ({
                        ...current,
                        [widget.id]: { name: value }
                      }));
                    }}
                  />
                  <AccountDetailRow label="Widget URL" value={urls.srcUrl || 'Unavailable'} />
                  <AccountDetailRow label="Widget type" value={widget.widgetType || 'next_launch_card'} />
                  <AccountDetailRow label="Updated" value={formatUpdated(widget.updatedAt || widget.createdAt)} />
                  <Text style={{ color: '#d4e0eb', fontSize: 13, lineHeight: 19 }}>{urls.iframeCode || 'Embed code unavailable.'}</Text>
                  <IntegrationActions
                    actions={[
                      { label: busy[`widget:save:${widget.id}`] ? 'Saving…' : 'Save', onPress: () => void saveWidget(widget), disabled: Boolean(busy[`widget:save:${widget.id}`]) },
                      { label: 'Share code', onPress: () => void shareWidget(widget), variant: 'secondary' },
                      { label: busy[`widget:rotate:${widget.id}`] ? 'Rotating…' : 'Rotate token', onPress: () => void rotateWidget(widget), variant: 'secondary', disabled: Boolean(busy[`widget:rotate:${widget.id}`]) },
                      { label: busy[`widget:delete:${widget.id}`] ? 'Revoking…' : 'Revoke', onPress: () => void deleteWidget(widget), variant: 'secondary', disabled: Boolean(busy[`widget:delete:${widget.id}`]) }
                    ]}
                  />
                </IntegrationCard>
              );
            }}
          />
        </>
      )}
    </AppScreen>
  );
}

function FeedSection<T>({
  title,
  description,
  emptyLabel,
  items,
  renderItem
}: {
  title: string;
  description: string;
  emptyLabel: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <CustomerShellPanel title={title} description={description}>
      {items.length === 0 ? <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>{emptyLabel}</Text> : <View style={{ gap: 12 }}>{items.map(renderItem)}</View>}
    </CustomerShellPanel>
  );
}

function IntegrationCard({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        gap: 10,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.08)',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        paddingHorizontal: 14,
        paddingVertical: 14
      }}
    >
      {children}
    </View>
  );
}

function IntegrationActions({
  actions
}: {
  actions: Array<{ label: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' }>;
}) {
  return (
    <View style={{ gap: 8 }}>
      {actions.map((action) => (
        <CustomerShellActionButton
          key={action.label}
          label={action.label}
          onPress={action.onPress}
          disabled={action.disabled}
          variant={action.variant}
        />
      ))}
    </View>
  );
}

function syncCalendarDrafts(current: Record<string, CalendarDraft>, feeds: CalendarFeedV1[]) {
  const next: Record<string, CalendarDraft> = {};
  for (const feed of feeds) {
    next[feed.id] = current[feed.id] ?? {
      name: feed.name,
      reminder: formatReminderDraft(feed.alarmMinutesBefore ?? null)
    };
  }
  return next;
}

function syncNameDrafts<T extends { id: string; name: string }>(current: Record<string, NameDraft>, items: T[]) {
  const next: Record<string, NameDraft> = {};
  for (const item of items) {
    next[item.id] = current[item.id] ?? { name: item.name };
  }
  return next;
}

function parseReminderMinutes(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0 || parsed > 10080) {
    return 'invalid';
  }
  return parsed;
}

function normalizeReminder(value: number | null) {
  return value == null ? null : Math.trunc(value);
}

function formatReminderDraft(value: number | null) {
  return value == null ? '' : String(Math.trunc(value));
}

function buildCalendarUrls(baseUrl: string, token: string) {
  const httpsUrl = baseUrl ? `${baseUrl}/api/calendar/${encodeURIComponent(token)}.ics` : null;
  const webcalUrl = httpsUrl ? httpsUrl.replace(/^https?:\/\//, 'webcal://') : null;
  return { httpsUrl, webcalUrl };
}

function buildRssUrls(baseUrl: string, token: string) {
  const rssUrl = baseUrl ? `${baseUrl}/rss/${encodeURIComponent(token)}.xml` : null;
  const atomUrl = baseUrl ? `${baseUrl}/rss/${encodeURIComponent(token)}.atom` : null;
  return { rssUrl, atomUrl };
}

function buildEmbedUrls(baseUrl: string, token: string) {
  const srcUrl = baseUrl ? `${baseUrl}/embed/next-launch?token=${encodeURIComponent(token)}` : null;
  const iframeCode = srcUrl
    ? `<iframe
  src="${srcUrl}"
  title="${MOBILE_BRAND_NAME} Next Launch"
  loading="lazy"
  style="width: 100%; max-width: 520px; height: 720px; border: 0; border-radius: 16px; overflow: hidden;"
  allow="clipboard-write; web-share"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>`
    : null;
  return { srcUrl, iframeCode };
}

function formatUpdated(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function toIntegrationMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
