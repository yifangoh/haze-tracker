# Haze Tracker SG

A small installable web app (PWA) showing Singapore's PSI by region, with an alert when haze reaches a level you choose.

- **24-hour PSI**: NEA's official figure, from the real-time PSI dataset.
- **1-hour PSI (est.)**: NEA publishes hourly PM2.5, not an hourly PSI, so this is the PM2.5 sub-index worked out from the hourly reading with NEA's PM2.5 breakpoints.
- **Alerts**: pick a region, which reading to watch and a PSI level. You're notified when the reading reaches that level, and again only after it has dropped back below and risen again.

Data: [data.gov.sg](https://data.gov.sg) (`/v2/real-time/api/psi` and `/pm25`), Singapore Open Data Licence. Not an official NEA app.

## Run / host

Plain static files, no build step. Service workers and notifications need HTTPS (or `localhost`), so host it on GitHub Pages, Netlify, Vercel etc. For a local try-out: `python3 -m http.server` and open `http://localhost:8000`.

On a phone, open the hosted URL, then Install / Add to Home Screen (Android Chrome: install prompt or menu; iPhone Safari: Share, then Add to Home Screen).

## Notification limits

The app has no server, so alerts are checked from the phone itself:

- While the app is open, it re-checks every 10 minutes.
- Android Chrome with the app installed may also check in the background (Periodic Background Sync), when the browser allows it.
- iPhone only supports notifications for apps added to the Home Screen (iOS 16.4+) and has no background checks, so alerts arrive while the app is open. Reliable alerts when the app is closed would need a small push server.

## Files

`index.html`, `styles.css`, `app.js` (UI), `core.js` (API, PSI maths, alert rules; shared with the service worker), `sw.js` (offline cache, background check), `manifest.webmanifest`, `icons/`.
