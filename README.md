# OCCPL Logistics website

The public website of **OCCPL Logistics Pvt. Ltd.** (pro.occpllogistics.com), redesigned in the same look as the
OCCPL staff app (crimson gradient, indigo accent, Outfit font), with **live tracking** from the OCCPL courier platform.

## Pages
Home · About · Services · Track (with **Scan to track**) · Branches · Customer Tools (volumetric weight, conversion
factors, rate enquiry) · Pickup Request · Business Opportunities · Careers · Contact · FAQ · Prohibited Items ·
Terms & Conditions · Privacy Policy · 404. Content comes from the old WordPress site.

## How tracking works
The Track page calls the courier platform's **public** endpoints (no login, no keys):

| Action | Endpoint |
|---|---|
| Track | `GET /api/v1/track/{number}` (AWB or shipment number) |
| See full details / proof of delivery | `POST /api/v1/track/{number}/verify` `{ "phoneLast4": "1234" }` (receiver's mobile) |
| Raise a complaint | `POST /api/v1/track/{number}/tickets` `{ phoneLast4, subject, message }` (opens a ticket in the staff app) |

The browser calls `/api/v1/track/...` on the website's own domain; nginx forwards only that path to the backend
(`nginx.conf.template`), so the backend needs no CORS change. To call the backend directly instead, set `apiBase` in
`assets/js/config.js` and add the website's domain to the backend's allowed CORS origins.

**Scan to track** opens the phone or laptop camera and reads the barcode / QR on the receipt or label. It uses the
browser's built-in barcode reader; browsers without one (e.g. iPhone Safari) load a ZXing-based reader from
cdn.jsdelivr.net the first time Scan is used. The camera needs HTTPS (or localhost).

Enquiry forms (rate, pickup, contact, partners, careers) open the visitor's email app addressed to
info@occpllogistics.com; the website stores nothing.

## Develop
```bash
node build.mjs          # src/layout.html + src/pages/*.html -> dist/ (clean URLs), sitemap.xml, robots.txt
node serve.mjs          # http://localhost:8080, tracking forwarded to COURIER_API (default the dev backend)
```
No dependencies. Edit pages in `src/pages/` (the first line is the page's title and description), styles in
`assets/css/site.css`, behaviour in `assets/js/site.js`.

## Deploy
```bash
docker build -t occpl-website --build-arg SITE_URL=https://pro.occpllogistics.com .
docker run -p 80:80 -e COURIER_API=https://<courier backend> -e COURIER_API_HOST=<courier backend host> occpl-website
```
Old WordPress addresses (`/about-us/`, `/contact-us/`, `/track-your-order/`, `/branch-locator/`, …) redirect to the
new pages.

### Dev server (pro.occpllogistics.com)
`deploy/docker-compose.yml` runs this site as its own Compose project (`occpl-website`) beside the courier platform and
publishes no ports. `deploy/pro-occpllogistics.caddy` is the platform Caddy's site block; add it only once the DNS A
record points at the server, and run `caddy validate` before reloading.

## SEO
The build adds canonical links, social tags, robots rules, the sitemap and JSON-LD (breadcrumbs, FAQ, services).
Change the domain with `SITE_URL`. 404 is `noindex`.

## Credits
India map outline: [svg-maps](https://github.com/VictorCazanave/svg-maps) by Victor Cazanave, CC BY 4.0.
Font: Outfit, SIL Open Font License (`assets/fonts/OFL.txt`).
