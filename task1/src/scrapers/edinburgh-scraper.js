/**
 * Edinburgh Building Control Scraper
 * Uses Playwright to scrape building warrant data from Edinburgh Council's Idox portal
 *
 * Target: https://citydev-portal.edinburgh.gov.uk/idoxpa-web/scottishBuildingWarrantDetails.do
 */

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG = {
  baseUrl: 'https://citydev-portal.edinburgh.gov.uk/idoxpa-web',
  timeout: 30000,
};

// Tab URLs for navigation
const TABS = {
  summary: 'summary',
  details: 'details',
  plots: 'plots',
  dates: 'dates',
  designCertificate: 'designCertificate',
  constructCertificate: 'constructCertificate',
  energyCertificate: 'energyCertificate',
  completionCertificate: 'completionCertificate',
  relatedCases: 'relatedCases',
  map: 'map',
};

/**
 * Builds the URL for a specific tab
 */
function buildUrl(keyVal, tab = 'summary') {
  return `${CONFIG.baseUrl}/scottishBuildingWarrantDetails.do?keyVal=${keyVal}&activeTab=${tab}`;
}

/**
 * Cleans text by normalizing whitespace
 */
function cleanText(text) {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned === '-' || cleaned === '' ? null : cleaned;
}

/**
 * Parses a table with th/td or td/td structure
 */
async function parseTable(page, selector) {
  return await page.evaluate((sel) => {
    const data = {};
    const table = document.querySelector(sel);
    if (!table) return data;

    const rows = table.querySelectorAll('tbody tr, tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      if (cells.length >= 2) {
        let key = cells[0].textContent.trim().replace(/:$/, '');
        let value = cells[cells.length - 1].textContent.trim();

        // Normalize key to camelCase
        key = key.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
          .trim();

        if (key && value && value !== '-') {
          data[key] = value;
        }
      }
    });
    return data;
  }, selector);
}

/**
 * Scrapes the Summary tab
 */
async function scrapeSummary(page, keyVal) {
  await page.goto(buildUrl(keyVal, TABS.summary), { waitUntil: 'networkidle', timeout: CONFIG.timeout });

  // Wait for content to load
  await page.waitForSelector('th', { timeout: 10000 }).catch(() => {});

  // Parse all tables on the page
  const data = await page.evaluate(() => {
    const result = {};
    const rows = document.querySelectorAll('tr');

    rows.forEach(row => {
      const th = row.querySelector('th');
      const td = row.querySelector('td');

      if (th && td) {
        let key = th.textContent.trim().replace(/:$/, '');
        let value = td.textContent.trim();

        // Normalize key to camelCase
        key = key.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
          .trim();

        if (key && value && value !== '-' && value !== '') {
          result[key] = value;
        }
      }
    });

    return result;
  });

  return data;
}

/**
 * Scrapes the Further Information (Details) tab
 */
async function scrapeDetails(page, keyVal) {
  await page.goto(buildUrl(keyVal, TABS.details), { waitUntil: 'networkidle', timeout: CONFIG.timeout });
  await page.waitForSelector('th', { timeout: 10000 }).catch(() => {});

  const data = await page.evaluate(() => {
    const result = {};
    const rows = document.querySelectorAll('tr');

    rows.forEach(row => {
      const th = row.querySelector('th');
      const td = row.querySelector('td');

      if (th && td) {
        let key = th.textContent.trim().replace(/:$/, '');
        let value = td.textContent.trim();

        key = key.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
          .trim();

        if (key && value && value !== '-' && value !== '') {
          result[key] = value;
        }
      }
    });

    return result;
  });

  return data;
}

/**
 * Scrapes the Plots tab
 */
