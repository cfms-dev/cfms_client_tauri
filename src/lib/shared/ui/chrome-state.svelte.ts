
import { untrack } from 'svelte';

class ChromeStoreImpl {
  snackbarStackHeight = $state(0);
  snackbarBottomInset = $state(0);
  openModalCount = $state(0);

  get hasOpenModal() {
    return this.openModalCount > 0;
  }

  setSnackbarBottomInset(inset: number) {
    this.snackbarBottomInset = Math.max(0, Math.ceil(inset));
  }

  setSnackbarStackHeight(height: number) {
    this.snackbarStackHeight = Math.max(0, Math.round(height));
  }

  registerModal(): () => void {
    untrack(() => {
      this.openModalCount += 1;
    });
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      untrack(() => {
        this.openModalCount = Math.max(0, this.openModalCount - 1);
      });
    };
  }
}

export const chromeStore = new ChromeStoreImpl();
