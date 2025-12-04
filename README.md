# Building Control Scrapers

Two scrapers for UK building control data.

## Setup

```bash
# Task 1
cd task1
npm install
npx playwright install chromium

# Task 2
cd task2
npm install
```

## Tasks

| Task | Target | Tool | Bonus |
|------|--------|------|-------|
| **Task 1** | Edinburgh Council | Playwright | Geometry extraction |
| **Task 2** | West Northamptonshire | Got + Cheerio | - |

## Run

```bash
# Task 1 (requires UK VPN)
cd task1 && npm run scrape

# Task 2
cd task2 && npm run scrape:wnc
```

See each task's README for details.
