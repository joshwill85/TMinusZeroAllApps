'use client';

import { useId, useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import clsx from 'clsx';

export type ArtemisWorkbenchMode = 'quick' | 'explorer' | 'technical';

export type ArtemisModeSwitchOption<TMode extends string = ArtemisWorkbenchMode> = {
  id: TMode;
  label: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
  panelId?: string;
};

export type ArtemisModeSwitchProps<TMode extends string = ArtemisWorkbenchMode> = {
  options: readonly ArtemisModeSwitchOption<TMode>[];
  value: TMode;
  onChange?: (next: TMode) => void;
  ariaLabel?: string;
  className?: string;
};

export function ArtemisModeSwitch<TMode extends string = ArtemisWorkbenchMode>({
  options,
  value,
  onChange,
  ariaLabel = 'Workbench mode',
  className
}: ArtemisModeSwitchProps<TMode>) {
  const tablistId = useId();
  const normalizedOptions = useMemo(() => options.filter(Boolean), [options]);

  const activeIndex = normalizedOptions.findIndex((option) => option.id === value);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!normalizedOptions.length) return;
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
    let nextIndex = -1;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      nextIndex = findNextEnabledIndex(normalizedOptions, currentIndex, 1);
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      nextIndex = findNextEnabledIndex(normalizedOptions, currentIndex, -1);
    }
    if (event.key === 'Home') {
      event.preventDefault();
      nextIndex = findNextEnabledIndex(normalizedOptions, -1, 1);
    }
    if (event.key === 'End') {
      event.preventDefault();
      nextIndex = findNextEnabledIndex(normalizedOptions, 0, -1);
    }

    if (nextIndex < 0) return;
    const nextOption = normalizedOptions[nextIndex];
    if (!nextOption || nextOption.disabled) return;
    onChange?.(nextOption.id);
    const element = document.getElementById(getTabId(tablistId, nextOption.id));
    element?.focus();
  };

  return (
    <div
      className={clsx('rounded-2xl border border-stroke bg-surface-1 p-2', className)}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {normalizedOptions.map((option) => {
          const isSelected = option.id === value;
          return (
            <button
              key={option.id}
              id={getTabId(tablistId, option.id)}
              role="tab"
              type="button"
              aria-selected={isSelected}
              aria-controls={option.panelId}
              disabled={option.disabled}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                if (option.disabled) return;
                onChange?.(option.id);
              }}
              className={clsx(
                'rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
                option.disabled && 'cursor-not-allowed opacity-60',
                isSelected
                  ? 'border-primary bg-[rgba(34,211,238,0.12)] text-text1 shadow-glow'
                  : 'border-stroke bg-surface-0 text-text2 hover:border-primary/60 hover:text-text1'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{option.label}</span>
                {option.badge ? (
                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                    {option.badge}
                  </span>
                ) : null}
              </div>
              {option.description ? <p className="mt-1 text-xs text-text3">{option.description}</p> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function findNextEnabledIndex<TMode extends string>(
  options: readonly ArtemisModeSwitchOption<TMode>[],
  start: number,
  direction: 1 | -1
) {
  if (!options.length) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (start + direction * step + options.length) % options.length;
    const option = options[index];
    if (option && !option.disabled) return index;
  }
  return -1;
}

function getTabId(tablistId: string, optionId: string) {
  return `${tablistId}-${optionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
