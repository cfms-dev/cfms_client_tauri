import { getSetting, setSetting } from "$lib/api/settings";

class DisclaimerStoreImpl {
  accepted = $state(false);
  checked = $state(false);

  /** Check whether the user has accepted the disclaimer. */
  async init() {
    try {
      const val = await getSetting('disclaimer_accepted');
      this.accepted = val === 'true';
    } catch {
      this.accepted = false;
    }
    this.checked = true;
  }

  /** Persist the accept action and update state. */
  async accept() {
    await setSetting('disclaimer_accepted', 'true');
    this.accepted = true;
  }
}

export const disclaimerStore = new DisclaimerStoreImpl();
