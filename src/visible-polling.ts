type PollingEnvironment = {
  visible: () => boolean;
  onVisibility: (listener: () => void) => () => void;
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
};

// One request at a time, paused in background tabs. Progress can restart this
// scheduler so active work is responsive without repeatedly fetching full history.
export function startVisiblePolling(
  poll: () => Promise<void>,
  environment: PollingEnvironment = {
    visible: () => document.visibilityState === "visible",
    onVisibility: listener => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: timer => clearTimeout(timer),
  },
) {
  let stopped = false;
  let inFlight = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) environment.cancel(timer); timer = undefined; };
  const schedule = (delay: number) => {
    clear();
    if (!stopped && !inFlight && environment.visible()) timer = environment.schedule(() => { void run(); }, delay);
  };
  async function run() {
    timer = undefined;
    if (stopped || inFlight || !environment.visible()) return;
    inFlight = true;
    try { await poll(); }
    catch { /* The consumer owns error presentation; a later poll can recover. */ }
    finally {
      inFlight = false;
      attempts++;
      schedule(Math.min(15_000, 2_000 * 2 ** Math.min(attempts, 3)));
    }
  }
  const unsubscribe = environment.onVisibility(() => {
    clear();
    if (environment.visible()) { attempts = 0; schedule(0); }
  });
  schedule(2_000);
  return () => { stopped = true; clear(); unsubscribe(); };
}
