import { Pool, PoolClient } from 'pg';
import * as repo from './show-seats.repository';
import { NotFoundError } from '../../utils/errors';

export interface SeatMapResponse {
  show: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    bookable: boolean;
  };
  summary: {
    total: number;
    available: number;
    held: number;
    booked: number;
    unavailable: number;
  };
  sections: Array<{
    section: string;
    rows: Array<{
      row: string;
      seats: Array<{
        id: string;
        number: number;
        category: string;
        pricePaise: number;
        status: string;
      }>;
    }>;
  }>;
}

export async function getSeatMap(
  client: PoolClient | Pool,
  showId: string
): Promise<SeatMapResponse> {
  // 1. Fetch show & event metadata
  const show = await repo.getShowForSeatMap(client, showId);
  if (!show || show.event_status === 'DRAFT') {
    throw new NotFoundError('Show not found');
  }

  // 2. Compute bookable flag from the SQL booleans only (DB clock)
  const bookable =
    show.status === 'SCHEDULED' &&
    show.event_status === 'PUBLISHED' &&
    show.not_started;

  // 3. Fetch flat seat map rows
  const seatRows = await repo.listSeatMap(client, showId);

  // 4. One-pass aggregation: summary counts + hierarchical grouping (sections -> rows -> seats)
  const summary = {
    total: 0,
    available: 0,
    held: 0,
    booked: 0,
    unavailable: 0,
  };

  const sections: SeatMapResponse['sections'] = [];
  let currentSection: SeatMapResponse['sections'][0] | null = null;
  let currentRow: SeatMapResponse['sections'][0]['rows'][0] | null = null;

  for (const seat of seatRows) {
    summary.total++;
    if (seat.status === 'AVAILABLE') summary.available++;
    else if (seat.status === 'HELD') summary.held++;
    else if (seat.status === 'BOOKED') summary.booked++;
    else if (seat.status === 'UNAVAILABLE') summary.unavailable++;

    if (!currentSection || currentSection.section !== seat.section) {
      currentSection = { section: seat.section, rows: [] };
      sections.push(currentSection);
      currentRow = null;
    }

    if (!currentRow || currentRow.row !== seat.row_label) {
      currentRow = { row: seat.row_label, seats: [] };
      currentSection.rows.push(currentRow);
    }

    currentRow.seats.push({
      id: seat.id,
      number: seat.seat_number,
      category: seat.category,
      pricePaise: seat.price_paise,
      status: seat.status,
    });
  }

  return {
    show: {
      id: show.id,
      startsAt: new Date(show.starts_at).toISOString(),
      endsAt: new Date(show.ends_at).toISOString(),
      status: show.status,
      bookable,
    },
    summary,
    sections,
  };
}
