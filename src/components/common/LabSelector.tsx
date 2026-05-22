'use client';

import * as React from 'react';
import { Building2, Check, ChevronsUpDown, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export type LabSelectorOption = {
  id: string;
  name?: string | null;
  kod?: string | null;
  /** Optional small text shown under the name (e.g. "12 cihaz"). */
  meta?: string | null;
  disabled?: boolean;
};

type CommonProps = {
  labs: LabSelectorOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  size?: 'sm' | 'md' | 'lg';
  showCode?: boolean;
  icon?: React.ReactNode | false;
  label?: string;
  helperText?: string;
  align?: 'start' | 'center' | 'end';
  ariaLabel?: string;
  id?: string;
};

type SingleProps = CommonProps & {
  mode?: 'single';
  value: string | null | undefined;
  onChange: (id: string) => void;
  /** Optional sentinel for an "all labs" entry — e.g. { value: 'all', label: 'Tüm Laboratuvarlar' }. */
  allOption?: { value: string; label: string };
  /** Optional sort. Defaults to alphabetical by name. */
  sortFn?: (a: LabSelectorOption, b: LabSelectorOption) => number;
  values?: never;
  onValuesChange?: never;
  showSelectAll?: never;
  showChips?: never;
  maxChipsInTrigger?: never;
};

type MultiProps = CommonProps & {
  mode: 'multi';
  values: string[];
  onValuesChange: (ids: string[]) => void;
  /** Show "Tümünü Seç / Temizle" controls inside the popover. Defaults to true. */
  showSelectAll?: boolean;
  /** Render the chosen labs as removable chips below the trigger. Defaults to false. */
  showChips?: boolean;
  /** How many chips to render inside the trigger before collapsing to "+N". Defaults to 2. */
  maxChipsInTrigger?: number;
  /** Optional sort. Defaults to alphabetical by name. */
  sortFn?: (a: LabSelectorOption, b: LabSelectorOption) => number;
  value?: never;
  onChange?: never;
  allOption?: never;
};

export type LabSelectorProps = SingleProps | MultiProps;

const sizeStyles = {
  sm: {
    trigger: 'h-8 px-2.5 text-xs',
    icon: 'h-3.5 w-3.5',
    chevron: 'h-3 w-3',
  },
  md: {
    trigger: 'h-10 px-3 text-sm',
    icon: 'h-4 w-4',
    chevron: 'h-4 w-4',
  },
  lg: {
    trigger: 'h-11 px-3.5 text-sm',
    icon: 'h-4 w-4',
    chevron: 'h-4 w-4',
  },
} as const;

function defaultSort(a: LabSelectorOption, b: LabSelectorOption) {
  return (a.name ?? '').localeCompare(b.name ?? '', 'tr');
}

export function LabSelector(props: LabSelectorProps) {
  const {
    labs,
    placeholder = 'Laboratuvar seçin',
    searchPlaceholder = 'Laboratuvar ara...',
    emptyMessage = 'Laboratuvar bulunamadı.',
    disabled,
    loading,
    className,
    triggerClassName,
    contentClassName,
    size = 'md',
    showCode = true,
    icon,
    label,
    helperText,
    align = 'start',
    ariaLabel,
    id,
  } = props;

  const [open, setOpen] = React.useState(false);
  const sizes = sizeStyles[size];

  const sortedLabs = React.useMemo(() => {
    const arr = [...labs];
    const cmp = props.sortFn ?? defaultSort;
    arr.sort(cmp);
    return arr;
  }, [labs, props.sortFn]);

  const labMap = React.useMemo(() => {
    const m = new Map<string, LabSelectorOption>();
    for (const lab of labs) m.set(lab.id, lab);
    return m;
  }, [labs]);

  const isMulti = props.mode === 'multi';
  const allOption = !isMulti ? (props as SingleProps).allOption : undefined;

  const selectedSingle = !isMulti
    ? (props as SingleProps).value ?? ''
    : '';
  const selectedMulti = isMulti ? (props as MultiProps).values ?? [] : [];

  const isAllOptionSelected =
    !isMulti && allOption && selectedSingle === allOption.value;

  const triggerLabel = (() => {
    if (isMulti) {
      const count = selectedMulti.length;
      if (count === 0) return placeholder;
      const maxChips = (props as MultiProps).maxChipsInTrigger ?? 2;
      const names = selectedMulti
        .map((id) => labMap.get(id)?.name ?? '')
        .filter(Boolean);
      if (count <= maxChips) {
        return names.join(', ');
      }
      const first = names.slice(0, maxChips).join(', ');
      return `${first} +${count - maxChips}`;
    }
    if (isAllOptionSelected) return allOption!.label;
    if (selectedSingle) {
      const lab = labMap.get(selectedSingle);
      return lab?.name ?? placeholder;
    }
    return placeholder;
  })();

  const showPlaceholder =
    (isMulti && selectedMulti.length === 0) ||
    (!isMulti && !selectedSingle);

  const handleSelectSingle = (id: string) => {
    (props as SingleProps).onChange(id);
    setOpen(false);
  };

  const handleToggleMulti = (id: string) => {
    const current = (props as MultiProps).values ?? [];
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    (props as MultiProps).onValuesChange(next);
  };

  const handleSelectAll = () => {
    (props as MultiProps).onValuesChange(sortedLabs.map((l) => l.id));
  };

  const handleClearAll = () => {
    (props as MultiProps).onValuesChange([]);
  };

  const leadingIcon =
    icon === false ? null : (
      <span className="text-[var(--dashboard-muted)] shrink-0">
        {icon ?? <Building2 className={sizes.icon} aria-hidden="true" />}
      </span>
    );

  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <label
          htmlFor={id}
          className="block text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] mb-1.5"
        >
          {label}
        </label>
      ) : null}

      <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel ?? label ?? placeholder}
            disabled={disabled || loading}
            className={cn(
              'w-full inline-flex items-center justify-between gap-2 rounded-xl transition-all outline-none',
              'bg-[var(--dashboard-surface)] border border-[var(--dashboard-stroke)]',
              'text-[var(--dashboard-text)]',
              'hover:bg-[color-mix(in_srgb,var(--dashboard-surface)_92%,#000_8%)]',
              'focus-visible:ring-2 focus-visible:ring-[var(--dashboard-focus-glow)] focus-visible:ring-offset-0',
              'disabled:opacity-60 disabled:cursor-not-allowed',
              showPlaceholder && 'text-[var(--dashboard-muted)]',
              sizes.trigger,
              triggerClassName,
            )}
            style={{ boxShadow: 'var(--dashboard-raised-soft)' }}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {leadingIcon}
              <span className="truncate text-left">{triggerLabel}</span>
              {isMulti && selectedMulti.length > 0 ? (
                <span
                  className={cn(
                    'ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    'bg-[var(--dashboard-accent)]/15 text-[var(--dashboard-accent)]',
                  )}
                  aria-label={`${selectedMulti.length} seçili`}
                >
                  {selectedMulti.length}
                </span>
              ) : null}
            </div>
            <ChevronsUpDown
              className={cn(sizes.chevron, 'shrink-0 opacity-50')}
              aria-hidden="true"
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align={align}
          sideOffset={6}
          className={cn(
            'p-0 w-[var(--radix-popover-trigger-width)] min-w-[240px]',
            'border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]',
            contentClassName,
          )}
          style={{ boxShadow: 'var(--dashboard-raised)' }}
        >
          <Command
            filter={(value, search) => {
              if (!search) return 1;
              return value.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr'))
                ? 1
                : 0;
            }}
          >
            <CommandInput placeholder={searchPlaceholder} />

            {isMulti && (props as MultiProps).showSelectAll !== false ? (
              <div className="flex items-center justify-between gap-2 border-b border-[var(--dashboard-stroke)] px-3 py-1.5 text-xs">
                <span className="text-[var(--dashboard-muted)]">
                  {selectedMulti.length} / {sortedLabs.length} seçili
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    disabled={
                      sortedLabs.length === 0 ||
                      selectedMulti.length === sortedLabs.length
                    }
                    className={cn(
                      'rounded-md px-2 py-1 text-[var(--dashboard-accent)] hover:bg-[var(--dashboard-accent)]/10',
                      'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                    )}
                  >
                    Tümünü Seç
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={selectedMulti.length === 0}
                    className={cn(
                      'rounded-md px-2 py-1 text-[var(--dashboard-muted)] hover:bg-[var(--dashboard-stroke)]/40',
                      'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                    )}
                  >
                    Temizle
                  </button>
                </div>
              </div>
            ) : null}

            <CommandList>
              {loading ? (
                <div className="px-3 py-4 text-center text-sm text-[var(--dashboard-muted)]">
                  Yükleniyor...
                </div>
              ) : (
                <CommandEmpty>{emptyMessage}</CommandEmpty>
              )}

              {!loading && allOption && !isMulti ? (
                <CommandGroup>
                  <CommandItem
                    value={allOption.label}
                    onSelect={() => handleSelectSingle(allOption.value)}
                    className="gap-2"
                  >
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        selectedSingle === allOption.value
                          ? 'opacity-100 text-[var(--dashboard-accent)]'
                          : 'opacity-0',
                      )}
                      aria-hidden="true"
                    />
                    <span className="font-medium">{allOption.label}</span>
                  </CommandItem>
                </CommandGroup>
              ) : null}

              {!loading && sortedLabs.length > 0 ? (
                <CommandGroup>
                  {sortedLabs.map((lab) => {
                    const selected = isMulti
                      ? selectedMulti.includes(lab.id)
                      : selectedSingle === lab.id;
                    const searchValue = `${lab.name ?? ''} ${lab.kod ?? ''}`.trim();
                    return (
                      <CommandItem
                        key={lab.id}
                        value={searchValue || lab.id}
                        disabled={lab.disabled}
                        onSelect={() => {
                          if (lab.disabled) return;
                          if (isMulti) handleToggleMulti(lab.id);
                          else handleSelectSingle(lab.id);
                        }}
                        className={cn(
                          'gap-2 items-start py-2',
                          selected && 'bg-[var(--dashboard-accent)]/8',
                        )}
                      >
                        {isMulti ? (
                          <span
                            className={cn(
                              'mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors',
                              selected
                                ? 'bg-[var(--dashboard-accent)] border-[var(--dashboard-accent)] text-white'
                                : 'border-[var(--dashboard-stroke)] bg-transparent',
                            )}
                            aria-hidden="true"
                          >
                            {selected ? <Check className="h-3 w-3" /> : null}
                          </span>
                        ) : (
                          <Check
                            className={cn(
                              'mt-0.5 h-4 w-4 shrink-0',
                              selected
                                ? 'opacity-100 text-[var(--dashboard-accent)]'
                                : 'opacity-0',
                            )}
                            aria-hidden="true"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm">
                              {lab.name ?? lab.id}
                            </span>
                            {showCode && lab.kod ? (
                              <span className="text-[10px] font-mono text-[var(--dashboard-muted)]">
                                {lab.kod}
                              </span>
                            ) : null}
                          </div>
                          {lab.meta ? (
                            <p className="text-[11px] text-[var(--dashboard-muted)] truncate">
                              {lab.meta}
                            </p>
                          ) : null}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {helperText ? (
        <p className="mt-1 text-xs text-[var(--dashboard-muted)]">{helperText}</p>
      ) : null}

      {isMulti && (props as MultiProps).showChips && selectedMulti.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedMulti.map((id) => {
            const lab = labMap.get(id);
            const name = lab?.name ?? id;
            return (
              <span
                key={id}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                  'bg-[var(--dashboard-accent)]/12 text-[var(--dashboard-text)]',
                  'border border-[var(--dashboard-accent)]/25',
                )}
              >
                <span className="truncate max-w-[160px]">{name}</span>
                <button
                  type="button"
                  onClick={() => handleToggleMulti(id)}
                  className="rounded-full hover:bg-[var(--dashboard-accent)]/20 p-0.5"
                  aria-label={`${name} kaldır`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default LabSelector;
