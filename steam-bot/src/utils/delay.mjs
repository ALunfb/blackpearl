/**
 * Returns a random integer between min and max (inclusive).
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a random duration between range.min and range.max milliseconds.
 * Returns a promise that resolves after the delay.
 */
export function randomDelay(range) {
  const ms = randomInt(range.min, range.max);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sleep for an exact number of milliseconds.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
