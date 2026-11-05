import type { EventListItem } from '../../lib/api';
import { CATEGORIES } from '../../lib/categories';
import { cn } from '../../lib/cn';
import { bySoonest } from '../../lib/eventGroups';
import { PHOTO_POOLS, type Photo } from '../../lib/photos';
import { useUpcomingEvents } from '../../lib/queries';
import { useTabVisible } from '../site/hooks';

// The tilted wall (docs/auth-page-design.html): 3 columns of 4 tiles, heights from the design.
// Each category appears twice, with two different photos from its pool, so all 12 tiles differ.
const COLUMNS: Array<{ cls: string; tiles: Array<{ category: string; height: number; badge?: boolean }> }> = [
  {
    cls: 'au-col',
    tiles: [
      { category: 'MUSIC', height: 300 },
      { category: 'THEATRE', height: 220, badge: true },
      { category: 'SPORTS', height: 260 },
      { category: 'COMEDY', height: 240 },
    ],
  },
  {
    cls: 'au-col au-down',
    tiles: [
      { category: 'FESTIVAL', height: 240 },
      { category: 'MUSIC', height: 320 },
      { category: 'WORKSHOP', height: 220 },
      { category: 'THEATRE', height: 280 },
    ],
  },
  {
    cls: 'au-col au-slow',
    tiles: [
      { category: 'COMEDY', height: 260 },
      { category: 'SPORTS', height: 220 },
      { category: 'WORKSHOP', height: 300 },
      { category: 'FESTIVAL', height: 240 },
    ],
  },
];

const FALLBACK_TICKER = CATEGORIES.map((c) => c.label.toUpperCase());

interface Tile {
  key: string;
  photo: Photo;
  caption: string;
  height: number;
  badge: boolean;
}

/**
 * Captions are "<CATEGORY> · <CITY>" using the cities of real upcoming events in that category
 * (the n-th tile of a category gets its n-th city), or just the category when there are none.
 */
function buildTiles(events: EventListItem[]): Tile[][] {
  const cities = new Map<string, string[]>();
  for (const e of [...events].sort(bySoonest)) {
    const city = e.next_show?.venue.city;
    if (!city) continue;
    const list = cities.get(e.category) ?? [];
    if (!list.includes(city)) list.push(city);
    cities.set(e.category, list);
  }
  const seen = new Map<string, number>();
  return COLUMNS.map((col, c) =>
    col.tiles.map((t, r) => {
      const n = seen.get(t.category) ?? 0;
      seen.set(t.category, n + 1);
      const pool = PHOTO_POOLS[t.category] ?? [];
      const photo = pool[(n + 1) % pool.length] ?? pool[0]!;
      const list = cities.get(t.category) ?? [];
      const city = list.length ? list[n % list.length] : null;
      return { key: `${c}-${r}`, photo, caption: city ? `${t.category} · ${city.toUpperCase()}` : t.category, height: t.height, badge: !!t.badge };
    }),
  );
}

function TileView({ tile }: { tile: Tile }) {
  return (
    <div className="au-tile" style={{ height: tile.height }}>
      <img src={tile.photo.src} width={tile.photo.width} height={tile.photo.height} alt="" decoding="async" />
      <div className="au-tile-shade" />
      <span className="au-tile-cap">{tile.caption}</span>
      {tile.badge && (
        <span className="au-badge">
          <i />
          SEAT D9 · YOURS
        </span>
      )}
    </div>
  );
}

/**
 * The left side of the auth page: the scrolling photo wall, the pitch line and the ticker of real
 * upcoming events (shared landing query). The wall and ticker are decorative (aria-hidden) and
 * pause while the browser tab is hidden.
 */
export function PhotoWall() {
  const { data, isError } = useUpcomingEvents();
  const tabVisible = useTabVisible();
  const events = data?.events ?? [];
  const columns = buildTiles(events);
  const items =
    !isError && events.length > 0
      ? [...events]
          .sort(bySoonest)
          .slice(0, 12)
          .map((e) => [e.title, e.next_show?.venue.city].filter(Boolean).join(' · ').toUpperCase())
      : FALLBACK_TICKER;

  return (
    <div className={cn('au-aside', !tabVisible && 'au-paused')}>
      <div className="au-wall" aria-hidden="true">
        {columns.map((tiles, c) => (
          <div key={c} className={COLUMNS[c]!.cls}>
            {/* Two identical copies: each column slides by 50%, so the loop is seamless. */}
            {[...tiles, ...tiles].map((tile, i) => (
              <TileView key={`${tile.key}-${i < tiles.length ? 'a' : 'b'}`} tile={tile} />
            ))}
          </div>
        ))}
      </div>
      <div className="au-scrim" aria-hidden="true" />
      <div className="au-aside-foot">
        <p className="au-pitch">
          Concerts, comedy, theatre and fests. <span style={{ color: 'var(--text-2)' }}>Pick the exact seat, every time.</span>
        </p>
        <div className="au-ticker-wrap" aria-hidden="true">
          <div className="au-ticker">
            {[...items, ...items].map((item, i) => (
              <span key={i}>{item}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
