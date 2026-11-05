// Local photos in public/images (Unsplash or Pexels License; see public/images/CREDITS.md).
// width/height are the real pixel sizes, so <img> can reserve space before loading.

export interface Photo {
  src: string;
  width: number;
  height: number;
  /** Meaningful alt text; pass alt="" where a photo is purely decorative. */
  alt: string;
}

const photo = (file: string, width: number, height: number, alt: string): Photo => ({
  src: `/images/${file}.webp`,
  width,
  height,
  alt,
});

export const PHOTOS = {
  // Crowds / hero
  heroConcert: photo('hero-concert-crowd', 2000, 1500, 'A crowd with raised hands facing a stage washed in purple and white light'),
  heroHandsUp: photo('hero-hands-up-purple', 2000, 1333, 'Raised hands silhouetted against purple and amber stage lights'),
  heroTealStage: photo('hero-crowd-teal-stage', 2000, 1335, 'A cheering crowd in front of a stage glowing teal through haze'),
  // Music
  music: photo('music-stage-lights', 1600, 1067, 'Concert crowd silhouetted against amber stage lights'),
  musicGuitarDrums: photo('music-guitar-and-drums', 2000, 1333, 'A smiling guitarist plays a white electric guitar in front of a drummer'),
  musicSingerRed: photo('music-singer-red-silhouette', 1333, 2000, 'A singer silhouetted against red stage haze, microphone raised'),
  // Comedy
  comedy: photo('comedy-mic', 2000, 1333, 'A lone microphone on a stand in front of a red curtain'),
  comedyStandup: photo('comedy-standup-striped-shirt', 2000, 1335, 'A comedian in a striped shirt on stage, holding the mic'),
  comedySpotlight: photo('comedy-spotlight-performer', 2000, 1334, 'A performer with a microphone under a single spotlight, the audience in the dark'),
  // Theatre
  theatre: photo('theatre-curtain', 1800, 1202, 'A closed red velvet theatre curtain on an empty stage'),
  theatreCostumeCast: photo('theatre-period-costume-cast', 2000, 1330, 'Actors in colourful period costumes on a dim, blue-lit stage'),
  theatreThreeActors: photo('theatre-three-actors', 2000, 1333, 'Three actors in Victorian costume on a candlelit black stage'),
  // Sports
  sports: photo('sports-stadium-night', 1500, 2000, 'A packed stadium under floodlights at night'),
  sportsDunk: photo('sports-basketball-dusk-dunk', 1333, 2000, 'A basketball player dunking against a pink dusk sky'),
  sportsSunsetCourt: photo('sports-sunset-court', 1333, 2000, 'A player silhouetted mid-jump at a hoop by the sea at sunset'),
  // Workshops
  workshop: photo('workshop-pottery', 2000, 1198, 'Hands shaping a clay pot on a spinning potter’s wheel'),
  workshopPainting: photo('workshop-painting-class', 2000, 1333, 'An instructor and a student painting at an easel'),
  workshopPotteryStudio: photo('workshop-pottery-studio', 2000, 1333, 'A woman shaping a clay pot at a wooden studio table'),
  // Fests
  festival: photo('festival-night', 1600, 1068, 'An outdoor festival crowd at night under falling confetti'),
  festivalFireworks: photo('festival-fireworks-phones', 2000, 1333, 'A festival crowd filming fireworks with their phones'),
  festivalRedStage: photo('festival-red-fireworks-stage', 2000, 1333, 'Red fireworks shoot up beside a festival stage over the crowd'),
  // Empty states
  emptyAuditorium: photo('empty-auditorium', 2000, 1500, 'Rows of empty red seats in a dimly lit auditorium'),
} satisfies Record<string, Photo>;

/**
 * Photos per category value (lib/categories.ts). Any event without a poster_url gets one of
 * these. The first entry is the category's "cover" (used where one photo stands for the category).
 */
/** A pool always has at least one photo. */
export type PhotoPool = readonly [Photo, ...Photo[]];

export const PHOTO_POOLS: Record<string, PhotoPool> = {
  MUSIC: [PHOTOS.music, PHOTOS.musicGuitarDrums, PHOTOS.musicSingerRed],
  COMEDY: [PHOTOS.comedy, PHOTOS.comedyStandup, PHOTOS.comedySpotlight],
  THEATRE: [PHOTOS.theatre, PHOTOS.theatreCostumeCast, PHOTOS.theatreThreeActors],
  SPORTS: [PHOTOS.sports, PHOTOS.sportsDunk, PHOTOS.sportsSunsetCourt],
  WORKSHOP: [PHOTOS.workshop, PHOTOS.workshopPainting, PHOTOS.workshopPotteryStudio],
  FESTIVAL: [PHOTOS.festival, PHOTOS.festivalFireworks, PHOTOS.festivalRedStage],
};

/** Crowd shots: the pool for unknown categories. */
export const CROWD_POOL: PhotoPool = [PHOTOS.heroConcert, PHOTOS.heroHandsUp, PHOTOS.heroTealStage];

function poolFor(category: string): PhotoPool {
  return PHOTO_POOLS[category] ?? CROWD_POOL;
}

/** pool[i], wrapping around. */
function at(pool: PhotoPool, i: number): Photo {
  return pool[i % pool.length] ?? pool[0];
}

/** FNV-1a: a small, stable string hash, so the same id always lands on the same photo. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The category's cover photo; unknown categories fall back to a crowd shot. */
export function photoForCategory(category: string): Photo {
  return poolFor(category)[0];
}

/**
 * A photo for an event without a poster: picked from its category pool by the event id, so the
 * same event always gets the same photo and different events spread across the pool.
 */
export function photoForEvent(event: { id: string; category: string }): Photo {
  return at(poolFor(event.category), hash(event.id));
}

/**
 * photoForEvent for a whole list, nudged so a photo never repeats within `spacing` neighbours
 * (3 for a row of cards, 2 for a two-column grid where the item above is i - 2). Only an event
 * that would clash moves to the next photo in its pool, so most keep their photoForEvent pick.
 */
export function photosForEvents(events: Array<{ id: string; category: string }>, spacing = 2): Photo[] {
  const picked: Photo[] = [];
  for (const event of events) {
    const pool = poolFor(event.category);
    const start = hash(event.id) % pool.length;
    const recent = picked.slice(-spacing);
    let choice = at(pool, start);
    for (let step = 0; step < pool.length; step++) {
      const candidate = at(pool, start + step);
      if (!recent.includes(candidate)) {
        choice = candidate;
        break;
      }
    }
    picked.push(choice);
  }
  return picked;
}
