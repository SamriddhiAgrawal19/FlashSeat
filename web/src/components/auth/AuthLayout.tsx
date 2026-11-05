import type { ReactNode } from 'react';
import type { Photo } from '../../lib/photos';
import { Accent, Eyebrow } from '../ui/Section';

interface AuthLayoutProps {
  photo: Photo;
  eyebrow: string;
  /** First headline line. */
  title: string;
  /** Second line; `accent` is set in the serif italic. */
  accent: string;
  rest?: string;
  children: ReactNode;
}

/** Split auth screen: a tall photo on the left (desktop), the form column on the right. */
export function AuthLayout({ photo, eyebrow, title, accent, rest = '', children }: AuthLayoutProps) {
  return (
    <section aria-labelledby="auth-title" className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="relative hidden lg:block">
        <img
          src={photo.src}
          width={photo.width}
          height={photo.height}
          alt=""
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
        {/* One top fade so the fixed navbar stays readable over the photo. */}
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-bg/70 via-transparent to-transparent to-30%" />
      </div>

      <div className="flex items-center px-4 pt-28 pb-16 sm:px-6 lg:px-16 lg:pt-24 xl:px-24">
        <div className="w-full max-w-[28rem]">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 id="auth-title" className="mt-4 text-section font-medium text-text">
            {title}
            <br />
            <Accent>{accent}</Accent>
            {rest}
          </h1>
          <div className="mt-10">{children}</div>
        </div>
      </div>
    </section>
  );
}
