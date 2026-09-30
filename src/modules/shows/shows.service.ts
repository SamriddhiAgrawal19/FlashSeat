import { PoolClient } from 'pg';
import * as repo from './shows.repository';
import * as eventRepo from '../events/events.repository';
import * as venueRepo from '../venues/venues.repository';
import { CreateShowRequest } from './shows.schema';
import { NotFoundError, ConflictError } from '../../utils/errors';

export async function createShow(client: PoolClient, organizerId: string, eventId: string, data: CreateShowRequest) {
  // 1. Verify event exists and belongs to the organizer
  const event = await eventRepo.findEventById(client, eventId);
  if (!event || event.organizer_id !== organizerId) {
    throw new NotFoundError('Event not found');
  }

  // 2. Verify venue exists and belongs to the organizer
  const venue = await venueRepo.findVenueById(client, data.venueId);
  if (!venue || venue.owner_id !== organizerId) {
    throw new NotFoundError('Venue not found');
  }

  try {
    // 3. Insert the show
    const show = await repo.createShow(client, eventId, data.venueId, data.startsAt, data.endsAt, data.salesOpenAt);

    // 4. Insert category prices
    await repo.insertCategoryPrices(client, show.id, data.categoryPrices);

    return show;
  } catch (err: any) {
    // 23P01 is the PostgreSQL error code for exclusion_violation
    if (err.code === '23P01') {
      throw new ConflictError('This venue is already booked for an overlapping time slot');
    }
    throw err;
  }
}

export async function getShowDetails(client: PoolClient, showId: string) {
  const show = await repo.findShowById(client, showId);
  if (!show) {
    throw new NotFoundError('Show not found');
  }
  return show;
}
