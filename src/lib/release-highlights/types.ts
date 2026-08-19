import type { IconName } from '$lib/icons';

export interface ReleaseHighlight {
  id: string;
  titleKey: string;
  bodyKey: string;
  animationSrc: string;
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
