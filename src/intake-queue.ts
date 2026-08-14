/**
 * Serializes addEntry() calls across every concurrent HTTP intake surface
 * (`/api/add` in cli.ts, the SMS gateway in gateway/sms.ts). Each of those
 * does a read-modify-write on a shared JSON file (data/entries.json or
 * data/pending-review.json) with a multi-second Claude call in between, and
 * neither surface can disable its client's submit button mid-request — two
 * concurrent submissions reading the same array and both appending would
 * silently drop one. A single chain shared by every caller closes that gap;
 * splitting it per-route would not, since it's the file, not the route, that
 * two writers can race on.
 */

let queue: Promise<unknown> = Promise.resolve();

export function enqueueIntake<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
