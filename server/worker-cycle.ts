// One bounded deletion phase per invocation. Give fulfillment a turn first;
// a deletion backlog must not starve creative jobs, refunds or overdue archives.
export async function runWorkerCycle(
  work: (deadline: number) => Promise<boolean>,
  deletion: () => Promise<boolean>,
  now: () => number = Date.now,
) {
  const deadline = now() + 240_000;
  let processed = await work(deadline) ? 1 : 0; // every phase receives the real invocation budget
  const deletionProcessed = deadline - now() >= 190_000 && await deletion();
  while (processed < 24 && now() < deadline && await work(deadline)) processed++;
  return { processed, deletionProcessed };
}
