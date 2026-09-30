import { PoolClient } from 'pg';
import * as repo from './events.repository';
import { CreateEventRequest, UpdateEventRequest, ListEventsQuery } from './events.schema';
import { NotFoundError, ForbiddenError, ConflictError } from '../../utils/errors';

export async function createEvent(client: PoolClient, organizerId: string, data: CreateEventRequest) {
  return await repo.createEvent(client, organizerId, data.title, data.description, data.category, data.posterUrl);
}

export async function updateEvent(client: PoolClient, organizerId: string, eventId: string, data: UpdateEventRequest) {
  const event = await repo.findEventById(client, eventId);
  if (!event || event.organizer_id !== organizerId) {
    throw new NotFoundError('Event not found');
  }

  // If there's nothing to update
  if (Object.keys(data).length === 0) {
    return event;
  }

  return await repo.updateEvent(client, eventId, data);
}

export async function publishEvent(client: PoolClient, organizerId: string, eventId: string) {
  const event = await repo.findEventById(client, eventId);
  if (!event || event.organizer_id !== organizerId) {
    throw new NotFoundError('Event not found');
  }

  const showCount = await repo.countShowsForEvent(client, eventId);
  if (showCount === 0) {
    throw new ConflictError('Cannot publish an event with zero shows');
  }

  await repo.updateEventStatus(client, eventId, 'PUBLISHED');
}

export async function cancelEvent(client: PoolClient, organizerId: string, eventId: string) {
  const event = await repo.findEventById(client, eventId);
  if (!event || event.organizer_id !== organizerId) {
    throw new NotFoundError('Event not found');
  }

  await repo.updateEventStatus(client, eventId, 'CANCELLED', true);
  await repo.cancelAllShowsForEvent(client, eventId);
  // Refunding any existing bookings is Phase 3 work, not here.
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
