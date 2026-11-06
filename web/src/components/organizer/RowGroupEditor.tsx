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
  /** The category's preview shade (left bar of the category field). */
  shade?: string;
  onChange: (group: GroupDraft) => void;
  onRemove: () => void;
}

/** One row group ("A–C × 12, REGULAR") or one standing zone, as one compact row. */
export function RowGroupEditor({ index, group, check, showErrors, disabled, removable, shade, onChange, onRemove }: Props) {
  const id = `group-${group.key}`;
  const err = (k: keyof GroupCheck['errors']) => (showErrors ? check.errors[k] : undefined);
  const valid = Object.keys(check.errors).length === 0;
  const name = group.kind === 'GRID' ? `row group ${index + 1}` : `zone ${index + 1}`;

  return (
    <fieldset disabled={disabled} className="og-group">
      <legend className="sr-only">{group.kind === 'GRID' ? `Row group ${index + 1}` : `Standing zone ${index + 1}`}</legend>
      <div className={cn('og-group-grid', group.kind !== 'GRID' && 'is-ga')}>
        {group.kind === 'GRID' ? (
          <>
            <Input
              id={`${id}-rows`}
              label="Rows"
              value={group.rows}
              placeholder="A–C"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onChange({ ...group, rows: e.target.value })}
              error={err('rows')}
              inputClassName="is-mono is-upper"
            />
            <Input
              id={`${id}-per-row`}
              label="Seats / row"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_SEATS_PER_ROW}
              value={group.seatsPerRow}
              onChange={(e) => onChange({ ...group, seatsPerRow: e.target.value })}
              error={err('seatsPerRow')}
              inputClassName="is-mono"
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
            inputClassName="is-mono"
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
          inputClassName="is-mono is-upper og-cat"
          inputStyle={{ borderLeftColor: shade ?? 'rgba(255,255,255,0.12)' }}
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
          inputClassName="is-mono is-upper"
        />
        <button type="button" className="og-x" onClick={onRemove} aria-label={`Remove ${name}`} hidden={!removable}>
          ×
        </button>
      </div>
      <p className={cn('og-group-foot', valid && 'is-ok')} style={{ marginBottom: 0 }}>
        <span>
          {group.kind === 'GRID'
            ? check.rows.length > 0 && !check.errors.rows
              ? check.rows.join(' ').slice(0, 48)
              : 'Range (A–C) or list (A, B, F)'
            : `Up to ${formatCount(MAX_SEATS_PER_BULK_CALL)} per zone`}
        </span>
        <span>
          {valid
            ? group.kind === 'GRID'
              ? `${check.rows.length} × ${group.seatsPerRow} = ${formatCount(check.seats)} seats`
              : `${formatCount(check.seats)} seats`
            : '—'}
        </span>
      </p>
    </fieldset>
  );
}
