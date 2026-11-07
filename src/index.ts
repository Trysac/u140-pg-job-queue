/**
 * Public entry point of @trysac/pg-job-queue.
 *
 * Replace this placeholder with the utility's real API. Keep every export documented and covered by tests.
 */

/**
 * Builds a greeting for `name`.
 *
 * @param name - Who to greet. Surrounding whitespace is ignored.
 * @returns The greeting, for example `"Hello, Ada!"`.
 * @throws {TypeError} When `name` is empty after trimming.
 */
export function greet(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new TypeError("name must not be empty");
  }
  return `Hello, ${trimmed}!`;
}
