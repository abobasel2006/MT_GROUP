# MT GROUP — Security boundary review (test branch)

Date: 2026-11-06
Branch: security/no-auth-boundary-review-2026-11

## Scope and safety
- Review only. No Firebase production data, rules, or production root page was changed.
- This branch contains documentation only; it does not change the running driver app.
- The test copy at `test/index.html` still contains placeholder Firebase configuration and stops before initialization while placeholders remain.
- Test-copy blob reviewed: `968cd604b0a5202288868028b4a3d281d47f9c7f`.

## Findings
1. **Critical — driver identity is not authenticated.** `driverLogin()` reads the selected driver object from the HTML select, stores it in `localStorage`, and opens the dashboard. This identifies a selected name, not the person operating the device.
2. **High — client-side session data is mutable.** `mt_current_driver` can be edited or replaced in browser storage. Code checks against this value are useful for ordinary workflow correctness, not an authorization boundary.
3. **High — broad data exposure.** The driver app subscribes to `cars` and `settings/hourlyRate`, then reads the current driver's weekly record and notes. Actual reach is determined by the deployed Realtime Database rules.
4. **High — direct client writes.** The driver client writes `activeShifts`, `weeklyRecords`, and `notes` directly to Realtime Database. Without authenticated identity, rules cannot prove that the caller is the named driver.
5. **Medium — client validation is bypassable.** Input validation and transaction guards reduce mistakes and races in the normal app, but a caller can issue database requests without using the UI.

## Confirmed code paths in the reviewed test copy
- Login: `driverLogin()`, stores `mt_current_driver` in localStorage.
- Reads: `settings/hourlyRate`, `cars`, `activeShifts/{carId}`, `weeklyRecords/{week}/{driver}`, `notes/{driver}`.
- Writes: transaction on `activeShifts/{carId}`; multi-location update to `weeklyRecords`; push to `notes/{driver}`.
- Inline JavaScript syntax check: passed (1 inline script block).

## What can be improved without changing the login experience
- Keep the existing UI flow and harden DOM rendering, input validation, numeric/date bounds, error handling, and duplicate-submit handling.
- Keep the existing transactions and idempotency protections for shifts and advances; continue testing race conditions.
- Add client-side audit context and clear error reporting, while treating all client-provided identity fields as untrusted.
- App Check may reduce unauthorized automated traffic from outside the app, but it does **not** identify a driver or grant per-driver authorization.
- Backend functions without a verified caller identity do not solve the driver-impersonation problem. A shared secret embedded in browser code is not secret.

## Hard boundary
With the current name-selection-only login unchanged, Firebase cannot securely distinguish one driver from another. Therefore no Realtime Database rule can safely grant each driver private write permissions based only on `currentDriver.name` or localStorage. Strong per-driver authorization requires a trusted identity proof (which would change the security model, even if the visible screen remains similar).

## Production rules warning
The owner-provided Firebase Console screenshot showed root-level `.read` and `.write` conditions based only on a time limit ending 2026-11-29. While active, these conditions permit unauthenticated reads and writes. After expiry, reads and writes may stop for everyone. This review intentionally did not publish or change rules.

## Next safe work
1. Keep production rules untouched until a separate test Firebase project is configured.
2. Test all read/write paths against that isolated project or the Firebase Emulator.
3. Prepare candidate validation rules only for the test environment, clearly documenting that they cannot provide role isolation without authentication.
4. Do not claim production authorization is fixed while the login remains unauthenticated.
