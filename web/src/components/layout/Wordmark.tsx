import { Link } from 'react-router';
import { cn } from '../../lib/cn';

/** The small lime dot that ends the wordmark. */
export function WordmarkDot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-[0.22em] rounded-full bg-lime', className)} />;
}

/** "FlashSeat" + lime dot; links home. */
export function Wordmark({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <Link
      to="/"
      onClick={onClick}
      className={cn('inline-flex items-baseline gap-[0.12em] rounded-[2px] text-lg font-semibold tracking-[-0.04em] text-text', className)}
    >
      FlashSeat
      <WordmarkDot />
    </Link>
  );
}
