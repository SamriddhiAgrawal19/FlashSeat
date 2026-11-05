import type { SeatMap, ShowDetail } from '../../lib/api';
import { formatCategory, formatPaise } from '../../lib/format';
import { useSeatMap } from '../../lib/queries';

// Most expensive category first: white, then lighter-to-darker greys (docs/event-detail-design.html).
const PALETTE = ['#FAFAFA', '#A1A1AA', '#52525B', '#D4D4D8', '#71717A', '#3F3F46'];
const TAKEN = '#1F1F23';
/** Layouts wider or larger than this (or general admission) show the price list only. */
const MAX_ROW = 40;
const MAX_SEATS = 1200;

interface CategoryInfo {
  category: string;
  price: number;
  color: string;
  where: string;
}

/** "ROWS A–C", "ROW G", or the sections a category spans ("PAVILION"). */
function whereLabel(map: SeatMap | undefined, category: string): string {
  if (!map) return '';
  const spots: Array<{ section: string; row: string }> = [];
  for (const section of map.sections) {
    for (const row of section.rows) {
      if (row.seats.some((s) => s.category === category)) spots.push({ section: section.section, row: row.row });
    }
  }
  const sections = [...new Set(spots.map((s) => s.section))];
  if (spots.length === 0) return '';
  if (sections.length > 1) return sections.join(' / ');
  if (spots.length === 1) return spots[0]!.row === 'G' && map.sections.length === 1 && map.sections[0]!.rows.length === 1 ? 'GENERAL ADMISSION' : `ROW ${spots[0]!.row}`;
  return `ROWS ${spots[0]!.row}–${spots[spots.length - 1]!.row}`;
}

function drawable(map: SeatMap | undefined): map is SeatMap {
  if (!map || map.summary.total === 0 || map.summary.total > MAX_SEATS) return false;
  return map.sections.every((s) => s.rows.every((r) => r.seats.length <= MAX_ROW));
}

function MiniMap({ map, colors }: { map: SeatMap; colors: Map<string, string> }) {
  const widest = Math.max(...map.sections.flatMap((s) => s.rows.map((r) => r.seats.length)));
  return (
    <div className="ed-mini" role="img" aria-label={`Seat layout: ${map.summary.available} of ${map.summary.total} seats available`}>
      <div className="ed-mini-stage" />
      {map.sections.map((section) => (
        <div key={section.section} className="ed-mini-section">
          {map.sections.length > 1 && <span className="ed-mini-label">{section.section}</span>}
          {section.rows.map((row) => (
            <div
              key={row.row}
              className="ed-mini-row"
              // Every row uses the widest row's cell size, so seats line up and shrink together.
              style={{ gridTemplateColumns: `repeat(${row.seats.length}, minmax(0, min(10px, calc((100% - ${(widest - 1) * 3}px) / ${widest}))))` }}
            >
              {row.seats.map((seat) => (
                <span
                  key={seat.id}
                  className="ed-mini-seat"
                  style={
                    seat.status === 'AVAILABLE'
                      ? { background: colors.get(seat.category) ?? PALETTE[2], opacity: 0.85 }
                      : { background: TAKEN }
                  }
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * "Seats & prices" for one show (the next upcoming one): the mini layout from the public seat map
 * (GET /shows/:showId/seats, read once, no polling), coloured by category with taken seats dimmed,
 * and the category prices from GET /events/:eventId/shows/:showId.
 */
export function SeatsPrices({ showId, detail }: { showId: string; detail: ShowDetail | undefined }) {
  const seatMap = useSeatMap(showId, { paused: true });
  const map = seatMap.data;
  const prices = [...(detail?.category_prices ?? [])].sort((a, b) => b.price_paise - a.price_paise);
  if (!detail && !map) return null;

  const categories: CategoryInfo[] = prices.map((p, i) => ({
    category: p.category,
    price: p.price_paise,
    color: PALETTE[i % PALETTE.length]!,
    where: whereLabel(map, p.category),
  }));
  const colors = new Map(categories.map((c) => [c.category, c.color]));
  const showMap = drawable(map);

  return (
    <section className="ed-section" aria-labelledby="prices-title" style={{ gap: 18 }}>
      <h2 id="prices-title" className="site-eyebrow" style={{ margin: 0 }}>
        Seats &amp; prices
      </h2>
      <div className="ed-box">
        {showMap && <MiniMap map={map} colors={colors} />}
        {categories.length > 0 ? (
          <dl className="ed-prices" style={showMap ? undefined : { borderTop: 0, paddingTop: 0 }}>
            {categories.map((c) => (
              <div key={c.category}>
                <dt>
                  {showMap && <i style={{ background: c.color }} aria-hidden="true" />}
                  {formatCategory(c.category).toUpperCase()}
                  {c.where && ` · ${c.where}`}
                </dt>
                <dd>{formatPaise(c.price)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          detail && <p className="ed-row-note">Prices for this date aren't available yet.</p>
        )}
        {map && (
          <p className="ed-row-note" style={{ margin: 0 }}>
            {map.summary.available} of {map.summary.total} seats available for the next date.
          </p>
        )}
      </div>
    </section>
  );
}
