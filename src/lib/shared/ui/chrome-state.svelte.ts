
class ChromeStoreImpl {
  snackbarStackHeight = $state(0);

  setSnackbarStackHeight(height: number) {
    this.snackbarStackHeight = Math.max(0, Math.round(height));
  }
}

export const chromeStore = new ChromeStoreImpl();
