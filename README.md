# Cabin Finder

A small web app for finding, scoring and tracking cabins for sale in the western US
(WY, ID, CO, UT, NM, NV, OR, WA, CA, AZ by default).

Defaults, all adjustable in the app:

- **Under $300k**, **5+ acres** (hard filters)
- Scored 0–100 on **acreage** (30), **waterfront** (20), **rental income** (25) and **price** (25)

## Run it

Needs Node 18+. No `npm install` needed: there are no dependencies.

```bash
cp .env.example .env      # then paste your RentCast key into .env
npm start                 # http://localhost:3000
```

Without a key the app still runs with 8 clearly marked **SAMPLE** (fictional) listings,
manual entry, and CSV import. Remove the samples with "Remove sample listings".

## Where listings come from

1. **RentCast API** (free key at <https://app.rentcast.io>). Search by state, city, ZIP, or
   click the map and search a radius. Each search uses 1 call; results are cached for 24h
   and the app stops at `RENTCAST_MONTHLY_LIMIT` (default 50, the free tier) so you are never
   billed by surprise. "Get rent estimate" on a card uses 1 more call.
2. **Manual / CSV.** Add anything you find on LandWatch, Zillow, Craigslist or a broker's site.
   CSV columns: `title, address, city, state, price, acres, bedrooms, bathrooms, sqft,
   waterfront (yes/no), nightlyRate, occupancy, rentEstimate, latitude, longitude, url,
   description, notes`.

## How scoring works

| Part | Points | How |
|---|---|---|
| Acreage | 30 | 20 for meeting the minimum, up to +10 at 4× the minimum |
| Waterfront | 20 | 20 if you confirm it, 5 if the text mentions water but it's unconfirmed |
| Rental | 25 | Net yield; 10%+ gets full points. STR: nightly × 365 × occupancy − 35% expenses. Otherwise long-term rent × 12 × 80% |
| Price | 25 | Cheaper relative to your max price scores higher |

Limits to know:

- RentCast has no "cabin" or "waterfront" field, so search returns all detached and
  manufactured homes, and waterfront starts as *unknown*. Use "Satellite ↗" to check, then
  "Edit / flag water". Your flags, notes and rates survive later searches.
- RentCast rent estimates are long-term rents. For short-term rental income, enter a
  nightly rate from comparable Airbnb/VRBO listings nearby.
- Unknown acreage is kept (and flagged) rather than hidden.

Your data is saved in `data/store.json` (git-ignored).

## Tests

```bash
npm test
```
