import { PoolClient } from 'pg';
import * as repo from './venues.repository';
import { CreateVenueRequest, BulkSeatsRequest } from './venues.schema';
import { env } from '../../config/env';
import { ConflictError, NotFoundError } from '../../utils/errors';

export async function createVenue(client: PoolClient, ownerId: string, data: CreateVenueRequest) {
  return await repo.createVenue(client, ownerId, data.name, data.address, data.city);
}

export async function bulkInsertSeats(client: PoolClient, ownerId: string, venueId: string, data: BulkSeatsRequest) {
  // Lock the venue row, then check ownership. The lock serializes concurrent bulk
  // calls on this venue, so the seat-count check below cannot be raced.
  const venue = await repo.lockVenueForUpdate(client, venueId);
  if (!venue || venue.owner_id !== ownerId) {
    // If venue doesn't exist or doesn't belong to the user, return 404.
    // This prevents leaking existence of other organizers' venues.
    throw new NotFoundError('Venue not found');
  }

  const seatsToInsert = [];

  if (data.mode === 'GRID') {
    for (const rowLabel of data.rows) {
      for (let seatNumber = 1; seatNumber <= data.seatsPerRow; seatNumber++) {
        seatsToInsert.push({
          section: data.section,
          rowLabel,
          seatNumber,
          category: data.category,
        });
      }
    }
  } else if (data.mode === 'GENERAL_ADMISSION') {
    for (let seatNumber = 1; seatNumber <= data.count; seatNumber++) {
      seatsToInsert.push({
        section: data.section,
        rowLabel: 'G',
        seatNumber,
        category: data.category,
      });
    }
  }

  const existing = await repo.countVenueSeats(client, venueId);
  if (existing + seatsToInsert.length > env.MAX_SEATS_PER_VENUE) {
    throw new ConflictError(
      `A venue may have at most ${env.MAX_SEATS_PER_VENUE} seats (it has ${existing}, this call adds ${seatsToInsert.length})`,
      'VENUE_SEAT_LIMIT',
      { existing, requested: seatsToInsert.length, max: env.MAX_SEATS_PER_VENUE }
    );
  }

  // At most MAX_SEATS_PER_BULK_CALL seats (5 params each), far below pg's 65,535
  // bind-parameter limit, so one multi-row INSERT is enough.
  try {
    await repo.insertBulkSeats(client, venueId, seatsToInsert);
  } catch (err: any) {
    if (err.code === '23505' && err.constraint === 'venue_seats_venue_id_section_row_label_seat_number_key') {
      throw new ConflictError('Some of these seats already exist in this venue', 'SEATS_ALREADY_EXIST');
    }
    throw err;
  }
}

export async function getMyVenues(client: PoolClient, ownerId: string) {
  return await repo.findVenuesByOwnerId(client, ownerId);
}
