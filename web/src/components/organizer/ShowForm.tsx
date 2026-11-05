import { useMemo, useState, type FormEvent } from 'react';
import { describeNetworkOrRateLimit } from '../auth/FormParts';
import { ApiError, createShow, type CreatedShow, type MyVenue } from '../../lib/api';
import { formatPaise } from '../../lib/format';
import { formatCount, fromLocalInput, localZoneName, rupeesToPaise, toLocalInput } from '../../lib/organizer';
import { Action, ActionLink, InlineAlert, Input, Select } from './ui';

type FieldKey = 'venueId' | 'startsAt' | 'endsAt' | 'salesOpenAt' | 'prices';
type Errors = Partial<Record<FieldKey, string>> & { priceFor?: Record<string, string> };

const DEFAULT_DURATION_MS = 2 * 3600_000;

/** Map an API error to field errors or a form-level message (docs/api.md, POST /events/:id/shows). */
function mapServerError(error: unknown): { fields: Errors; form: string | null } {
  if (!(error instanceof ApiError)) return { fields: {}, form: 'Something went wrong. Try again.' };
  if (error.status === 409 && error.code === 'CONFLICT') {
    return {
      fields: { startsAt: 'Overlaps another show at this venue.' },
      form: 'This venue already has a show at that time. Pick another time or venue.',
    };
  }
  if (error.code === 'EVENT_CANCELLED') return { fields: {}, form: 'This event has been cancelled, so no new shows can be added.' };
  if (error.status === 404) return { fields: { venueId: 'That venue was not found in your account.' }, form: null };
  if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
    const fields: Errors = {};
    for (const issue of error.details as Array<{ path?: unknown; message?: unknown }>) {
      const key: unknown = Array.isArray(issue.path) ? issue.path[0] : undefined;
      const message = typeof issue.message === 'string' ? issue.message : 'Invalid value.';
      if (key === 'categoryPrices') fields.prices ??= message;
      else if (key === 'venueId' || key === 'startsAt' || key === 'endsAt' || key === 'salesOpenAt') fields[key] ??= message;
    }
    return { fields, form: Object.keys(fields).length === 0 ? error.message : null };
  }
  if (error.status === 400) {
    // Non-Zod 400s: "Venue has no seats", "Missing price for categories: ...", "Unknown categories ...".
    return /categor/i.test(error.message) ? { fields: { prices: error.message }, form: null } : { fields: {}, form: error.message };
  }
  return { fields: {}, form: describeNetworkOrRateLimit(error.code, error.retryAfterSeconds) ?? error.message };
}

interface Props {
  eventId: string;
  venues: MyVenue[];
  onCreated: (show: CreatedShow) => void;
  onCancel: () => void;
}

