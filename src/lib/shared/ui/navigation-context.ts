/** Application navigation supplied by the shell to shared UI. */
export const NAVIGATION_CONTEXT = Symbol('cfms.navigation');

export interface NavigationContext {
  navigateUp: (pathname: string) => void | Promise<void>;
}
