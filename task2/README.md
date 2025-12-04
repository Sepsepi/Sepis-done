# Task 2: WNC Building Control Scraper

Scrapes building control data from West Northamptonshire Council using [Got](https://www.npmjs.com/package/got).

**Target**: https://wnc.planning-register.co.uk/BuildingControl/Display/FP/2025/0159

## Setup

```bash
npm install
```

## Usage

```bash
npm run scrape:wnc                      # default reference
npm run scrape:wnc -- FP/2025/0159      # custom reference
npm run scrape:wnc -- --verbose         # verbose logging
npm run scrape:wnc -- --help            # help
```

## Custom Searches

Works with **any** reference from the portal (format: `TYPE/YEAR/NUMBER`):
```bash
npm run scrape:wnc -- FP/2024/0001
npm run scrape:wnc -- BN/2025/0050
```
Returns `"isValid": false` if record doesn't exist (no crash).

## Output

Saves to `output/wnc-{reference}.json`:

```json
{
  "metadata": {
    "reference": "FP/2025/0159",
    "scrapedAt": "2025-12-04T15:34:09.481Z",
    "sourceUrl": "...",
    "scraperVersion": "1.0.0",
    "validation": { "isValid": true, "errors": [] }
  },
  "mainDetails": {
    "referenceNumber": "FP/2025/0159",
    "applicationType": "Full Plans",
    "status": "Ongoing",
    "parish": "Cogenhoe & Whiston Parish Council",
    "siteAddress": "Land South of Station Road Cogenhoe",
    "descriptionOfWorks": "New build development of 2 no 4 bed detached dwellings...",
    "receivedDate": "07/07/2025",
    "validDate": "23/07/2025",
    "decision": "Approval (Conditional)",
    "decisionDate": "23/09/2025",
    "commencementDate": "28/11/2025",
    "completionDate": null
  },
  "applicationTypeInfo": {
    "type": "Full Plans",
    "description": "Full plans submission where approval and completion certificates may be available",
    "certificatesAvailable": true
  },
  "plots": [
    { "plotNumber": "Plot 1", "plotStatus": "Work Commenced", "commencementDate": "28/11/2025" },
    { "plotNumber": "Plot 2", "plotStatus": "Work Pending" }
  ],
  "siteHistory": [...],
  "contactInfo": { "email": "buildingcontrol@westnorthants.gov.uk" }
}
```

## How It Works

1. **Disclaimer Handling**: Site requires accepting a disclaimer. Scraper POSTs to `/Disclaimer/Accept?returnUrl=...` then follows redirect.

2. **HTML Parsing**: WNC uses non-standard format:
   ```html
   <td class="halfwidth">Label <br/> <div><span>Value</span></div></td>
   ```
   Extracts span as value, derives label from remaining text.

3. **Data Extraction**: Pulls from all 3 tabs - Main Details, Plots, Site History.

## Improvements Made

| Feature | Description |
|---------|-------------|
| **Error Handling** | Custom `ScraperError` class with codes: `DISCLAIMER_FAILED`, `FETCH_FAILED`, `SCRAPE_FAILED` |
| **Data Validation** | Validates reference format, checks data presence, returns validation status |
| **Text Cleaning** | Removes newlines, normalizes whitespace in addresses/descriptions |
| **Application Context** | Adds metadata explaining application types (Full Plans, Building Notice, etc.) |
| **Retry Logic** | Auto-retries on HTTP 408, 429, 500, 502, 503, 504 |
| **CLI Options** | `--verbose` for detailed logging, `--help` for usage |
| **Exit Codes** | Returns 0 on success, 1 on validation failure or error |

## Dependencies

- `got` - HTTP client
- `cheerio` - HTML parsing
- `tough-cookie` - Cookie handling for disclaimer
