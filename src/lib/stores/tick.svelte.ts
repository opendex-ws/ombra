let now = $state(Date.now());

let intervalId: ReturnType<typeof setInterval> | null = null;

function startTick() {
  if (intervalId !== null) return;
  now = Date.now();
  intervalId = setInterval(() => { now = Date.now(); }, 1000);
}

function stopTick() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

if (typeof window !== 'undefined') {
  const sync = () => {
    if (document.visibilityState === 'hidden') stopTick();
    else startTick();
  };
  document.addEventListener('visibilitychange', sync);
  sync();
}

export function getNow(): number {
  return now;
}
