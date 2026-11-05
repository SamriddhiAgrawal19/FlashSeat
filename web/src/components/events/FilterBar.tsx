import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Container } from '../ui/Container';
import { CategorySelect, CityInput, DateChips, type FilterControlsProps } from './FilterControls';

interface FilterBarProps extends FilterControlsProps {
  hasFilters: boolean;
  activeCount: number;
  onClear: () => void;
  /** total from the current results, for the sheet's "Show N results" button. */
  total: number | undefined;
}

/** Desktop: one row, sticky under the navbar. */
function DesktopBar({ idPrefix, filters, setFilters, hasFilters, onClear }: FilterBarProps) {
  return (
    <div className="sticky top-16 z-30 hidden border-y border-rule bg-[rgb(12_12_12/0.94)] backdrop-blur-md md:block">
      <Container className="flex items-end gap-6 py-4">
        <div className="w-56 shrink-0 lg:w-64">
          <CityInput id={`${idPrefix}-city`} value={filters.city} onCommit={(city) => setFilters({ city }, { replace: true })} />
        </div>
        <div className="w-44 shrink-0">
          <CategorySelect id={`${idPrefix}-category`} value={filters.category} onChange={(category) => setFilters({ category })} />
        </div>
        <div className="min-w-0 flex-1">
          <DateChips dateFrom={filters.dateFrom} dateTo={filters.dateTo} onChange={(range) => setFilters(range)} />
        </div>
        {hasFilters && (
          <button type="button" onClick={onClear} className="h-11 shrink-0 text-[15px] text-text-2 underline decoration-text/30 underline-offset-4 hover:text-lime">
            Clear
          </button>
        )}
      </Container>
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
    sheetRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
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
    <Container className="flex items-center justify-between gap-4 border-y border-rule py-3 md:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-11 items-center gap-2.5 border border-rule px-4 text-[15px] text-text"
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" strokeWidth={1.5} />
        Filters
        {activeCount > 0 && <span className="label-mono grid size-5 place-items-center bg-lime text-bg">{activeCount}</span>}
      </button>
      {hasFilters && (
        <button type="button" onClick={onClear} className="h-11 text-[15px] text-text-2 underline decoration-text/30 underline-offset-4">
          Clear
        </button>
      )}

      {open &&
        createPortal(
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={`${idPrefix}-sheet-title`} className="fixed inset-0 z-50 flex flex-col bg-bg md:hidden">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-rule px-4">
              <p id={`${idPrefix}-sheet-title`} className="text-title font-medium text-text">
                Filters
              </p>
              <button type="button" onClick={close} aria-label="Close filters" className="-mr-2 grid size-11 place-items-center text-text">
                <X aria-hidden="true" className="size-6" strokeWidth={1.5} />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-4 py-6">
              <CityInput id={`${idPrefix}-m-city`} value={filters.city} onCommit={(city) => setFilters({ city }, { replace: true })} />
              <CategorySelect id={`${idPrefix}-m-category`} value={filters.category} onChange={(category) => setFilters({ category })} />
              <DateChips dateFrom={filters.dateFrom} dateTo={filters.dateTo} onChange={(range) => setFilters(range)} />
            </div>
            <div className="grid shrink-0 grid-cols-[auto_1fr] gap-3 border-t border-rule px-4 py-4">
              <Button variant="secondary" onClick={onClear} disabled={!hasFilters}>
                Clear
              </Button>
              <Button onClick={close}>{total === undefined ? 'Show results' : `Show ${total} result${total === 1 ? '' : 's'}`}</Button>
            </div>
          </div>,
          document.body,
        )}
    </Container>
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
