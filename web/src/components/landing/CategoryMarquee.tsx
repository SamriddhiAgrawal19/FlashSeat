import { Link } from 'react-router';
import { CATEGORIES } from '../../lib/categories';
import { cn } from '../../lib/cn';
import { presetRange } from '../../lib/dateRanges';
import { PHOTOS, type Photo } from '../../lib/photos';
import { useUpcomingEvents } from '../../lib/queries';
import { usePlayWhenVisible, useReveal } from '../site/hooks';

// One photo per tile, all different: the livelier "people performing" shot from each pool.
const TILE_PHOTOS: Record<string, Photo> = {
  MUSIC: PHOTOS.musicGuitarDrums,
  COMEDY: PHOTOS.comedyStandup,
  THEATRE: PHOTOS.theatreThreeActors,
  SPORTS: PHOTOS.sportsDunk,
  WORKSHOP: PHOTOS.workshopPainting,
  FESTIVAL: PHOTOS.festivalFireworks,
};

// Where to crop each landscape photo into the portrait tile (object-position), so the people stay in frame.
const TILE_FOCUS: Record<string, string> = {
  MUSIC: '62% 50%',
  COMEDY: '70% 50%',
  THEATRE: '22% 50%',
  WORKSHOP: '30% 50%',
  FESTIVAL: '60% 50%',
};

interface Tile {
  key: string;
  name: string;
  to: string;
  photo: Photo;
  focus?: string;
  count: string | null;
}

/**
 * "3 EVENTS" per category, only when the one landing request returned every listed event
 * (total <= page size); otherwise the counts would be partial, so none are shown.
 */
function useCategoryCounts(): Record<string, number> | null {
  const { data } = useUpcomingEvents();
  if (!data || data.total > data.events.length) return null;
  const counts: Record<string, number> = {};
  for (const event of data.events) counts[event.category] = (counts[event.category] ?? 0) + 1;
  return counts;
}

function countLabel(n: number | undefined): string | null {
  if (!n) return null;
  return `${n} EVENT${n === 1 ? '' : 'S'}`;
}

function TileLink({ tile, hidden }: { tile: Tile; hidden?: boolean }) {
  return (
    <Link to={tile.to} className="lp-tile" aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined}>
      {/* Eager: tiles sit off-screen sideways until the track slides them in, and lazy loading
          would make them pop in late. Seven small images; the copies reuse the same requests. */}
      <img src={tile.photo.src} width={tile.photo.width} height={tile.photo.height} alt="" decoding="async" className="lp-img" style={tile.focus ? { objectPosition: tile.focus } : undefined} />
      <span className="lp-tile-shade" />
      <span className="lp-tile-lbl">
        <span className="lp-tile-name">{tile.name}</span>
        {tile.count && <span className="lp-tile-count">{tile.count}</span>}
      </span>
    </Link>
  );
}

export function CategoryMarquee() {
  const counts = useCategoryCounts();
  const reveal = useReveal<HTMLDivElement>();
  const { ref: playRef, playing } = usePlayWhenVisible<HTMLDivElement>();
  const weekend = new URLSearchParams(presetRange('weekend')).toString();

  const tiles: Tile[] = [
    ...CATEGORIES.map((c) => ({
      key: c.value,
      name: c.label,
      to: `/events?category=${encodeURIComponent(c.value)}`,
      photo: TILE_PHOTOS[c.value] ?? PHOTOS.heroConcert,
      focus: TILE_FOCUS[c.value],
      count: counts ? countLabel(counts[c.value]) : null,
    })),
    // The design's "NEAR YOU" label is dropped: the app has no location, so it would not be true.
    { key: 'weekend', name: 'This weekend', to: `/events?${weekend}`, photo: PHOTOS.heroHandsUp, count: null },
  ];

  return (
    <section id="categories" className="lp-browse" aria-labelledby="browse-title">
      <div ref={reveal.ref} className={reveal.className}>
        <div className="lp-wrap lp-head" style={{ marginBottom: 36 }}>
          <div className="lp-head-title">
            <span className="lp-eyebrow">BROWSE</span>
            <h2 id="browse-title" className="lp-h2">
              Find your kind of night.
            </h2>
          </div>
          <span style={{ fontSize: 14, color: 'var(--lp-muted-2)' }}>Hover to pause</span>
        </div>
        <div ref={playRef} className={cn('lp-mq-wrap', !playing && 'lp-paused')}>
          {/* Two identical copies: the track slides by -50%, so the loop is seamless. The copy is hidden from assistive tech and the tab order. */}
          <ul className="lp-mq">
            {tiles.map((tile) => (
              <li key={tile.key}>
                <TileLink tile={tile} />
              </li>
            ))}
            {tiles.map((tile) => (
              <li key={`${tile.key}-copy`} aria-hidden="true">
                <TileLink tile={tile} hidden />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
