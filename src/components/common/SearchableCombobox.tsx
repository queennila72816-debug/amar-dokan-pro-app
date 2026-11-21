import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface ComboboxOption {
  id: string;
  label: string;
  sublabel?: string;
  badge?: string;
  searchText?: string;
  disabled?: boolean;
}

export function filterComboboxOptions(options: ComboboxOption[], query: string): ComboboxOption[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return options;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return options.filter(opt => {
    const haystack = [opt.label, opt.sublabel, opt.badge, opt.searchText]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return tokens.every(tok => haystack.includes(tok));
  });
}

interface SearchableComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (selectedId: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

export const SearchableCombobox: React.FC<SearchableComboboxProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Type to search...',
  emptyMessage = 'No matching records found',
  ariaLabel,
  size = 'md',
  disabled = false,
  className = '',
}) => {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedOption = useMemo(
    () => options.find(opt => opt.id === value) || null,
    [options, value]
  );

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isFiltering, setIsFiltering] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const filteredOptions = useMemo(() => {
    if (!isFiltering) return options;
    return filterComboboxOptions(options, query);
  }, [options, query, isFiltering]);

  // Keep highlighted index valid when filtered list changes
  useEffect(() => {
    if (!isOpen) return;
    if (filteredOptions.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    if (!isFiltering && selectedOption) {
      const idx = filteredOptions.findIndex(o => o.id === selectedOption.id);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else {
      setHighlightedIndex(0);
    }
  }, [filteredOptions, isOpen, isFiltering, selectedOption]);

  // Position floating listbox via portal so modal overflow-y-auto never clips options
  const updatePosition = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const estimatedMaxHeight = 260;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(
      estimatedMaxHeight,
      Math.max(120, (openUpward ? spaceAbove : spaceBelow) - 12)
    );

    setMenuStyle({
      position: 'fixed',
      left: `${rect.left}px`,
      width: `${Math.max(rect.width, 230)}px`,
      maxWidth: `calc(100vw - ${Math.max(16, rect.left + 8)}px)`,
      top: openUpward ? undefined : `${rect.bottom + 4}px`,
      bottom: openUpward ? `${viewportHeight - rect.top + 4}px` : undefined,
      maxHeight: `${maxHeight}px`,
      zIndex: 90,
    });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleReposition = () => updatePosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, filteredOptions.length]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setIsOpen(false);
        setIsFiltering(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  // Scroll highlighted option into view during keyboard navigation
  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    const optEl = optionRefs.current[highlightedIndex];
    if (optEl && typeof optEl.scrollIntoView === 'function') {
      optEl.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  const openDropdown = (selectAllText = false) => {
    if (disabled) return;
    setIsOpen(true);
    setIsFiltering(false);
    setQuery(selectedOption?.label || '');
    if (selectAllText) {
      requestAnimationFrame(() => {
        inputRef.current?.select();
      });
    }
  };

  const closeAndReset = () => {
    setIsOpen(false);
    setIsFiltering(false);
    setQuery('');
  };

  const handleSelect = (opt: ComboboxOption) => {
    if (opt.disabled) return;
    onChange(opt.id);
    setIsOpen(false);
    setIsFiltering(false);
    setQuery('');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value;
    if (!isOpen) setIsOpen(true);
    setIsFiltering(true);
    setQuery(nextVal);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown(false);
        return;
      }
      if (filteredOptions.length === 0) return;
      setHighlightedIndex(prev => {
        const next = prev + 1;
        return next >= filteredOptions.length ? 0 : next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown(false);
        return;
      }
      if (filteredOptions.length === 0) return;
      setHighlightedIndex(prev => {
        const next = prev - 1;
        return next < 0 ? filteredOptions.length - 1 : next;
      });
    } else if (e.key === 'Enter') {
      if (isOpen) {
        e.preventDefault();
        const target =
          highlightedIndex >= 0 && highlightedIndex < filteredOptions.length
            ? filteredOptions[highlightedIndex]
            : filteredOptions[0];
        if (target && !target.disabled) {
          handleSelect(target);
        }
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeAndReset();
        inputRef.current?.blur();
      }
    } else if (e.key === 'Tab') {
      if (isOpen) {
        closeAndReset();
      }
    }
  };

  const displayValue = isOpen
    ? isFiltering
      ? query
      : selectedOption?.label || ''
    : selectedOption?.label || '';

  const paddingClasses = size === 'sm' ? 'py-1.5 pl-7 pr-12 text-xs' : 'py-2 pl-8 pr-14 text-xs';
  const iconLeftClasses = size === 'sm' ? 'left-2 w-3.5 h-3.5' : 'left-2.5 w-3.5 h-3.5';

  const activeDescendantId =
    isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]
      ? `${listboxId}-opt-${highlightedIndex}`
      : undefined;

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div className="relative flex items-center">
        <Search
          className={`pointer-events-none absolute text-[#64748B] dark:text-slate-400 ${iconLeftClasses}`}
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={activeDescendantId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={displayValue}
          placeholder={selectedOption ? selectedOption.label : placeholder}
          onFocus={() => {
            if (!isOpen) openDropdown(true);
          }}
          onClick={() => {
            if (!isOpen) openDropdown(true);
          }}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          className={`w-full border border-[#E2E8F0] dark:border-[#1F3158] bg-white dark:bg-[#0E182E] text-[#172033] dark:text-white placeholder:text-[#94A3B8] dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C] transition-colors ${
            size === 'sm' ? 'rounded-[8px]' : 'rounded-[10px]'
          } ${paddingClasses} disabled:bg-slate-50 dark:disabled:bg-[#0A122C] disabled:text-slate-400`}
        />

        <div className="absolute right-1.5 flex items-center gap-0.5">
          {isOpen && query && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Clear search"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsFiltering(true);
                setQuery('');
                inputRef.current?.focus();
              }}
              className="p-0.5 text-[#64748B] dark:text-slate-400 hover:text-[#172033] dark:hover:text-white rounded cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-label={isOpen ? 'Close options' : 'Show options'}
            onMouseDown={(e) => {
              e.preventDefault();
              if (isOpen) {
                closeAndReset();
              } else {
                inputRef.current?.focus();
                openDropdown(true);
              }
            }}
            className="p-0.5 text-[#64748B] dark:text-slate-400 hover:text-[#172033] dark:hover:text-white rounded cursor-pointer"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-150 ${
                isOpen ? 'rotate-180 text-[#243B70] dark:text-[#FF9D32]' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            className="adp-dropdown-enter bg-white dark:bg-[#101B3F] border border-[#E2E8F0] dark:border-[#243B70] rounded-[12px] shadow-2xl overflow-y-auto py-1 text-xs"
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-[#64748B] dark:text-slate-400 text-[11px]">
                {emptyMessage}
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.id === value;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <button
                    key={opt.id}
                    id={`${listboxId}-opt-${idx}`}
                    ref={el => {
                      optionRefs.current[idx] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(opt);
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isHighlighted
                        ? 'bg-[#087F8C]/10 dark:bg-[#087F8C]/25 text-[#087F8C] dark:text-[#5EEAD4]'
                        : isSelected
                        ? 'bg-[#F5F7FC] dark:bg-[#182954] text-[#101B3F] dark:text-white'
                        : 'text-[#172033] dark:text-slate-200 hover:bg-[#F8FAFC] dark:hover:bg-[#182954]/80'
                    } ${opt.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate flex items-center gap-1.5">
                        <span className="truncate">{opt.label}</span>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-[#087F8C] dark:text-[#10B981] shrink-0" />
                        )}
                      </div>
                      {opt.sublabel && (
                        <div className="text-[10px] text-[#64748B] dark:text-slate-400 truncate mt-0.5">
                          {opt.sublabel}
                        </div>
                      )}
                    </div>
                    {opt.badge && (
                      <span className="text-[10px] font-mono-num font-semibold px-1.5 py-0.5 rounded-[6px] bg-[#F5F7FC] dark:bg-[#0A122C] text-[#101B3F] dark:text-slate-200 border border-[#E2E8F0] dark:border-[#243B70] shrink-0">
                        {opt.badge}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