async function scrapePlots(page, keyVal) {
  await page.goto(buildUrl(keyVal, TABS.plots), { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
  await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});

  const plots = await page.evaluate(() => {
    const results = [];
    const tables = document.querySelectorAll('table');

    tables.forEach(table => {
      const caption = table.querySelector('caption');
      if (caption && caption.textContent.toLowerCase().includes('plot')) {
        const rows = table.querySelectorAll('tbody tr, tr');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const plot = {};
            const headers = table.querySelectorAll('th');
            cells.forEach((cell, idx) => {
              let key = headers[idx]?.textContent.trim() || `field${idx}`;
              key = key.toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
                .trim();
              const value = cell.textContent.trim();
              if (value && value !== '-') {
                plot[key] = value;
              }
            });
            if (Object.keys(plot).length > 0) {
              results.push(plot);
            }
          }
        });
      }
    });

    // If no table found, try parsing key-value pairs
    if (results.length === 0) {
      const plot = {};
      document.querySelectorAll('table tr').forEach(row => {
        const cells = row.querySelectorAll('th, td');
        if (cells.length >= 2) {
          let key = cells[0].textContent.trim().replace(/:$/, '');
          let value = cells[cells.length - 1].textContent.trim();
          key = key.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
            .trim();
          if (key && value && value !== '-') {
            plot[key] = value;
          }
        }
      });
      if (Object.keys(plot).length > 0) {
        results.push(plot);
      }
    }

    return results;
  });

  return plots;
}

/**
 * Scrapes the Important Dates tab
 */
async function scrapeDates(page, keyVal) {
  await page.goto(buildUrl(keyVal, TABS.dates), { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
  await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});

  return await parseTable(page, 'table');
}

/**
 * Scrapes certificate tabs
 */
async function scrapeCertificates(page, keyVal, certType) {
  await page.goto(buildUrl(keyVal, certType), { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });

  const certificates = await page.evaluate(() => {
    const results = [];
    const content = document.body.textContent;

    // Check if no certificates
    if (content.includes('There are no') || content.includes('No certificates')) {
      return results;
    }

    // Find certificate sections
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
      const cert = {};
      const rows = table.querySelectorAll('tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        if (cells.length >= 2) {
          let key = cells[0].textContent.trim().replace(/:$/, '');
          let value = cells[cells.length - 1].textContent.trim();
          key = key.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
            .trim();
          if (key && value && value !== '-') {
            cert[key] = value;
          }
        }
      });
      if (Object.keys(cert).length > 0) {
        results.push(cert);
      }
    });

    return results;
  });

  return certificates;
}

/**
 * Scrapes the Related Items tab
 */
async function scrapeRelatedItems(page, keyVal) {
  await page.goto(buildUrl(keyVal, TABS.relatedCases), { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });

  const related = await page.evaluate(() => {
    const result = {
      properties: [],
      planningApplications: [],
      buildingWarrants: [],
    };

    // Find property links
    document.querySelectorAll('a[href*="propertyDetails"]').forEach(link => {
      result.properties.push({
        address: link.textContent.trim(),
        url: link.href,
      });
    });

    // Find planning application links
    document.querySelectorAll('a[href*="Planning"]').forEach(link => {
      result.planningApplications.push({
        reference: link.textContent.trim(),
        url: link.href,
      });
    });

    return result;
  });

  return related;
}

/**
 * Fetches geometry data directly from Edinburgh's ArcGIS FeatureServer
 * Uses FeatureServer/2 (polygons) which contains building warrant boundaries
 */
async function scrapeGeometry(page, keyVal) {
  try {
    // Direct API call to ArcGIS FeatureServer for polygon geometry
    const featureServerUrl = `https://edinburgh.idoxmaps.com/server/rest/services/PALIVE/LIVEUniformPA_Building_Standards/FeatureServer/2/query?f=json&outSR=4326&spatialRel=esriSpatialRelIntersects&where=ISPAVISIBLE%20%3D%201%20and%20KEYVAL%20IN%20(%27${keyVal}%27)&outFields=*&returnGeometry=true`;

    const result = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.features && data.features.length > 0) {
          const feature = data.features[0];
          // Convert ESRI geometry to GeoJSON format
          if (feature.geometry && feature.geometry.rings) {
            return {
              type: 'Polygon',
              coordinates: feature.geometry.rings,
              // Include centroid for convenience
              centroid: calculateCentroid(feature.geometry.rings[0]),
              spatialReference: data.spatialReference,
              source: 'ArcGIS FeatureServer/2'
            };
          }
        }
        return null;

        function calculateCentroid(ring) {
          if (!ring || ring.length === 0) return null;
          let sumX = 0, sumY = 0;
          for (const [x, y] of ring) {
            sumX += x;
            sumY += y;
          }
          return [sumX / ring.length, sumY / ring.length];
        }
      } catch (e) {
        return null;
      }
    }, featureServerUrl);

    return result;
  } catch (e) {
    // Geometry extraction is optional
    return null;
  }
}

