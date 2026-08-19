import type { IconName } from '$lib/icons';

export type LottieAnimationData = Record<string, unknown>;

export interface LottieAnimationDataModule {
  default: LottieAnimationData;
}

export type ReleaseHighlightAnimationLoader = () => Promise<LottieAnimationDataModule>;

export interface ReleaseHighlightAnimationLoaders {
  light: ReleaseHighlightAnimationLoader;
  dark: ReleaseHighlightAnimationLoader;
}

export interface ReleaseHighlight {
  id: string;
  titleKey: string;
  bodyKey: string;
  animation: ReleaseHighlightAnimationLoaders;
  fallbackIcon: IconName;
  requiredAnyPermission?: readonly string[];
}

export interface ReleaseTour {
  version: string;
  labelKey: string;
  highlights: readonly ReleaseHighlight[];
}

export interface ReleaseTourPresentation {
  tour: ReleaseTour;
  highlights: ReleaseHighlight[];
  source: 'automatic' | 'manual';
}
