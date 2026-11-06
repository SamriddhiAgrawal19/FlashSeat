import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeNetworkOrRateLimit } from '../../components/auth/FormParts';
import { Action, ActionLink, Arr, InlineAlert, Input, PageHeader } from '../../components/organizer/ui';
import { ApiError, createVenue } from '../../lib/api';
import { fieldErrorsFrom } from '../../lib/auth/formErrors';
import { organizerKeys } from '../../lib/organizerQueries';
import { showToast } from '../../lib/toast';

type Fields = 'name' | 'address' | 'city';

/** /organizer/venues/new: create the venue, then go straight to its seat builder. */
export function NewVenuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<Fields, string>>({ name: '', address: '', city: '' });
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'New venue · Organizer · FlashSeat';
  }, []);

  const mutation = useMutation({
    mutationFn: createVenue,
    onSuccess: async (venue) => {
      await queryClient.invalidateQueries({ queryKey: organizerKeys.venues });
      showToast(`${venue.name} created. Now lay out its seats.`);
      navigate(`/organizer/venues/${venue.id}/seats`);
    },
    onError: (error) => {
      const fields = fieldErrorsFrom(error);
      setErrors(fields);
      if (Object.keys(fields).length === 0) {
        const msg = error instanceof ApiError ? describeNetworkOrRateLimit(error.code, error.retryAfterSeconds) ?? error.message : 'Something went wrong.';
        setFormError(msg);
        showToast(`Couldn't create the venue: ${msg}`);
      }
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const body = { name: values.name.trim(), address: values.address.trim(), city: values.city.trim() };
    const next: Partial<Record<Fields, string>> = {};
    if (!body.name) next.name = 'Give the venue a name.';
    if (!body.address) next.address = 'Enter the street address.';
    if (!body.city) next.city = 'Enter the city. Attendees filter events by it.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    mutation.mutate(body);
  }

  const set = (key: Fields) => (e: ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <div className="og-view is-narrow">
      <PageHeader crumbs={[{ label: 'Venues', to: '/organizer/venues' }, { label: 'New venue' }]} title={<>New <span className="site-serif">venue</span></>} small>
        <p className="og-sub">Next you'll lay out its seats.</p>
      </PageHeader>

      <section className="og-card og-form-card" aria-label="Venue details">
        <form noValidate onSubmit={onSubmit} className="og-form">
          {formError && <InlineAlert>{formError}</InlineAlert>}
          <Input id="venue-name" label="Name" value={values.name} onChange={set('name')} error={errors.name} autoComplete="off" placeholder="e.g. Riverside Hall" />
          <Input id="venue-address" label="Address" value={values.address} onChange={set('address')} error={errors.address} autoComplete="street-address" />
          <Input
            id="venue-city"
            label="City"
            value={values.city}
            onChange={set('city')}
            error={errors.city}
            autoComplete="address-level2"
            hint="Shown on event cards and used by the city filter."
          />
          <div className="og-form-foot">
            <Action type="submit" tone="primary" busy={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : (
                <>
                  Create venue and add seats <Arr />
                </>
              )}
            </Action>
            <ActionLink to="/organizer/venues" tone="ghost">
              Cancel
            </ActionLink>
          </div>
        </form>
      </section>
    </div>
  );
}
