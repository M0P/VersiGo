import type { ReactElement } from 'react';
export default function CallbackPage(): ReactElement {
  // Der eigentliche OIDC-Callback wird serverseitig durch apps/api verarbeitet
  // (/auth/callback setzt das Session-Cookie und leitet auf "/" um). Diese
  // Seite dient nur als Fallback-Ziel, falls direkt aufgerufen.
  return (
    <main>
      <p>Anmeldung wird verarbeitet...</p>
    </main>
  );
}
