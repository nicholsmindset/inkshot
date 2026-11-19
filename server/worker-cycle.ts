// One bounded deletion phase per invocation. Always give ordinary work a turn
// first; a backlog of deletion requests must not starve creative jobs/refunds.
export async function runWorkerCycle(
  work: (deadline: number) => Promise<boolean>,
  deletion: () => Promise<boolean>,
  now: () => number = Date.now,
) {
  const deadline = now() + 240_000;
  let processed = await work(now()) ? 1 : 0; // zero archive budget on this first pass
  const deletionProcessed = deadline - now() >= 190_000 && await deletion();
  while (processed < 24 && now() < deadline && await work(deadline)) processed++;
  return { processed, deletionProcessed };
}
