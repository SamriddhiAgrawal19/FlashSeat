import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { domAnimation, LazyMotion } from 'motion/react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { Layout } from './components/layout/Layout';
import { GuestOnly } from './components/routing/GuestOnly';
import { RequireAuth } from './components/routing/RequireAuth';
import { RequireRole } from './components/routing/RequireRole';
import { AuthProvider } from './lib/auth/AuthProvider';
import { ComingSoon } from './pages/ComingSoon';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

/** The session lives inside the router so it can redirect (expired session -> /login?next=...). */
function AuthRoot() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <AuthRoot />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <LandingPage /> },
          { path: 'events', element: <ComingSoon title="Events" /> },
          { path: 'events/:eventId', element: <ComingSoon title="Event details" /> },
          {
            path: 'login',
            element: (
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            ),
          },
          {
            path: 'register',
            element: (
              <GuestOnly>
                <RegisterPage />
              </GuestOnly>
            ),
          },
          {
            path: 'organizer',
            element: (
              <RequireAuth>
                <RequireRole role="ORGANIZER">
                  <ComingSoon title="Organizer dashboard" />
                </RequireRole>
              </RequireAuth>
            ),
          },
          {
            path: 'bookings',
            element: (
              <RequireAuth>
                <ComingSoon title="My bookings" />
              </RequireAuth>
            ),
          },
          {
            path: '*',
            element: (
              <ComingSoon
                title="Not found"
                heading="Page not found"
                message="That page doesn't exist. It may have moved, or the link may be wrong."
              />
            ),
          },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Only the animation features the page uses (no drag/layout), to keep the bundle small. */}
      <LazyMotion features={domAnimation} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>
  );
}
