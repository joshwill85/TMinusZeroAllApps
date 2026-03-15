import { useMemo, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_LAUNCH_FILTERS,
  LAUNCH_FILTER_RANGE_OPTIONS,
  LAUNCH_FILTER_REGION_OPTIONS,
  LAUNCH_FILTER_SORT_OPTIONS,
  formatLaunchFilterLocationOptionLabel,
  formatLaunchFilterStatusLabel,
  type LaunchFilterOptions,
  type LaunchFilterValue
} from '@tminuszero/domain';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { ViewerTierCard } from '@/src/components/ViewerTierCard';

type SavedFilterPreset = {
  id: string;
  name: string;
  filters: LaunchFilterValue;
  isDefault: boolean;
};

type DynamicFilterField = 'location' | 'state' | 'provider' | 'pad';

type LaunchFilterSheetProps = {
  visible: boolean;
  isAuthed: boolean;
  canUseLaunchFilters: boolean;
  canManageFilterPresets: boolean;
  filters: LaunchFilterValue;
  filterOptions: LaunchFilterOptions;
  filterOptionsLoading: boolean;
  filterOptionsError: string | null;
  presets: SavedFilterPreset[];
  activePresetId: string;
  presetSaving: boolean;
  presetDefaulting: boolean;
  onClose: () => void;
  onChange: (next: LaunchFilterValue) => void;
  onReset: () => void;
  onApplyPreset: (presetId: string) => void;
  onSavePreset: (name: string) => Promise<void>;
  onSetDefaultPreset: () => Promise<void>;
  onOpenUpgrade: () => void;
  onOpenSignIn: () => void;
};

const RANGE_LABELS: Record<NonNullable<LaunchFilterValue['range']>, string> = {
  today: 'Today',
  '7d': 'Next 7 days',
  month: 'Next 30 days',
  year: 'Next 12 months',
  past: 'Past launches',
  all: 'All time'
};

const SORT_LABELS: Record<NonNullable<LaunchFilterValue['sort']>, string> = {
  soonest: 'Soonest',
  latest: 'Newest first',
  changed: 'Recently updated'
};

const REGION_LABELS: Record<NonNullable<LaunchFilterValue['region']>, string> = {
  us: 'US only',
  'non-us': 'Non-US',
  all: 'All locations'
};