/**
 * Main scraper function
 */
async function scrapeEdinburghBuildingControl(keyVal, options = {}) {
  const { verbose = false, headless = true } = options;
  const log = (msg) => verbose && console.log(msg);

  log(`\nScraping Edinburgh Building Control: ${keyVal}`);
  log('='.repeat(50));

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // Scrape each tab
    log('Scraping Summary tab...');
    const summary = await scrapeSummary(page, keyVal);

    log('Scraping Details tab...');
    const details = await scrapeDetails(page, keyVal);

    log('Scraping Plots tab...');
    const plots = await scrapePlots(page, keyVal);

    log('Scraping Dates tab...');
    const dates = await scrapeDates(page, keyVal);

    log('Scraping Certificates...');
    const designCerts = await scrapeCertificates(page, keyVal, TABS.designCertificate);
    const constructionCerts = await scrapeCertificates(page, keyVal, TABS.constructCertificate);
    const energyCerts = await scrapeCertificates(page, keyVal, TABS.energyCertificate);
    const completionCerts = await scrapeCertificates(page, keyVal, TABS.completionCertificate);

    log('Scraping Related Items...');
    const related = await scrapeRelatedItems(page, keyVal);

    log('Attempting to scrape Geometry (bonus)...');
    const geometry = await scrapeGeometry(page, keyVal);

    // Build result object
    const result = {
      metadata: {
        keyVal,
        scrapedAt: new Date().toISOString(),
        sourceUrl: buildUrl(keyVal, 'summary'),
        scraperVersion: '1.0.0',
      },
      summary: Object.keys(summary).length > 0 ? summary : null,
      details: Object.keys(details).length > 0 ? details : null,
      dates: Object.keys(dates).length > 0 ? dates : null,
      plots: plots.length > 0 ? plots : null,
      certificates: {
        design: designCerts.length > 0 ? designCerts : null,
        construction: constructionCerts.length > 0 ? constructionCerts : null,
        energy: energyCerts.length > 0 ? energyCerts : null,
        completion: completionCerts.length > 0 ? completionCerts : null,
      },
      relatedItems: related,
      geometry: geometry,
    };

    // Log summary
    log('\nExtracted Data Summary:');
    log(`- Summary: ${Object.keys(summary).length} fields`);
    log(`- Details: ${Object.keys(details).length} fields`);
    log(`- Plots: ${plots.length} records`);
    log(`- Design Certificates: ${designCerts.length}`);
    log(`- Geometry: ${geometry ? 'YES' : 'NO'}`);

    return result;

  } finally {
    await browser.close();
  }
}

/**
 * Saves data to JSON file
 */
async function saveToJson(data, filename) {
  const outputDir = join(__dirname, '../../output');
  await mkdir(outputDir, { recursive: true });

  const filepath = join(outputDir, filename);
  await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');

  return filepath;
}

/**
 * CLI argument parser
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    keyVal: 'T1A67ZEWK0T00',
    verbose: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (!arg.startsWith('-')) {
      options.keyVal = arg;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Edinburgh Building Control Scraper

Usage: node edinburgh-scraper.js [keyVal] [options]

Arguments:
  keyVal       Application key value (default: T1A67ZEWK0T00)

Options:
  -v, --verbose    Enable verbose logging
  -h, --help       Show this help message

Examples:
  node edinburgh-scraper.js T1A67ZEWK0T00
  node edinburgh-scraper.js T1A67ZEWK0T00 --verbose
`);
}

/**
 * Main execution
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('Edinburgh Building Control Scraper');
  console.log('='.repeat(50));
  console.log(`KeyVal: ${options.keyVal}`);
  console.log('');

  try {
    const data = await scrapeEdinburghBuildingControl(options.keyVal, { verbose: options.verbose });

    // Save to file
    const filename = `edinburgh-${options.keyVal}.json`;
    const filepath = await saveToJson(data, filename);
    console.log(`\nData saved to: ${filepath}`);

    // Output to console
    console.log('\n' + '='.repeat(50));
    console.log('SCRAPED DATA:');
    console.log('='.repeat(50));
    console.log(JSON.stringify(data, null, 2));

    process.exit(0);

  } catch (error) {
    console.error('\nScraping failed!');
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

export { scrapeEdinburghBuildingControl, saveToJson };

main();
