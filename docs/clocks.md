# Clocks

Two clocks are in play. The split is deliberate:

- **Access token `exp`** is checked against the **app server clock** by design: access
  tokens are stateless and short lived (`JWT_ACCESS_EXPIRY`), so verifying them must not
  require a database round trip. All API servers therefore **must run NTP** and stay
  within a few seconds of each other (`jwt.verify` accepts `clockTolerance: 5`).
- **Every other expiry/availability decision uses the DB clock** (`now()`):
  refresh-token expiry (`expires_at = now() + make_interval(...)` at creation,
  `expires_at <= now()` at verification), reservation hold expiry and lazy seat
  availability (`held_until < now()`), `is_active_valid`, show `starts_at` / `sales_open_at`
  checks, and the seat map's `not_started` flag. Never `Date.now()`/`new Date()` for these.

This keeps multi-instance deployments correct without clock-agreement requirements on the
booking path: any node evaluating a hold or a refresh token gets the same answer.
