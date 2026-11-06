// Seat builder: the organizer describes row groups (or standing zones), sees a live preview, and
// saves. Each group is one POST /venues/:id/seats/bulk, in order; a group larger than the
// per-request cap is split by rows into several requests.
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { describeNetworkOrRateLimit } from '../auth/FormParts';
import {
  ApiError,
  bulkCreateSeats,
  MAX_SEATS_PER_BULK_CALL,
  MAX_SEATS_PER_ROW,
  MAX_SEATS_PER_VENUE,
  SEAT_TAG_MAX,
  type BulkSeatsBody,
  type VenueLayout,
  type VenueSeatLimitDetails,
} from '../../lib/api';
import { describeRows, formatCount, normalizeTag, parseRowLabels } from '../../lib/organizer';
import { invalidateVenueCaches } from '../../lib/organizerQueries';
import { showToast } from '../../lib/toast';
import { categoriesInOrder, categoryColor, CategoryTotals, layoutToPreview, orderCategories, PreviewRows, previewTotals, type PreviewSection } from './LayoutPreview';
import { CATEGORY_SUGGESTIONS, RowGroupEditor, type GroupCheck, type GroupDraft } from './RowGroupEditor';
import { Action, Arr, InlineAlert } from './ui';

type Mode = 'GRID' | 'GENERAL_ADMISSION';

let nextKey = 1;
const newGrid = (): GroupDraft => ({ key: nextKey++, kind: 'GRID', rows: '', seatsPerRow: '10', category: 'REGULAR', section: 'MAIN' });
const newStanding = (): GroupDraft => ({ key: nextKey++, kind: 'GENERAL_ADMISSION', count: '200', category: 'GA', section: 'FLOOR' });

/** The bulk API writes standing zones as row G of their section. */
const STANDING_ROW = 'G';
const rowKey = (section: string, row: string) => `${section}\u0000${row}`;

function parsePositiveInt(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function checkTag(value: string): string | undefined {
  const t = value.trim();
  if (t === '') return 'Required.';
  if (t.length > SEAT_TAG_MAX) return `At most ${SEAT_TAG_MAX} characters.`;
  return undefined;
}

/** Validate every group against the API rules, each other, and the venue's existing rows. */
function checkGroups(groups: GroupDraft[], existing: Set<string>): GroupCheck[] {
  const claimed = new Map<string, number>(); // rowKey -> group index that first claimed it
  return groups.map((group, index) => {
    const errors: GroupCheck['errors'] = {};
    const section = normalizeTag(group.section, 'MAIN');
    const categoryErr = checkTag(group.category);
    if (categoryErr) errors.category = categoryErr;
    const sectionErr = checkTag(group.section);
    if (sectionErr) errors.section = sectionErr;

    let rows: string[] = [];
    let seats = 0;
    if (group.kind === 'GRID') {
      const parsed = parseRowLabels(group.rows);
      if (!parsed.ok) errors.rows = parsed.error;
      else rows = parsed.rows;
      const perRow = parsePositiveInt(group.seatsPerRow);
      if (perRow === null || perRow > MAX_SEATS_PER_ROW) errors.seatsPerRow = `1 to ${MAX_SEATS_PER_ROW}.`;
      else seats = rows.length * perRow;
    } else {
      rows = [STANDING_ROW];
      const count = parsePositiveInt(group.count);
      if (count === null || count > MAX_SEATS_PER_BULK_CALL) errors.count = `1 to ${formatCount(MAX_SEATS_PER_BULK_CALL)}.`;
      else seats = count;
    }

    if (!errors.rows && !errors.section) {
      const taken = rows.filter((r) => existing.has(rowKey(section, r)));
      const dup = rows.filter((r) => {
        const owner = claimed.get(rowKey(section, r));
        return owner !== undefined && owner !== index;
      });
      const where = group.kind === 'GRID' ? 'rows' : 'section';
      if (taken.length > 0) {
        errors[where] =
          group.kind === 'GRID'
            ? `${taken.length === 1 ? 'Row' : 'Rows'} ${describeRows(taken)} already ${taken.length === 1 ? 'exists' : 'exist'} in ${section}.`
            : `${section} already has seats in row G. Use another section.`;
      } else if (dup.length > 0) {
        errors[where] =
          group.kind === 'GRID' ? `${describeRows(dup)} also appears in another group in ${section}.` : `Another group already uses ${section} row G.`;
      }
      for (const r of rows) if (!claimed.has(rowKey(section, r))) claimed.set(rowKey(section, r), index);
    }

    return { errors, rows, seats: Object.keys(errors).length === 0 ? seats : 0 };
  });
}

/** Valid groups -> preview sections (merged by section, in group order). */
function draftToPreview(groups: GroupDraft[], checks: GroupCheck[]): PreviewSection[] {
  const sections = new Map<string, PreviewSection>();
  groups.forEach((group, i) => {
    const check = checks[i];
    if (!check || check.seats === 0) return;
    const name = normalizeTag(group.section, 'MAIN');
    const category = normalizeTag(group.category, 'REGULAR');
    const section = sections.get(name) ?? { section: name, rows: [] };
    sections.set(name, section);
    if (group.kind === 'GRID') {
      const perRow = Number(group.seatsPerRow);
      for (const row of check.rows) section.rows.push({ row, segments: [{ category, count: perRow }] });
    } else {
      section.standing = { count: check.seats, category };
    }
  });
  return [...sections.values()];
}

/** One group -> its bulk request bodies (rows chunked to stay within the per-request cap). */
function requestsFor(group: GroupDraft, check: GroupCheck): Array<{ body: BulkSeatsBody; rows: string[] }> {
  const section = normalizeTag(group.section, 'MAIN');
  const category = normalizeTag(group.category, 'REGULAR');
  if (group.kind === 'GENERAL_ADMISSION') {
    return [{ body: { mode: 'GENERAL_ADMISSION', count: check.seats, section, category }, rows: [STANDING_ROW] }];
  }
  const perRow = Number(group.seatsPerRow);
  const rowsPerCall = Math.max(1, Math.floor(MAX_SEATS_PER_BULK_CALL / perRow));
  const out: Array<{ body: BulkSeatsBody; rows: string[] }> = [];
  for (let i = 0; i < check.rows.length; i += rowsPerCall) {
    const rows = check.rows.slice(i, i + rowsPerCall);
    out.push({ body: { mode: 'GRID', rows, seatsPerRow: perRow, section, category }, rows });
  }
  return out;
}

function describeSaveError(error: unknown, group: GroupDraft, rows: string[]): string {
  if (!(error instanceof ApiError)) return 'Something went wrong.';
  const section = normalizeTag(group.section, 'MAIN');
  if (error.code === 'SEATS_ALREADY_EXIST') {
    return group.kind === 'GRID'
      ? `Some of rows ${describeRows(rows)} already exist in section ${section}, so nothing from this group was added. The layout above is now up to date; change the row labels or the section.`
      : `Section ${section} already has standing seats (row G). Use another section name.`;
  }
  if (error.code === 'VENUE_SEAT_LIMIT') {
    const d = error.details as Partial<VenueSeatLimitDetails> | undefined;
    return `A venue can have at most ${formatCount(d?.max ?? MAX_SEATS_PER_VENUE)} seats. It has ${formatCount(d?.existing ?? 0)} and this group adds ${formatCount(d?.requested ?? 0)}.`;
  }
  if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
    const first = error.details[0] as { message?: unknown } | undefined;
    if (typeof first?.message === 'string') return first.message;
  }
  return describeNetworkOrRateLimit(error.code, error.retryAfterSeconds) ?? error.message;
}

