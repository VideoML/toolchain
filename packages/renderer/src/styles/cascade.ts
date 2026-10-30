import type { VisualStyles } from "@videoml/toolchain/dsl";

/**
 * Cascaded styles include computed values after applying the cascade.
 */
export type CascadedStyles = VisualStyles & {
  /**
   * Computed opacity after multiplying all cascade levels.
   * Used internally by components for final rendering.
   */
  _computedOpacity: number;
};

/**
 * Cascade styles from scene → layer → component.
 *
 * Rules:
 * - Opacity multiplies down the cascade (scene * layer * component)
 * - Other properties override (component > layer > scene)
 *
 * @param sceneStyles - Base styles from scene level
 * @param layerStyles - Styles from layer level
 * @param componentStyles - Styles from component level
 * @returns Cascaded styles with computed opacity
 */
export function cascadeStyles(
  sceneStyles: VisualStyles = {},
  layerStyles: VisualStyles = {},
  componentStyles: VisualStyles = {}
): CascadedStyles {
  const mergedVars = {
    ...(sceneStyles.vars ?? {}),
    ...(layerStyles.vars ?? {}),
    ...(componentStyles.vars ?? {}),
  };

  // Opacity multiplies down the cascade
  const sceneOpacity = sceneStyles.opacity ?? 1;
  const layerOpacity = layerStyles.opacity ?? 1;
  const componentOpacity = componentStyles.opacity ?? 1;
  const computedOpacity = sceneOpacity * layerOpacity * componentOpacity;

  // Other properties override (last wins)
  return {
    // Scene defaults (lowest priority)
    ...sceneStyles,
    // Layer overrides scene
    ...layerStyles,
    // Component overrides all
    ...componentStyles,
    vars: mergedVars,
    // Computed opacity for rendering
    _computedOpacity: computedOpacity,
    // Keep original component opacity for reference
    opacity: componentOpacity,
  };
}
