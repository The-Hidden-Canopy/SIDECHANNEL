export function createIngressSequencer({ process, maxQueue = 256, onDrop = () => null, clock = () => Date.now() } = {}) {
  if (typeof process !== 'function') throw new TypeError('process must be a function');
  const queue = [];
  const windowStartMs = clock();
  let framesReceived = 0;
  let framesAdmitted = 0;
  let framesRejected = 0;
  let framesDroppedBackpressure = 0;
  let maxDepth = 0;
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const item = queue.shift();
      try {
        const result = await process(item.value);
        if (result?.ok) framesAdmitted += 1;
        else framesRejected += 1;
        item.resolve(result);
      } catch (error) {
        framesRejected += 1;
        item.resolve({
          ok: false,
          diagnostic: {
            type: 'observation.rejected',
            id: item.value?.id || 'unknown',
            reasons: [{ id: 'ingress.process', message: error.message }]
          }
        });
      }
    }
    running = false;
  }

  return {
    enqueue(value) {
      framesReceived += 1;
      if (queue.length >= maxQueue) {
        framesDroppedBackpressure += 1;
        return Promise.resolve(onDrop(value, queue.length));
      }
      return new Promise((resolve) => {
        queue.push({ value, resolve });
        maxDepth = Math.max(maxDepth, queue.length);
        drain();
      });
    },
    get pending() {
      return queue.length;
    },
    get busy() {
      return running;
    },
    receipt() {
      return {
        providerId: 'core:observation-ingress',
        windowStartMs,
        windowEndMs: clock(),
        framesReceived,
        framesAdmitted,
        framesRejected,
        framesDroppedBackpressure,
        maxDepth,
        pending: queue.length,
        busy: running
      };
    }
  };
}