interface Props {
  venueId: string;
  venueName: string;
  layout: VenueLayout | undefined;
}

export function SeatBuilder({ venueId, venueName, layout }: Props) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('GRID');
  const [grid, setGrid] = useState<GroupDraft[]>(() => [newGrid()]);
  const [standing, setStanding] = useState<GroupDraft[]>(() => [newStanding()]);
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const groups = mode === 'GRID' ? grid : standing;
  const setGroups = mode === 'GRID' ? setGrid : setStanding;

  const existing = useMemo(() => {
    const keys = new Set<string>();
    for (const s of layout?.sections ?? []) for (const r of s.rows) keys.add(rowKey(s.section, r.row));
    return keys;
  }, [layout]);

  const checks = useMemo(() => checkGroups(groups, existing), [groups, existing]);
  const preview = useMemo(() => draftToPreview(groups, checks), [groups, checks]);
  const totals = previewTotals(preview);
  const adding = [...totals.values()].reduce((a, b) => a + b, 0);
  const existingCount = layout?.seat_count ?? 0;
  const overVenueCap = existingCount + adding > MAX_SEATS_PER_VENUE;
  // Presentation: the current layout (drawn dimmed above the new groups) and the shade order,
  // categories in the order they appear (existing rows first, then the new groups).
  const existingPreview = useMemo(() => (layout ? layoutToPreview(layout) : []), [layout]);
  const order = orderCategories([...categoriesInOrder(existingPreview), ...totals.keys()]);
  const allValid = checks.every((c) => Object.keys(c.errors).length === 0);

  function update(index: number, group: GroupDraft) {
    setGroups((gs) => gs.map((g, i) => (i === index ? group : g)));
    setTouched((t) => new Set(t).add(group.key));
    setSaveError(null);
  }

  async function save() {
    setAttempted(true);
    setSaveError(null);
    if (!allValid || adding === 0 || overVenueCap) return;
    setSaving(true);
    let saved = 0;
    const remaining = [...groups];
    try {
      for (const [i, group] of groups.entries()) {
        const check = checks[i];
        if (!check) continue;
        const requests = requestsFor(group, check);
        for (const [j, request] of requests.entries()) {
          try {
            await bulkCreateSeats(venueId, request.body);
          } catch (error) {
            // Rows of this group saved by earlier chunks are done; leave only the rest in the form.
            if (group.kind === 'GRID' && j > 0) {
              remaining[0] = { ...group, rows: describeRows(requests.slice(j).flatMap((r) => r.rows)) };
            }
            setSaveError(`Group ${i + 1}: ${describeSaveError(error, group, request.rows)}`);
            showToast(saved > 0 ? `Saved ${formatCount(saved)} seats; group ${i + 1} failed.` : `Couldn't save group ${i + 1}.`);
            return;
          }
          saved += request.body.mode === 'GRID' ? request.rows.length * request.body.seatsPerRow : request.body.count;
        }
        remaining.shift();
      }
      showToast(`Added ${formatCount(saved)} seats to ${venueName}.`);
      setAttempted(false);
      setTouched(new Set());
    } finally {
      setGroups(remaining.length > 0 ? remaining : [mode === 'GRID' ? newGrid() : newStanding()]);
      setSaving(false);
      await invalidateVenueCaches(queryClient, venueId);
    }
  }

  const addGroup = () =>
    setGroups((gs) => [...gs, mode === 'GRID' ? { ...newGrid(), category: gs[gs.length - 1]?.category ?? 'REGULAR', section: gs[gs.length - 1]?.section ?? 'MAIN' } : { ...newStanding(), section: '' }]);

  return (
    <div className="og-sb">
      <datalist id="seat-category-suggestions">
        {CATEGORY_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <section aria-labelledby="groups-title" className="og-card og-sb-left">
        <div className="og-sb-head">
          <h2 id="groups-title" className="og-card-title">
            {mode === 'GRID' ? 'Row groups' : 'Standing zones'}
          </h2>
          <Action small disabled={saving} onClick={addGroup}>
            {mode === 'GRID' ? '+ Add group' : '+ Add zone'}
          </Action>
        </div>

        <div role="radiogroup" aria-label="Seating type" className="og-seg">
          {(
            [
              ['GRID', 'Numbered'],
              ['GENERAL_ADMISSION', 'General admission'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              disabled={saving}
              onClick={() => {
                setMode(value);
                setAttempted(false);
                setSaveError(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="og-hint" style={{ margin: 0 }}>
          {mode === 'GRID'
            ? 'Rows of numbered seats. Each group is a set of rows with the same length and category.'
            : 'Unnumbered capacity, e.g. a standing floor. Each zone needs its own section name.'}
        </p>

        {groups.map((group, i) => (
          <RowGroupEditor
            key={group.key}
            index={i}
            group={group}
            check={checks[i] ?? { errors: {}, rows: [], seats: 0 }}
            showErrors={attempted || touched.has(group.key)}
            disabled={saving}
            removable={groups.length > 1}
            shade={categoryColor(normalizeTag(group.category, 'REGULAR'), order)}
            onChange={(g) => update(i, g)}
            onRemove={() => setGroups((gs) => gs.filter((_, k) => k !== i))}
          />
        ))}

        {overVenueCap && (
          <InlineAlert>
            A venue can have at most {formatCount(MAX_SEATS_PER_VENUE)} seats. This venue has {formatCount(existingCount)}, so you can add{' '}
            {formatCount(Math.max(0, MAX_SEATS_PER_VENUE - existingCount))} more.
          </InlineAlert>
        )}
        {saveError && <InlineAlert>{saveError}</InlineAlert>}
        {attempted && !allValid && !saveError && <InlineAlert>Fix the highlighted fields first.</InlineAlert>}

        <div className="og-sb-foot">
          {adding > 0 ? <CategoryTotals totals={totals} order={order} /> : <span>Fill in a group to add seats.</span>}
          <Action tone="accent" busy={saving} onClick={() => void save()} disabled={adding === 0 && allValid}>
            {saving ? 'Saving…' : (
              <>
                Save layout <Arr />
              </>
            )}
          </Action>
        </div>
        <p className="og-hint" style={{ margin: 0 }}>
          Seats can't be edited or removed after saving, and shows copy the layout when they're created.
        </p>
      </section>

      <section aria-labelledby="preview-title" className="og-preview">
        <div className="og-preview-head">
          <span id="preview-title">LIVE PREVIEW</span>
          <span>
            {formatCount(existingCount)} → <span style={{ color: 'var(--text)' }}>{formatCount(existingCount + adding)}</span> SEATS
          </span>
        </div>
        <figure className="og-preview-scroll" style={{ margin: 0 }}>
          <figcaption className="sr-only">
            Preview of {venueName}: {formatCount(existingCount)} existing seats, {formatCount(adding)} new seats.
          </figcaption>
          <div aria-hidden="true" className="og-preview-in">
            <div className="og-stage" />
            <span className="og-stage-label">STAGE</span>
            {existingPreview.length > 0 && (
              <>
                <span className="og-existing-label">CURRENT LAYOUT · READ-ONLY</span>
                <div className="og-existing">
                  <PreviewRows sections={existingPreview} order={order} />
                </div>
              </>
            )}
            {adding > 0 ? (
              <>
                {existingPreview.length > 0 && <span className="og-new-label">NEW SEATS</span>}
                <PreviewRows sections={preview} order={order} />
              </>
            ) : (
              <p className="og-preview-empty">Fill in a group to see it here.</p>
            )}
          </div>
        </figure>
      </section>
    </div>
  );
}
