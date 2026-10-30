import { PoolClient } from 'pg';
import * as repo from './events.repository';
import { CreateEventRequest, UpdateEventRequest, ListEventsQuery } from './events.schema';
import { NotFoundError, ConflictError } from '../../utils/errors';

export async function createEvent(client: PoolClient, organizerId: string, data: CreateEventRequest) {
  return await repo.createEvent(client, organizerId, data.title, data.description, data.category, data.posterUrl);
}

export async function updateEvent(client: PoolClient, organizerId: string, eventId: string, data: UpdateEventRequest) {
  // FOR UPDATE (hierarchy level 1): the CANCELLED check below must not race cancelEvent.
  const event = await repo.findEventForUpdate(client, eventId);
  if (!event || event.organizer_id !== organizerId) {
    throw new NotFoundError('Event not found');
  }
  if (event.status === 'CANCELLED') {
    throw new ConflictError('Event is cancelled', 'EVENT_CANCELLED');
  }

  // If there's nothing to update
  if (Object.keys(data).length === 0) {
    return event;
  }

  return await repo.updateEvent(client, eventId, data);
}

export async function publishEvent(client: PoolClient, organizerId: string, eventId: string) {
  // FOR UPDATE (hierarchy level 1): a concurrent cancelEvent cannot interleave
  // between the state check and the status write.
  const event = await repo.findEventForUpdate(client, eventId);
  if (!event || event.organizer_id !== organizerId) {
    throw new NotFoundError('Event not found');
  }

  // One-way state machine: only DRAFT can be published, so a CANCELLED event can
  // never be resurrected.
  if (event.status !== 'DRAFT') {
    throw new ConflictError('Only DRAFT events can be published', 'EVENT_NOT_DRAFT');
  }

  const showCount = await repo.countShowsForEvent(client, eventId);
  if (showCount === 0) {
    throw new ConflictError('Cannot publish an event with zero shows');
  }

  await repo.updateEventStatus(client, eventId, 'PUBLISHED');
}

export async function cancelEvent(client: PoolClient, organizerId: string, eventId: string) {
  // Lock hierarchy: event -> shows -> reservations -> bookings -> show_seats
  // (each level locked ORDER BY id ASC). Set-based statements only — no per-row loops.
  // Refund payouts are Phase 3 work; this only closes the sales pipeline.
  const event = await repo.lockEventForCancel(client, eventId, organizerId);
  if (!event) {
    throw new NotFoundError('Event not found');
  }
  if (event.status === 'CANCELLED') {
    return; // terminal and idempotent: a second cancel changes nothing
  }

  // 2. shows
  await repo.lockShowsForEvent(client, eventId);
  await repo.cancelShowsForEvent(client, eventId);

  // 3-5. lock everything under the shows, id-ascending per level
  await repo.lockActiveReservationsForEvent(client, eventId);
  await repo.lockBookingsToCloseForEvent(client, eventId);
  await repo.lockHeldSeatsForEvent(client, eventId);

  // 6. close the pipeline
  await repo.releaseHeldSeatsForEvent(client, eventId);
  await repo.releaseActiveReservationsForEvent(client, eventId);
  await repo.cancelPendingBookingsForEvent(client, eventId);
  // CONFIRMED bookings keep their BOOKED seats and live tickets: the Phase 3
  // refund worker releases them after the refund is paid out.
  await repo.markConfirmedBookingsRefundPendingForEvent(client, eventId);

  // 7. event
  await repo.updateEventStatus(client, eventId, 'CANCELLED', true);
}

export async function listPublicEvents(client: PoolClient, query: ListEventsQuery) {
  const offset = (query.page - 1) * query.limit;
  const result = await repo.searchPublishedEvents(client, query, query.limit, offset);
  
  return {
    events: result.events,
    page: query.page,
    limit: query.limit,
    total: result.total
  };
}

export async function getPublicEventDetails(client: PoolClient, eventId: string) {
  const event = await repo.findEventById(client, eventId);
  
  if (!event || event.status === 'DRAFT') {
    throw new NotFoundError('Event not found');
  }

  const shows = await repo.findShowsForEvent(client, eventId);
  
  return {
    ...event,
    shows
  };
}

export async function getMyEvents(client: PoolClient, organizerId: string) {
  return await repo.findEventsByOrganizer(client, organizerId);
}
