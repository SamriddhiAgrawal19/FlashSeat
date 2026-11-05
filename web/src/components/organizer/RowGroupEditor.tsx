import { X } from 'lucide-react';
import { MAX_SEATS_PER_BULK_CALL, MAX_SEATS_PER_ROW, SEAT_TAG_MAX } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/organizer';
import { Input } from './ui';

export const CATEGORY_SUGGESTIONS = ['REGULAR', 'PREMIUM', 'VIP'];

export interface GridGroupDraft {
  key: number;
  kind: 'GRID';
  rows: string;
  seatsPerRow: string;
  category: string;
  section: string;
}

export interface StandingGroupDraft {
  key: number;
  kind: 'GENERAL_ADMISSION';
  count: string;
  category: string;
  section: string;
}

export type GroupDraft = GridGroupDraft | StandingGroupDraft;

/** Per-field problems of one group, plus how many seats it adds when valid. */
export interface GroupCheck {
  errors: Partial<Record<'rows' | 'seatsPerRow' | 'count' | 'category' | 'section', string>>;
  rows: string[];
  seats: number;
}

interface Props {
  index: number;
  group: GroupDraft;
  check: GroupCheck;
  /** Show errors only after the first save attempt or once a field was edited. */
  showErrors: boolean;
  disabled: boolean;
  removable: boolean;
  onChange: (group: GroupDraft) => void;
  onRemove: () => void;
}

/** One row group ("A–C × 12, REGULAR") or one standing zone. */
export function RowGroupEditor({ index, group, check, showErrors, disabled, removable, onChange, onRemove }: Props) {
  const id = `group-${group.key}`;
  const err = (k: keyof GroupCheck['errors']) => (showErrors ? check.errors[k] : undefined);
  const valid = Object.keys(check.errors).length === 0;

  return (
    <fieldset disabled={disabled} className="border border-rule">
      <legend className="sr-only">
        {group.kind === 'GRID' ? `Row group ${index + 1}` : `Standing zone ${index + 1}`}
      </legend>
      <div className="flex items-center justify-between gap-3 border-b border-rule px-3 py-2">
        <p className="label-mono text-text-3">
          {group.kind === 'GRID' ? 'Rows' : 'Zone'} <span className="text-text-2">{String(index + 1).padStart(2, '0')}</span>
        </p>
        <div className="flex items-center gap-3">
          <p className={cn('font-mono text-[12px]', valid ? 'text-text' : 'text-text-3')}>
            {valid
              ? group.kind === 'GRID'
                ? `${check.rows.length} × ${group.seatsPerRow} = ${formatCount(check.seats)} seats`
                : `${formatCount(check.seats)} seats`
              : '—'}
          </p>
          {removable && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${group.kind === 'GRID' ? 'row group' : 'zone'} ${index + 1}`}
              className="grid size-7 place-items-center rounded-[2px] text-text-3 hover:bg-text/[0.06] hover:text-text"
            >
              <X aria-hidden="true" className="size-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        {group.kind === 'GRID' ? (
          <>
            <Input
              id={`${id}-rows`}
              label="Row labels"
              value={group.rows}
              placeholder="A–C or A, B, F"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onChange({ ...group, rows: e.target.value })}
              error={err('rows')}
              hint={check.rows.length > 0 && !check.errors.rows ? check.rows.join(' ').slice(0, 60) : 'Range or comma list'}
              inputClassName="font-mono uppercase"
            />
            <Input
              id={`${id}-per-row`}
              label="Seats per row"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_SEATS_PER_ROW}
              value={group.seatsPerRow}
              onChange={(e) => onChange({ ...group, seatsPerRow: e.target.value })}
              error={err('seatsPerRow')}
              inputClassName="font-mono"
            />
          </>
        ) : (
          <Input
            id={`${id}-count`}
            label="Capacity"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SEATS_PER_BULK_CALL}
            value={group.count}
            onChange={(e) => onChange({ ...group, count: e.target.value })}
            error={err('count')}
            hint={`Up to ${formatCount(MAX_SEATS_PER_BULK_CALL)} per zone`}
            inputClassName="font-mono"
            className="lg:col-span-2"
          />
        )}
        <Input
          id={`${id}-category`}
          label="Category"
          list="seat-category-suggestions"
          value={group.category}
          maxLength={SEAT_TAG_MAX}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => onChange({ ...group, category: e.target.value })}
          error={err('category')}
          inputClassName="font-mono uppercase"
        />
        <Input
          id={`${id}-section`}
          label="Section"
          value={group.section}
          maxLength={SEAT_TAG_MAX}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => onChange({ ...group, section: e.target.value })}
          error={err('section')}
          inputClassName="font-mono uppercase"
        />
      </div>
    </fieldset>
  );
}
