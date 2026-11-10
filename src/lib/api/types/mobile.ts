

export interface AndroidPasskeyAvailability {
  available: boolean;
  webViewWebAuthn: boolean;
}

export interface AndroidPasskeyRegistration {
  id: string;
  registrationResponseJson: string;
}

export interface AndroidPasskeyAssertion {
  id: string;
  authenticationResponseJson: string;
}
