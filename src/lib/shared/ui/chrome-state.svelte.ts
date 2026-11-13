
class ChromeStoreImpl {
  snackbarStackHeight = $state(0);
  snackbarBottomInset = $state(0);

  setSnackbarBottomInset(inset: number) {
    this.snackbarBottomInset = Math.max(0, Math.ceil(inset));
  }

  setSnackbarStackHeight(height: number) {
    this.snackbarStackHeight = Math.max(0, Math.round(height));
  }
}

export const chromeStore = new ChromeStoreImpl();
