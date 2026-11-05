import type { ReactNode } from 'react';
import { m } from 'motion/react';
import { useReducedMotionPref } from '../../lib/motion';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Seconds; use small steps (0.06) to stagger items in a grid. */
  delay?: number;
  as?: 'div' | 'li';
}

/**
 * Section entrance: a gentle fade with a 4px rise, once, the first time content enters the
 * viewport. Never tied to scroll position. Static with reduced motion.
 */
export function Reveal({ children, className, delay = 0, as = 'div' }: RevealProps) {
  const reduced = useReducedMotionPref();
  if (reduced) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  const Tag = as === 'li' ? m.li : m.div;
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 4 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.45, ease: 'easeOut', delay }}
    >
      {children}
    </Tag>
  );
}
