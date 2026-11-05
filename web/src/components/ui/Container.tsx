import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** Shared content width with a 16px minimum side gutter. */
export function Container({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-content px-4 sm:px-6 lg:px-10', className)} {...rest} />;
}
