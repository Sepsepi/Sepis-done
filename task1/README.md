# Task 1: Edinburgh Building Control Scraper

Scrapes building warrant data from Edinburgh Council using [Playwright](https://www.npmjs.com/package/playwright).

**Target**: https://citydev-portal.edinburgh.gov.uk/idoxpa-web/scottishBuildingWarrantDetails.do?keyVal=T1A67ZEWK0T00

**Note**: This site is geo-blocked - requires UK IP/VPN to access.

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm run scrape                        # default keyVal
npm run scrape -- T1A67ZEWK0T00       # custom keyVal
npm run scrape -- --verbose           # verbose logging
```

## Custom Searches

Works with **any** keyVal from the portal. Find keyVals by searching at the portal, then:
```bash
npm run scrape -- YOUR_KEYVAL_HERE
```
Returns empty data if record doesn't exist (no crash).

## Output

Saves to `output/edinburgh-{keyVal}.json`:

```json
{
  "metadata": {
    "keyVal": "T1A67ZEWK0T00",
    "scrapedAt": "2025-12-04T16:08:42.047Z",
    "sourceUrl": "...",
    "scraperVersion": "1.0.0"
  },
  "summary": {
    "descriptionOfWorks": "Attic conversion and dormer extension to create new bedroom and ensuite",
    "siteAddress": "62 Rosebery Avenue Queensferry South Queensferry EH30 9JQ",
    "applicationReferenceNumber": "25/02273/WARR",
    "applicationValidDate": "Tue 16 Sep 2025",
    "decisionDate": "Tue 02 Dec 2025",
    "status": "Granted Warrant",
    "applicationType": "Domestic Existing Building - Alteration",
    "receivedDate": "Tue 16 Sep 2025",
    "decision": "Granted Warrant"
  },
  "details": {
    "alternativeReference": "500761807-001",
    "agentName": "Grant Allan Architecture",
    "agentAddress": "FAO: Grant Allan 21 Bruce Road Crossgates KY4 8AZ",
    "applicantsName": "Mr Jamie Wilson",
    "valueOfWork": "£50,000.00",
    "warrantExpiryDate": "02 Dec 2028",
    "verifiersName": "The City Of Edinburgh Council",
    "caseOfficer": "Euan Crombie",
    "conditionscontinuingRequirements": "No Continuing Requirement",
    "dischargesState": "Discharged"
  },
  "dates": {...},
  "plots": [{...}],
  "certificates": {
    "design": [{...}],
    "construction": null,
    "energy": null,
    "completion": null
  },
  "relatedItems": {
    "properties": [{...}],
    "planningApplications": [{...}]
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-3.3906, 55.9856], ...]],
    "centroid": [-3.3907, 55.9856],
    "spatialReference": { "wkid": 4326 },
    "source": "ArcGIS FeatureServer/2"
  }
}
```

## How It Works

1. **Browser Automation**: Uses Playwright to navigate the Idox portal (handles JavaScript-rendered content)

2. **Tab Navigation**: Scrapes each tab sequentially:
   - Summary - basic application info
   - Details - agent, applicant, financial data
   - Plots - individual plot status
   - Dates - timeline
   - Certificates (4 types) - design, construction, energy, completion
   - Related Items - linked properties and planning applications

3. **HTML Parsing**: Edinburgh uses `<th>/<td>` pairs in table rows. Extracts key-value pairs and normalizes to camelCase.

4. **Geometry Extraction (Bonus)**: Directly queries Edinburgh's ArcGIS FeatureServer API (`edinburgh.idoxmaps.com`) to fetch polygon boundaries in WGS84 coordinates. Returns building footprint with centroid.

## Data Extracted

| Section | Fields |
|---------|--------|
| Summary | 9 fields - description, address, reference, dates, status, type |
| Details | 13 fields - agent, applicant, value (£), expiry, officer, conditions |
| Dates | 3 fields - received, valid, decision dates |
| Plots | Status, certificates received |
| Certificates | Design/construction/energy/completion certs with certifier info |
| Related | Linked properties and planning applications |
| Geometry | Polygon boundary coordinates + centroid (WGS84/EPSG:4326) |

## Dependencies

- `playwright` - Browser automation
