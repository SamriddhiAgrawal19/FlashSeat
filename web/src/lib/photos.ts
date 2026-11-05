// Local photos in public/images (Unsplash License; see public/images/CREDITS.md).
// width/height are the real pixel sizes, so <img> can reserve space before loading.

export interface Photo {
  src: string;
  width: number;
  height: number;
  /** Meaningful alt text; pass alt="" where a photo is purely decorative. */
  alt: string;
}

export const PHOTOS = {
  heroConcert: {
    src: '/images/hero-concert-crowd.webp',
    width: 2000,
    height: 1500,
    alt: 'A crowd with raised hands facing a stage washed in purple and white light',
  },
  music: {
    src: '/images/music-stage-lights.webp',
    width: 1600,
    height: 1067,
    alt: 'Concert crowd silhouetted against amber stage lights',
  },
  theatre: {
    src: '/images/theatre-curtain.webp',
    width: 1800,
    height: 1202,
    alt: 'A closed red velvet theatre curtain on an empty stage',
  },
  comedy: {
    src: '/images/comedy-mic.webp',
    width: 2000,
    height: 1333,
    alt: 'A lone microphone on a stand in front of a red curtain',
  },
  sports: {
    src: '/images/sports-stadium-night.webp',
    width: 1500,
    height: 2000,
    alt: 'A packed stadium under floodlights at night',
  },
  workshop: {
    src: '/images/workshop-pottery.webp',
    width: 2000,
    height: 1198,
    alt: 'Hands shaping a clay pot on a spinning potter’s wheel',
  },
  festival: {
    src: '/images/festival-night.webp',
    width: 1600,
    height: 1068,
    alt: 'An outdoor festival crowd at night under falling confetti',
  },
  emptyAuditorium: {
    src: '/images/empty-auditorium.webp',
    width: 2000,
    height: 1500,
    alt: 'Rows of empty red seats in a dimly lit auditorium',
  },
} satisfies Record<string, Photo>;

// Category value (lib/categories.ts) -> photo. Used for the category section and as
// the image for any event whose poster_url is null.
const CATEGORY_PHOTOS: Record<string, Photo> = {
  MUSIC: PHOTOS.music,
  COMEDY: PHOTOS.comedy,
  THEATRE: PHOTOS.theatre,
  SPORTS: PHOTOS.sports,
  WORKSHOP: PHOTOS.workshop,
  FESTIVAL: PHOTOS.festival,
};

/** Photo for a category value; unknown categories fall back to the festival crowd. */
export function photoForCategory(category: string): Photo {
  return CATEGORY_PHOTOS[category] ?? PHOTOS.festival;
}
