import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { domAnimation, LazyMotion } from 'motion/react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useParams } from 'react-router';
import { Layout } from './components/layout/Layout';
import { GuestOnly } from './components/routing/GuestOnly';
import { RequireAuth } from './components/routing/RequireAuth';
import { RequireRole } from './components/routing/RequireRole';
import { AuthProvider } from './lib/auth/AuthProvider';
import { BookingPage } from './pages/BookingPage';
import { ComingSoon } from './pages/ComingSoon';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventsPage } from './pages/EventsPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { PayPage } from './pages/PayPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReservationPage } from './pages/ReservationPage';
import { SeatMapPage } from './pages/SeatMapPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

/** The old checkout placeholder: checkout now starts from the hold page. */
function CheckoutRedirect() {
  const { reservationId = '' } = useParams();
  return <Navigate to={`/reservations/${reservationId}`} replace />;
}

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
          { path: 'events', element: <EventsPage /> },
          { path: 'events/:eventId', element: <EventDetailPage /> },
          {
            path: 'shows/:showId',
            element: (
              <RequireAuth>
                <SeatMapPage />
              </RequireAuth>
            ),
          },
          {
            path: 'reservations/:reservationId',
            element: (
              <RequireAuth>
                <ReservationPage />
              </RequireAuth>
            ),
          },
          { path: 'checkout/:reservationId', element: <CheckoutRedirect /> },
          {
            path: 'pay/:bookingId',
            element: (
              <RequireAuth>
                <PayPage />
              </RequireAuth>
            ),
          },
          {
            path: 'bookings/:bookingId',
            element: (
              <RequireAuth>
                <BookingPage />
              </RequireAuth>
            ),
          },
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
                <MyBookingsPage />
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