/** "Add show": venue, local start/end (sent as UTC ISO), optional sales open time, a price per category. */
export function ShowForm({ eventId, venues, onCreated, onCancel }: Props) {
  const usable = useMemo(() => venues.filter((v) => v.seat_count > 0), [venues]);
  const [venueId, setVenueId] = useState(usable.length === 1 ? (usable[0]?.id ?? '') : '');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [salesOpenAt, setSalesOpenAt] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const venue = usable.find((v) => v.id === venueId);
  const categories = venue?.categories ?? [];
  const minStart = toLocalInput(new Date(Date.now() + 60_000));

  function validate(): { body: Parameters<typeof createShow>[1] } | { errors: Errors } {
    const next: Errors = {};
    const start = fromLocalInput(startsAt);
    const end = fromLocalInput(endsAt);
    const sales = fromLocalInput(salesOpenAt);
    if (!venue) next.venueId = 'Choose a venue.';
    if (!start) next.startsAt = 'Pick a start date and time.';
    else if (start.getTime() <= Date.now()) next.startsAt = 'The show must start in the future.';
    if (!end) next.endsAt = 'Pick an end date and time.';
    else if (start && end.getTime() <= start.getTime()) next.endsAt = 'The show must end after it starts.';
    if (salesOpenAt && !sales) next.salesOpenAt = 'Pick a valid date and time, or leave it empty.';
    else if (sales && start && sales.getTime() >= start.getTime()) next.salesOpenAt = 'Sales must open before the show starts.';

    const priceFor: Record<string, string> = {};
    const categoryPrices = categories.map((category) => {
      const paise = rupeesToPaise(prices[category] ?? '');
      if (paise === null) priceFor[category] = (prices[category] ?? '').trim() === '' ? 'Enter a price (0 for free).' : 'Use a number ≥ 0, up to 2 decimals.';
      return { category, pricePaise: paise ?? 0 };
    });
    if (Object.keys(priceFor).length > 0) {
      next.priceFor = priceFor;
      next.prices = 'Every seat category needs a price.';
    }
    if (Object.keys(next).length > 0) return { errors: next };
    return {
      body: {
        venueId,
        startsAt: (start as Date).toISOString(),
        endsAt: (end as Date).toISOString(),
        ...(sales ? { salesOpenAt: sales.toISOString() } : {}),
        categoryPrices,
      },
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const result = validate();
    if ('errors' in result) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const show = await createShow(eventId, result.body);
      onCreated(show);
    } catch (error) {
      const mapped = mapServerError(error);
      setErrors(mapped.fields);
      setFormError(mapped.form);
    } finally {
      setBusy(false);
    }
  }

  if (usable.length === 0) {
    return (
      <div className="border border-dashed border-rule px-4 py-6 text-[14px] text-text-2">
        <p>Shows need a venue with seats, and none of your venues has any yet.</p>
        <ActionLink to={venues[0] ? `/organizer/venues/${venues[0].id}/seats` : '/organizer/venues/new'} className="mt-4">
          {venues.length > 0 ? 'Add seats to a venue' : 'Add a venue'}
        </ActionLink>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="border border-rule">
      <fieldset disabled={busy} className="space-y-5 p-4 sm:p-5">
        <legend className="sr-only">New show</legend>
        {formError && <InlineAlert>{formError}</InlineAlert>}

        <Select
          id="show-venue"
          label="Venue"
          value={venueId}
          onChange={(e) => {
            setVenueId(e.target.value);
            setErrors((er) => ({ ...er, venueId: undefined, prices: undefined, priceFor: undefined, startsAt: undefined }));
          }}
          error={errors.venueId}
          hint={venues.length > usable.length ? 'Venues without seats are not listed.' : undefined}
        >
          <option value="" disabled>
            Choose a venue…
          </option>
          {usable.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}, {v.city} · {formatCount(v.seat_count)} seats
            </option>
          ))}
        </Select>

        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            id="show-starts"
            label="Starts"
            type="datetime-local"
            min={minStart}
            value={startsAt}
            onChange={(e) => {
              const value = e.target.value;
              setStartsAt(value);
              // Suggest a two-hour show until the end has been set by hand.
              const start = fromLocalInput(value);
              if (start && (!endsAt || (fromLocalInput(endsAt)?.getTime() ?? 0) <= start.getTime())) {
                setEndsAt(toLocalInput(new Date(start.getTime() + DEFAULT_DURATION_MS)));
              }
            }}
            error={errors.startsAt}
            hint={`Local time (${localZoneName()})`}
            inputClassName="font-mono"
          />
          <Input
            id="show-ends"
            label="Ends"
            type="datetime-local"
            min={startsAt || minStart}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            error={errors.endsAt}
            inputClassName="font-mono"
          />
        </div>

        <Input
          id="show-sales"
          label="Sales open"
          optional
          type="datetime-local"
          value={salesOpenAt}
          max={startsAt || undefined}
          onChange={(e) => setSalesOpenAt(e.target.value)}
          error={errors.salesOpenAt}
          hint="Leave empty to open sales as soon as the event is published."
          inputClassName="font-mono"
          className="sm:max-w-[calc(50%-0.625rem)]"
        />

        {venue && (
          <div>
            <p className="label-mono text-text-2">Prices</p>
            <p className="mt-1 text-[13px] text-text-3">One price per seat category at {venue.name}, in rupees.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => {
                const paise = rupeesToPaise(prices[category] ?? '');
                return (
                  <Input
                    key={category}
                    id={`price-${category}`}
                    label={category}
                    prefix="₹"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={prices[category] ?? ''}
                    onChange={(e) => setPrices((p) => ({ ...p, [category]: e.target.value }))}
                    error={errors.priceFor?.[category]}
                    hint={paise !== null && paise > 0 ? formatPaise(paise) : paise === 0 ? 'Free' : undefined}
                    inputClassName="font-mono"
                  />
                );
              })}
            </div>
            {errors.prices && !errors.priceFor && <p className="mt-2 text-[13px] text-danger">{errors.prices}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
          <Action type="submit" tone="primary" busy={busy}>
            {busy ? 'Adding show…' : 'Add show'}
          </Action>
          <Action tone="ghost" onClick={onCancel}>
            Cancel
          </Action>
        </div>
      </fieldset>
    </form>
  );
}
