import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import { GhostButton, PrimaryButton } from '../site/ui';
import { CategoryPills, CityInput, DateTabs, type FilterControlsProps } from './FilterControls';

interface FilterBarProps extends FilterControlsProps {
  hasFilters: boolean;
  activeCount: number;
  onClear: () => void;
  /** total from the current results, for the sheet's "Show N results" button. */
  total: number | undefined;
}

/** Desktop and tablet: one row, sticky under the site header. */
function DesktopBar({ idPrefix, filters, setFilters, hasFilters, onClear }: FilterBarProps) {
  return (
    <div className="ev-filters">
      <div className="site-wrap ev-filters-in">
        <CityInput id={`${idPrefix}-city`} value={filters.city} onCommit={(city) => setFilters({ city }, { replace: true })} />
        <CategoryPills value={filters.category} onChange={(category) => setFilters({ category })} />
        <DateTabs dateFrom={filters.dateFrom} dateTo={filters.dateTo} onChange={(range) => setFilters(range)} />
        {hasFilters && (
          <button type="button" onClick={onClear} className="ev-clear">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/** Phones: a "Filters" button that opens a full-screen sheet with the same controls. */
function MobileFilters({ idPrefix, filters, setFilters, hasFilters, activeCount, onClear, total }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div className="site-wrap ev-mfilters">
      <button ref={buttonRef} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className="ev-mbtn">
        <SlidersHorizontal aria-hidden="true" size={16} strokeWidth={1.6} />
        Filters
        {activeCount > 0 && (
          <span className="ev-mbadge">
            {activeCount}
            <span className="sr-only"> active</span>
          </span>
        )}
      </button>
      {hasFilters && (
        <button type="button" onClick={onClear} className="ev-clear">
          Clear
        </button>
      )}

      {open &&
        createPortal(
          // Portaled to <body>, outside the page's .v2 scope, so it carries the scope itself.
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={`${idPrefix}-sheet-title`} className="v2 ev-sheet">
            <div className="ev-sheet-head">
              <h2 id={`${idPrefix}-sheet-title`} className="ev-sheet-title">
                Filters
              </h2>
              <button type="button" onClick={close} aria-label="Close filters" className="ev-sheet-close">
                <X aria-hidden="true" size={24} strokeWidth={1.5} />
              </button>
            </div>
            <div className="ev-sheet-body">
              <div className="ev-sheet-group">
                <span className="site-eyebrow">City</span>
                <CityInput id={`${idPrefix}-m-city`} value={filters.city} onCommit={(city) => setFilters({ city }, { replace: true })} />
              </div>
              <div className="ev-sheet-group">
                <span className="site-eyebrow">Category</span>
                <CategoryPills value={filters.category} onChange={(category) => setFilters({ category })} />
              </div>
              <div className="ev-sheet-group">
                <span className="site-eyebrow">When</span>
                <DateTabs dateFrom={filters.dateFrom} dateTo={filters.dateTo} onChange={(range) => setFilters(range)} />
              </div>
            </div>
            <div className="ev-sheet-foot">
              <GhostButton onClick={onClear} disabled={!hasFilters}>
                Clear
              </GhostButton>
              <PrimaryButton onClick={close}>{total === undefined ? 'Show results' : `Show ${total} result${total === 1 ? '' : 's'}`}</PrimaryButton>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** No wrapper element: the desktop bar must be a direct child of the page so it can stay sticky. */
export function FilterBar(props: FilterBarProps) {
  return (
    <>
      <DesktopBar {...props} />
      <MobileFilters {...props} />
    </>
  );
}
