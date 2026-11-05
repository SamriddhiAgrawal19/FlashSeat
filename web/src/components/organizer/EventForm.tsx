import { useState, type FormEvent, type ReactNode } from 'react';
import type { EventInput } from '../../lib/api';
import { CATEGORIES } from '../../lib/categories';
import { Input, Select, Textarea } from './ui';

export interface EventFormValues {
  title: string;
  category: string;
  description: string;
  posterUrl: string;
}

export type EventFormErrors = Partial<Record<keyof EventFormValues, string>>;

export const EMPTY_EVENT: EventFormValues = { title: '', category: '', description: '', posterUrl: '' };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Client checks. `hadPoster`: the API can replace a poster URL but not clear it. */
export function validateEvent(values: EventFormValues, { hadPoster = false } = {}): EventFormErrors {
  const errors: EventFormErrors = {};
  if (!values.title.trim()) errors.title = 'Give the event a title.';
  if (!values.category) errors.category = 'Choose a category.';
  const poster = values.posterUrl.trim();
  if (poster && !isHttpUrl(poster)) errors.posterUrl = 'Use a full http:// or https:// link to an image.';
  if (!poster && hadPoster) errors.posterUrl = "A poster can be replaced but not removed. Paste a new link, or keep the current one.";
  return errors;
}

/** Form values -> API body. Empty optional fields are left out. */
export function toEventInput(values: EventFormValues): EventInput {
  const body: EventInput = { title: values.title.trim(), category: values.category, description: values.description.trim() };
  const poster = values.posterUrl.trim();
  if (poster) body.posterUrl = poster;
  return body;
}

interface Props {
  idPrefix: string;
  initial: EventFormValues;
  serverErrors: EventFormErrors;
  hadPoster?: boolean;
  disabled: boolean;
  onSubmit: (values: EventFormValues) => void;
  /** Submit / cancel buttons. */
  footer: ReactNode;
  alert?: ReactNode;
}

export function EventForm({ idPrefix, initial, serverErrors, hadPoster = false, disabled, onSubmit, footer, alert }: Props) {
  const [values, setValues] = useState<EventFormValues>(initial);
  const [errors, setErrors] = useState<EventFormErrors>({});
  const shown = { ...serverErrors, ...errors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = validateEvent(values, { hadPoster });
    setErrors(next);
    if (Object.keys(next).length === 0) onSubmit(values);
  }

  const set = <K extends keyof EventFormValues>(key: K, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  return (
    <form noValidate onSubmit={submit}>
      <fieldset disabled={disabled} className="space-y-5">
        {alert}
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_13rem]">
          <Input id={`${idPrefix}-title`} label="Title" value={values.title} onChange={(e) => set('title', e.target.value)} error={shown.title} autoComplete="off" />
          <Select id={`${idPrefix}-category`} label="Category" value={values.category} onChange={(e) => set('category', e.target.value)} error={shown.category}>
            <option value="" disabled>
              Choose…
            </option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
            {values.category && !CATEGORIES.some((c) => c.value === values.category) && <option value={values.category}>{values.category}</option>}
          </Select>
        </div>
        <Textarea
          id={`${idPrefix}-description`}
          label="Description"
          optional
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          error={shown.description}
          hint="Shown on the public event page."
        />
        <Input
          id={`${idPrefix}-poster`}
          label="Poster URL"
          optional={!hadPoster}
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={values.posterUrl}
          onChange={(e) => set('posterUrl', e.target.value)}
          error={shown.posterUrl}
          hint="A link to a landscape image. Without one, the event uses a category photo."
          inputClassName="font-mono text-[13px]"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-5">{footer}</div>
      </fieldset>
    </form>
  );
}
