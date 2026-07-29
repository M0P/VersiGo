import type { ReactElement } from 'react';
import type { ReactNode } from 'react';

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({
  children,
}: RootLayoutProps): ReactElement {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
