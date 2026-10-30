import type { SemanticMarkup } from "@videoml/toolchain/dsl";

/**
 * Cascaded markup includes merged values after applying the cascade.
 */
export type CascadedMarkup = SemanticMarkup;

/**
 * Cascade semantic markup from scene → layer → component.
 *
 * Rules:
 * - Properties merge (shallow merge)
 * - Component properties override layer properties
 * - Layer properties override scene properties
 * - Deep merging for nested objects (one level deep)
 *
 * @param sceneMarkup - Base markup from scene level
 * @param layerMarkup - Markup from layer level
 * @param componentMarkup - Markup from component level
 * @returns Cascaded markup with merged properties
 */
export function cascadeMarkup(
  sceneMarkup: SemanticMarkup = {},
  layerMarkup: SemanticMarkup = {},
  componentMarkup: SemanticMarkup = {}
): CascadedMarkup {
  // Merge all levels (shallow merge with deep merge for nested objects)
  const merged: SemanticMarkup = {};

  // Helper to merge values
  const mergeValue = (target: SemanticMarkup, source: SemanticMarkup) => {
    for (const key in source) {
      const sourceValue = source[key];
      const targetValue = target[key];

      // If both are objects (not arrays), merge them
      if (
        typeof sourceValue === "object" &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === "object" &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        target[key] = { ...targetValue, ...sourceValue };
      } else {
        // Otherwise, override
        target[key] = sourceValue;
      }
    }
  };

  // Apply cascade: scene → layer → component
  mergeValue(merged, sceneMarkup);
  mergeValue(merged, layerMarkup);
  mergeValue(merged, componentMarkup);

  return merged;
}
