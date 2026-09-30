import { PoolClient } from 'pg';
import * as repo from './venues.repository';
import { CreateVenueRequest, BulkSeatsRequest } from './venues.schema';
import { NotFoundError } from '../../utils/errors';

export async function createVenue(client: PoolClient, ownerId: string, data: CreateVenueRequest) {
  return await repo.createVenue(client, ownerId, data.name, data.address, data.city);
}

export async function bulkInsertSeats(client: PoolClient, ownerId: string, venueId: string, data: BulkSeatsRequest) {
  // Check ownership
  const venue = await repo.findVenueById(client, venueId);
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

  await repo.insertBulkSeats(client, venueId, seatsToInsert);
}

export async function getMyVenues(client: PoolClient, ownerId: string) {
  return await repo.findVenuesByOwnerId(client, ownerId);
}
