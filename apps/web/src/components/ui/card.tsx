import type { ReactElement, ReactNode, HTMLAttributes } from 'react';

type CardProps = {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>;

/**
 * Reusable card/surface component.
 */
export function Card({ children, className = '', ...props }: CardProps): ReactElement {
  return (
    <div className={`card ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

type CardHeaderProps = {
  children: ReactNode;
  className?: string;
};

export function CardHeader({ children, className = '' }: CardHeaderProps): ReactElement {
  return <div className={`card-header ${className}`.trim()}>{children}</div>;
}

type CardFooterProps = {
  children: ReactNode;
  className?: string;
};

export function CardFooter({ children, className = '' }: CardFooterProps): ReactElement {
  return <div className={`card-footer ${className}`.trim()}>{children}</div>;
}
