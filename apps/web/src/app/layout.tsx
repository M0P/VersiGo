import type { ReactNode } from 'react';

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({
  children,
}: RootLayoutProps): JSX.Element {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
