export function createIngressSequencer({ process, maxQueue = 256, onDrop = () => null } = {}) {
  if (typeof process !== 'function') throw new TypeError('process must be a function');
  const queue = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const item = queue.shift();
      try {
        item.resolve(await process(item.value));
      } catch (error) {
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
      if (queue.length >= maxQueue) {
        return Promise.resolve(onDrop(value, queue.length));
      }
      return new Promise((resolve) => {
        queue.push({ value, resolve });
        drain();
      });
    },
    get pending() {
      return queue.length;
    },
    get busy() {
      return running;
    }
  };
}
