import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeNetworkOrRateLimit } from '../../components/auth/FormParts';
import { EMPTY_EVENT, EventForm, toEventInput, type EventFormErrors } from '../../components/organizer/EventForm';
import { Action, ActionLink, InlineAlert, PageHeader } from '../../components/organizer/ui';
import { ApiError, createEvent } from '../../lib/api';
import { fieldErrorsFrom } from '../../lib/auth/formErrors';
import { organizerKeys } from '../../lib/organizerQueries';
import { showToast } from '../../lib/toast';

/** /organizer/events/new: creates a DRAFT event, then opens its manage page. */
export function NewEventPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverErrors, setServerErrors] = useState<EventFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'New event · Organizer · FlashSeat';
  }, []);

  const mutation = useMutation({
    mutationFn: createEvent,
    onSuccess: async (event) => {
      await queryClient.invalidateQueries({ queryKey: organizerKeys.events });
      showToast('Draft created. Add a show, then publish.');
      navigate(`/organizer/events/${event.id}`);
    },
    onError: (error) => {
      const fields = fieldErrorsFrom(error);
      setServerErrors(fields);
      if (Object.keys(fields).length === 0) {
        const msg = error instanceof ApiError ? describeNetworkOrRateLimit(error.code, error.retryAfterSeconds) ?? error.message : 'Something went wrong.';
        setFormError(msg);
        showToast(`Couldn't create the event: ${msg}`);
      }
    },
  });

  return (
    <div className="max-w-[44rem]">
      <PageHeader crumbs={[{ label: 'Overview', to: '/organizer' }, { label: 'Events', to: '/organizer/events' }, { label: 'New event' }]} title="New event">
        <p className="mt-2 text-[14px] text-text-2">It starts as a draft: only you can see it until you publish.</p>
      </PageHeader>
      <div className="mt-8">
        <EventForm
          idPrefix="new-event"
          initial={EMPTY_EVENT}
          serverErrors={serverErrors}
          disabled={mutation.isPending}
          alert={formError ? <InlineAlert>{formError}</InlineAlert> : undefined}
          onSubmit={(values) => {
            setFormError(null);
            setServerErrors({});
            mutation.mutate(toEventInput(values));
          }}
          footer={
            <>
              <Action type="submit" tone="primary" busy={mutation.isPending}>
                {mutation.isPending ? 'Creating…' : 'Create draft'}
              </Action>
              <ActionLink to="/organizer" tone="ghost">
                Cancel
              </ActionLink>
            </>
          }
        />
      </div>
    </div>
  );
}
