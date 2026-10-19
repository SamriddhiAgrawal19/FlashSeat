import { PoolClient } from 'pg';
import { withTransaction } from '../../db/pool';
import * as repo from './shows.repository';
import * as eventRepo from '../events/events.repository';
import * as venueRepo from '../venues/venues.repository';
import * as showSeatsRepo from '../show-seats/show-seats.repository';
import { CreateShowRequest } from './shows.schema';
import { NotFoundError, ConflictError, ValidationError } from '../../utils/errors';

async function executeCreateShow(
  client: PoolClient,
  organizerId: string,
  eventId: string,
  data: CreateShowRequest
) {
  // 1. Verify event exists and belongs to the organizer. FOR SHARE (hierarchy
  // level 1, before the show rows below): a concurrent cancelEvent — which needs
  // FOR UPDATE on this row — cannot slip in after the status check.
  const event = await eventRepo.lockEventForShowCreate(client, eventId);
  if (!event || event.organizer_id !== organizerId) {
    throw new NotFoundError('Event not found');
  }
  if (event.status === 'CANCELLED') {
    throw new ConflictError('Event is cancelled', 'EVENT_CANCELLED');
  }

  // 2. Verify venue exists and belongs to the organizer
  const venue = await venueRepo.findVenueById(client, data.venueId);
  if (!venue || venue.owner_id !== organizerId) {
    throw new NotFoundError('Venue not found');
  }

  // Validate prices against venue layout:
  // - venue seat count must be > 0
  const venueSeatCount = await showSeatsRepo.countVenueSeats(client, data.venueId);
  if (venueSeatCount === 0) {
    throw new ValidationError('Venue has no seats. Add seats before creating a show');
  }

  // - let venueCats = categories from getVenueSeatCategories, priceCats = categories in input.categoryPrices
  const venueCats = await showSeatsRepo.getVenueSeatCategories(client, data.venueId);
  const priceCats = data.categoryPrices.map((cp) => cp.category);
  const priceCatSet = new Set(priceCats);
  const venueCatSet = new Set(venueCats);

  // - if venueCats has categories missing from priceCats -> ValidationError listing missing ones
  const missingCats = venueCats.filter((cat) => !priceCatSet.has(cat));
  if (missingCats.length > 0) {
    throw new ValidationError(`Missing price for categories: ${missingCats.join(', ')}`);
  }

  // - if priceCats has categories not present in venueCats -> ValidationError listing unknown ones
  const unknownCats = priceCats.filter((cat) => !venueCatSet.has(cat));
  if (unknownCats.length > 0) {
    throw new ValidationError(`Unknown categories in price list: ${unknownCats.join(', ')}`);
  }

  // 3. Insert the show
  const show = await repo.createShow(client, eventId, data.venueId, data.startsAt, data.endsAt, data.salesOpenAt);

  // 4. Insert category prices
  await repo.insertCategoryPrices(client, show.id, data.categoryPrices);

  // 5. Generate show seats
  const seatCount = await showSeatsRepo.generateForShow(client, show.id, data.venueId);

  // Safety net: verify generated count equals venue seat count
  if (seatCount !== venueSeatCount) {
    throw new Error(`Generated seat count (${seatCount}) does not match venue seat count (${venueSeatCount})`);
  }

  return {
    ...show,
    seatCount,
  };
}

export async function createShow(
  clientOrOrganizerId: PoolClient | string,
  organizerIdOrEventId: string,
  eventIdOrData: string | CreateShowRequest,
  maybeData?: CreateShowRequest
) {
  if (typeof clientOrOrganizerId !== 'string') {
    const client = clientOrOrganizerId;
    const organizerId = organizerIdOrEventId;
    const eventId = eventIdOrData as string;
    const data = maybeData!;
    try {
      return await executeCreateShow(client, organizerId, eventId, data);
    } catch (err: any) {
      if (err.code === '23P01') {
        throw new ConflictError('This venue is already booked for an overlapping time slot');
      }
      if (err.code === '23505') {
        throw new ValidationError('Duplicate category in prices');
      }
      throw err;
    }
  }

  const organizerId = clientOrOrganizerId;
  const eventId = organizerIdOrEventId;
  const data = eventIdOrData as CreateShowRequest;

  try {
    return await withTransaction(async (client) => {
      return await executeCreateShow(client, organizerId, eventId, data);
    });
  } catch (err: any) {
    if (err.code === '23P01') {
      throw new ConflictError('This venue is already booked for an overlapping time slot');
    }
    if (err.code === '23505') {
      throw new ValidationError('Duplicate category in prices');
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
