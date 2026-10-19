import { z } from 'zod';

/**
 * uuid input schema shared by every module that takes uuids from clients.
 *
 * Postgres returns uuid columns lowercase. Normalizing input to lowercase here
 * (before dedupe, comparison and sorting) keeps every in-memory uuid comparison
 * — idempotent-replay seat-set equality in particular — correct regardless of the
 * casing the client sends.
 */
export const uuidParam = (message = 'Invalid UUID') =>
  z.string().uuid(message).transform((value) => value.toLowerCase());
