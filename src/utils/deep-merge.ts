/**
 * Deep merge utility for settings objects.
 * Recursively merges source into target, preserving nested defaults.
 * Arrays are replaced entirely (not merged) to allow user overrides.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T> | null | undefined
): T {
  if (!source) return { ...target };

  const result = { ...target } as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    const sourceValue = source[key as keyof typeof source];
    const targetValue = target[key as keyof T];

    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      // Recursively merge nested objects
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      // Use source value (including arrays - replace entirely)
      result[key] = sourceValue;
    }
  }

  return result as T;
}
