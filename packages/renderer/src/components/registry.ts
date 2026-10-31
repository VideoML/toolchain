import { TitleComponent } from "./TitleComponent.tsx";
import { SubtitleComponent } from "./SubtitleComponent.tsx";
import { ProgressBarComponent } from "./ProgressBarComponent.tsx";
import { RectangleComponent } from "./RectangleComponent.tsx";
import { BackgroundComponent } from "./BackgroundComponent.tsx";
import { ColorThemeDemo } from "./demo/ColorThemeDemo.js";
import { ContentLayoutDemo } from "./demo/ContentLayoutDemo.js";
import { PlaceholderPanel } from "./demo/PlaceholderPanel.js";
import { TitleSlideLayoutDemo } from "./demo/TitleSlideLayoutDemo.js";
import { TwoColumnLayoutDemo } from "./demo/TwoColumnLayoutDemo.js";
import { ActionPulseComponent } from "./demo/ActionPulseComponent.js";

// Layout components
import { TitleSlideLayout } from "./layouts/TitleSlideLayout.js";
import { TwoColumnLayout } from "./layouts/TwoColumnLayout.js";
import { GridLayout } from "./layouts/GridLayout.js";
import { SplitScreenLayout } from "./layouts/SplitScreenLayout.js";
import { ChapterHeadingLayout } from "./layouts/ChapterHeadingLayout.js";
import { QuoteCardLayout } from "./layouts/QuoteCardLayout.js";
import { FlexPageLayout } from "./layouts/FlexPageLayout.js";
import { BulletListScreenLayout } from "./layouts/BulletListScreenLayout.js";
import { ContentScreenLayout } from "./layouts/ContentScreenLayout.js";
import { TwoColumnScreenLayout } from "./layouts/TwoColumnScreenLayout.js";
import { ThreeColumnScreenLayout } from "./layouts/ThreeColumnScreenLayout.js";
import { GridScreenLayout } from "./layouts/GridScreenLayout.js";

// Motion graphics components
import { ChyronComponent } from "./motion/ChyronComponent.js";
import { LowerThirdComponent } from "./motion/LowerThirdComponent.js";
import { BulletListComponent } from "./motion/BulletListComponent.js";
import { CalloutComponent } from "./motion/CalloutComponent.js";
import { CodeBlockComponent } from "./motion/CodeBlockComponent.js";
import { IconComponent } from "./motion/IconComponent.js";
import { FontGridComponent } from "./motion/FontGridComponent.js";

// Engine demo components
import { FramerMotionDemoComponent } from "./engines/FramerMotionDemoComponent.js";
import { D3BarChartComponent } from "./engines/D3BarChartComponent.js";
import { P5ParticlesComponent } from "./engines/P5ParticlesComponent.js";
import { P5NeonFieldComponent } from "./engines/P5NeonFieldComponent.js";
import { ThreeOrbitComponent } from "./engines/ThreeOrbitComponent.js";
import { LottieBadgeComponent } from "./engines/LottieBadgeComponent.js";
import { KineticTextComponent } from "./engines/KineticTextComponent.js";
import { MixAndMatchDemoComponent } from "./engines/MixAndMatchDemoComponent.js";
import { AnimeHarnessDemoComponent } from "./engines/AnimeHarnessDemoComponent.js";
import { TextEffectsDemoComponent } from "./engines/TextEffectsDemoComponent.js";
import { GsapPrinciplesDemoComponent } from "./engines/GsapPrinciplesDemoComponent.js";
import { TypefaceColorDemoComponent } from "./engines/TypefaceColorDemoComponent.js";
import { TextEffectsComponent } from "./text/TextEffectsComponent.js";
import { CtaSlideComponent } from "./marketing/CtaSlideComponent.js";

export type ComponentType = React.ComponentType<any>;

const registry = new Map<string, ComponentType>();

// Register built-in components
registry.set("Title", TitleComponent);
registry.set("Subtitle", SubtitleComponent);
registry.set("ProgressBar", ProgressBarComponent);
registry.set("Rectangle", RectangleComponent);
registry.set("Background", BackgroundComponent);
registry.set("VideoTitle", TitleComponent);
registry.set("VideoSubtitle", SubtitleComponent);
registry.set("VideoRectangle", RectangleComponent);
registry.set("VideoBackground", BackgroundComponent);
registry.set("ColorThemeDemo", ColorThemeDemo);
registry.set("ContentLayoutDemo", ContentLayoutDemo);
registry.set("PlaceholderPanel", PlaceholderPanel);
registry.set("TitleSlideLayoutDemo", TitleSlideLayoutDemo);
registry.set("TwoColumnLayoutDemo", TwoColumnLayoutDemo);
registry.set("ActionPulse", ActionPulseComponent);

// Register layout components
registry.set("TitleSlide", TitleSlideLayout);
registry.set("TwoColumn", TwoColumnLayout);
registry.set("Grid", GridLayout);
registry.set("SplitScreen", SplitScreenLayout);
registry.set("ChapterHeading", ChapterHeadingLayout);
registry.set("QuoteCard", QuoteCardLayout);
registry.set("FlexPage", FlexPageLayout);
registry.set("BulletListScreen", BulletListScreenLayout);
registry.set("ContentScreen", ContentScreenLayout);
registry.set("TwoColumnScreen", TwoColumnScreenLayout);
registry.set("ThreeColumnScreen", ThreeColumnScreenLayout);
registry.set("GridScreen", GridScreenLayout);

// Register motion graphics components
registry.set("Chyron", ChyronComponent);
registry.set("LowerThird", LowerThirdComponent);
registry.set("BulletList", BulletListComponent);
registry.set("Callout", CalloutComponent);
registry.set("CodeBlock", CodeBlockComponent);
registry.set("Icon", IconComponent);
registry.set("FontGrid", FontGridComponent);

// Register engine demo components
registry.set("FramerMotionDemo", FramerMotionDemoComponent);
registry.set("D3BarChart", D3BarChartComponent);
registry.set("P5Particles", P5ParticlesComponent);
registry.set("P5NeonField", P5NeonFieldComponent);
registry.set("ThreeOrbit", ThreeOrbitComponent);
registry.set("LottieBadge", LottieBadgeComponent);
registry.set("KineticText", KineticTextComponent);
registry.set("MixAndMatchDemo", MixAndMatchDemoComponent);
registry.set("AnimeHarnessDemo", AnimeHarnessDemoComponent);
registry.set("TextEffectsDemo", TextEffectsDemoComponent);
registry.set("GsapPrinciplesDemo", GsapPrinciplesDemoComponent);
registry.set("TypefaceColorDemo", TypefaceColorDemoComponent);
registry.set("TextEffects", TextEffectsComponent);
registry.set("CtaSlide", CtaSlideComponent);

export function registerComponent(name: string, component: ComponentType): void {
  registry.set(name, component);
}

export function getComponent(name: string | ComponentType): ComponentType | null {
  if (typeof name === "function") {
    return name; // Already a React component
  }

  const result = registry.get(name);

  if (!result) {
    const keys = Array.from(registry.keys());
    console.error(`[Registry] Component "${name}" not found. Available:`, keys);
  }

  return result || null;
}

export function listComponents(): string[] {
  return Array.from(registry.keys());
}

/** Remove only the exact component installed by a controlled portable host. */
export function unregisterComponentIfSame(name: string, component: ComponentType): void {
  if (registry.get(name) === component) registry.delete(name);
}