export function LaunchFilterSheet({
  visible,
  isAuthed,
  canUseLaunchFilters,
  canManageFilterPresets,
  filters,
  filterOptions,
  filterOptionsLoading,
  filterOptionsError,
  presets,
  activePresetId,
  presetSaving,
  presetDefaulting,
  onClose,
  onChange,
  onReset,
  onApplyPreset,
  onSavePreset,
  onSetDefaultPreset,
  onOpenUpgrade,
  onOpenSignIn
}: LaunchFilterSheetProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useMobileBootstrap();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [selectingField, setSelectingField] = useState<DynamicFilterField | null>(null);
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? null;

  const dynamicFieldOptions = useMemo<Record<DynamicFilterField, string[]>>(
    () => ({
      location: filterOptions.locations,
      state: filterOptions.states,
      provider: filterOptions.providers,
      pad: filterOptions.pads
    }),
    [filterOptions]
  );

  const selectedFieldLabel =
    selectingField === 'location'
      ? 'Launch site'
      : selectingField === 'state'
        ? 'State'
        : selectingField === 'provider'
          ? 'Provider'
          : selectingField === 'pad'
            ? 'Pad'
            : '';

  const selectedFieldValue =
    selectingField === 'location'
      ? filters.location ?? ''
      : selectingField === 'state'
        ? filters.state ?? ''
        : selectingField === 'provider'
          ? filters.provider ?? ''
          : selectingField === 'pad'
            ? filters.pad ?? ''
            : '';

  async function submitSavePreset() {
    const name = saveName.trim();
    if (!name) return;
    await onSavePreset(name);
    setSaveName('');
    setSaveOpen(false);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={() => {
        setSelectingField(null);
        setSaveOpen(false);
        onClose();
      }}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.4)' }}>
        <Pressable
          testID="feed-filters-backdrop"
          onPress={() => {
            setSelectingField(null);
            setSaveOpen(false);
            onClose();
          }}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
        <View
          testID="feed-filters-sheet"
          style={{
            maxHeight: '84%',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderTopWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: theme.background,
            paddingTop: 12
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 44,
                height: 4,
                borderRadius: 999,
                backgroundColor: 'rgba(255, 255, 255, 0.18)'
              }}
            />
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingTop: 14,
              paddingBottom: 8
            }}
          >
            <View>
              <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Feed
              </Text>
              <Text style={{ color: theme.foreground, fontSize: 22, fontWeight: '800', marginTop: 4 }}>
                {selectingField ? selectedFieldLabel : 'Launch filters'}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                if (selectingField) {
                  setSelectingField(null);
                  return;
                }
                setSaveOpen(false);
                onClose();
              }}
              hitSlop={8}
            >
              <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>
                {selectingField ? 'Back' : 'Close'}
              </Text>
            </Pressable>
          </View>

          {selectingField ? (
            <ScrollView
              contentContainerStyle={{
                gap: 10,
                paddingHorizontal: 20,
                paddingTop: 8,
                paddingBottom: insets.bottom + 24
              }}
            >
              <PickerOptionRow
                label={`All ${selectedFieldLabel}`}
                active={!selectedFieldValue}
                onPress={() => {
                  onChange({
                    ...filters,
                    [selectingField]: undefined
                  });
                  setSelectingField(null);
                }}
              />
              {dynamicFieldOptions[selectingField].map((option) => (
                <PickerOptionRow
                  key={option}
                  label={selectingField === 'location' ? formatLaunchFilterLocationOptionLabel(option) : option}
                  active={selectedFieldValue === option}
                  onPress={() => {
                    onChange({
                      ...filters,
                      [selectingField]: option
                    });
                    setSelectingField(null);
                  }}
                />
              ))}
            </ScrollView>
          ) : !canUseLaunchFilters ? (
            <View style={{ gap: 16, paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 24 }}>
              <ViewerTierCard
                tier={isAuthed ? 'free' : 'anon'}
                featureKey="launch_filters"
                onPress={() => {
                  onClose();
                  if (isAuthed) onOpenUpgrade();
                  else onOpenSignIn();
                }}
                testID="launch-filters-tier-card"
              />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{
                gap: 18,
                paddingHorizontal: 20,
                paddingTop: 8,
                paddingBottom: insets.bottom + 24
              }}
            >
              <View style={{ gap: 10 }}>
                <SectionEyebrow label="Saved views" />
                {canManageFilterPresets ? (
                  <>
                    {presets.length > 0 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {presets.map((preset) => (
                          <OptionChip
                            key={preset.id}
                            label={`${preset.name}${preset.isDefault ? ' · default' : ''}`}
                            active={preset.id === activePresetId}
                            onPress={() => onApplyPreset(preset.id)}
                          />
                        ))}
                      </View>
                    ) : (
                      <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                        Save filter combinations here for quick reuse.
                      </Text>
                    )}

                    {saveOpen ? (
                      <View
                        style={{
                          gap: 10,
                          borderRadius: 16,
                          borderWidth: 1,
                          borderColor: theme.stroke,
                          backgroundColor: theme.surface,
                          padding: 14
                        }}
                      >
                        <TextInput
                          testID="feed-filter-preset-name"
                          value={saveName}
                          onChangeText={setSaveName}
                          placeholder="Preset name"
                          placeholderTextColor={theme.muted}
                          style={{
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: theme.stroke,
                            backgroundColor: theme.background,
                            color: theme.foreground,
                            paddingHorizontal: 14,
                            paddingVertical: 12,
                            fontSize: 15
                          }}
                          autoCapitalize="words"
                          autoCorrect={false}
                          returnKeyType="done"
                          onSubmitEditing={() => {
                            void submitSavePreset();
                          }}
                        />
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          <SecondaryActionButton
                            label="Cancel"
                            onPress={() => {
                              setSaveOpen(false);
                              setSaveName('');
                            }}
                          />
                          <PrimaryActionButton
                            label={presetSaving ? 'Saving…' : 'Save view'}
                            onPress={() => {
                              void submitSavePreset();
                            }}
                            disabled={presetSaving || saveName.trim().length === 0}
                          />
                        </View>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        <SecondaryActionButton
                          label="Save current view"
                          onPress={() => {
                            setSaveName(activePreset?.name ?? '');
                            setSaveOpen(true);
                          }}
                          disabled={presetSaving}
                        />
                        <SecondaryActionButton
                          label={activePreset?.isDefault ? 'Default view' : presetDefaulting ? 'Setting…' : 'Set default'}
                          onPress={() => {
                            void onSetDefaultPreset();
                          }}
                          disabled={presetDefaulting || !activePresetId || activePreset?.isDefault === true}
                        />
                      </View>
                    )}
                  </>
                ) : (
                  <ViewerTierCard
                    tier={isAuthed ? 'free' : 'anon'}
                    featureKey="saved_items"
                    onPress={() => {
                      onClose();
                      if (isAuthed) onOpenUpgrade();
                      else onOpenSignIn();
                    }}
                  />
                )}
              </View>

              <View style={{ gap: 10 }}>
                <SectionEyebrow label="Time" />
                <ChipRow>
                  {LAUNCH_FILTER_RANGE_OPTIONS.map((option) => (
                    <OptionChip
                      key={option}
                      label={RANGE_LABELS[option]}
                      active={(filters.range ?? DEFAULT_LAUNCH_FILTERS.range) === option}
                      onPress={() => onChange({ ...filters, range: option })}
                    />
                  ))}
                </ChipRow>
                <ChipRow>
                  <OptionChip
                    label="All status"
                    active={(filters.status ?? 'all') === 'all'}
                    onPress={() => onChange({ ...filters, status: 'all' })}
                  />
                  {filterOptions.statuses.map((status) => (
                    <OptionChip
                      key={status}
                      label={formatLaunchFilterStatusLabel(status)}
                      active={(filters.status ?? 'all') === status}
                      onPress={() => onChange({ ...filters, status: status as LaunchFilterValue['status'] })}
                    />
                  ))}
                </ChipRow>
                <ChipRow>
                  {LAUNCH_FILTER_SORT_OPTIONS.map((option) => (
                    <OptionChip
                      key={option}
                      label={SORT_LABELS[option]}
                      active={(filters.sort ?? DEFAULT_LAUNCH_FILTERS.sort) === option}
                      onPress={() => onChange({ ...filters, sort: option })}
                    />
                  ))}
                </ChipRow>
              </View>

              <View style={{ gap: 10 }}>
                <SectionEyebrow label="Location" />
                <ChipRow>
                  {LAUNCH_FILTER_REGION_OPTIONS.map((option) => (
                    <OptionChip
                      key={option}
                      label={REGION_LABELS[option]}
                      active={(filters.region ?? DEFAULT_LAUNCH_FILTERS.region) === option}
                      onPress={() => onChange({ ...filters, region: option })}
                    />
                  ))}
                </ChipRow>
                <SelectorRow
                  label="Launch site"
                  value={filters.location ? formatLaunchFilterLocationOptionLabel(filters.location) : 'All launch sites'}
                  onPress={() => setSelectingField('location')}
                  disabled={filterOptionsLoading || Boolean(filterOptionsError)}
                />
                <SelectorRow
                  label="State"
                  value={filters.state ?? 'All states'}
                  onPress={() => setSelectingField('state')}
                  disabled={filterOptionsLoading || Boolean(filterOptionsError)}
                />
              </View>

              <View style={{ gap: 10 }}>
                <SectionEyebrow label="Mission" />
                <SelectorRow
                  label="Provider"
                  value={filters.provider ?? 'All providers'}
                  onPress={() => setSelectingField('provider')}
                  disabled={filterOptionsLoading || Boolean(filterOptionsError)}
                />
                <SelectorRow
                  label="Pad"
                  value={filters.pad ?? 'All pads'}
                  onPress={() => setSelectingField('pad')}
                  disabled={filterOptionsLoading || Boolean(filterOptionsError)}
                />
              </View>

              {filterOptionsLoading ? (
                <Text style={{ color: theme.muted, fontSize: 13 }}>Loading filter options…</Text>
              ) : filterOptionsError ? (
                <Text style={{ color: theme.muted, fontSize: 13 }}>Filter options unavailable: {filterOptionsError}</Text>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <SecondaryActionButton label="Reset" onPress={onReset} />
                <PrimaryActionButton label="Done" onPress={onClose} />
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SectionEyebrow({ label }: { label: string }) {
  const { theme } = useMobileBootstrap();
  return (
    <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
      {label}
    </Text>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

function OptionChip({
  label,
  active,
  onPress
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.stroke,
        backgroundColor: active ? theme.accent : theme.surface,
        paddingHorizontal: 12,
        paddingVertical: 9,
        opacity: pressed ? 0.85 : 1
      })}
    >
      <Text style={{ color: active ? theme.background : theme.foreground, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function SelectorRow({
  label,
  value,
  onPress,
  disabled
}: {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        gap: 4,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: theme.surface,
        paddingHorizontal: 14,
        paddingVertical: 12,
        opacity: disabled ? 0.55 : pressed ? 0.88 : 1
      })}
    >
      <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '600' }}>{value}</Text>
    </Pressable>
  );
}

function PickerOptionRow({
  label,
  active,
  onPress
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 16,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.stroke,
        backgroundColor: active ? theme.surface : theme.background,
        paddingHorizontal: 14,
        paddingVertical: 14,
        opacity: pressed ? 0.88 : 1
      })}
    >
      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: active ? '700' : '600' }}>{label}</Text>
    </Pressable>
  );
}

function PrimaryActionButton({
  label,
  onPress,
  disabled
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.accent,
        backgroundColor: theme.accent,
        paddingHorizontal: 14,
        paddingVertical: 12,
        opacity: disabled ? 0.55 : 1
      }}
    >
      <Text style={{ color: theme.background, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

function SecondaryActionButton({
  label,
  onPress,
  disabled
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: theme.surface,
        paddingHorizontal: 14,
        paddingVertical: 12,
        opacity: disabled ? 0.55 : 1
      }}
    >
      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}
