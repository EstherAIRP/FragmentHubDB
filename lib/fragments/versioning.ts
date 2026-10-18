/**
 * Monotonic updated_at values are essential for optimistic concurrency.
 * Strings are stored in ISO format; the new value must be later than every
 * version being replaced even when operations happen in the same millisecond.
 */
export function nextUpdatedAt(
  previous: readonly string[],
  now: number = Date.now(),
): string {
  if (!Number.isFinite(now)) {
    throw new Error("Invalid current time for updated_at.");
  }
  let timestamp = now;
  for (const value of previous) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new Error("Invalid previous updated_at.");
    }
    if (parsed >= timestamp) timestamp = parsed + 1;
  }
  return new Date(timestamp).toISOString();
}
