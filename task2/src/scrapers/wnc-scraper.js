/**
 * West Northamptonshire Building Control Scraper
 *
 * Uses Got (HTTP client) to fetch and parse building control data from the
 * West Northamptonshire Council planning register.
 *
 * @module wnc-scraper
 * @requires got
 * @requires cheerio
 * @requires tough-cookie
 *
 * Target URL: https://wnc.planning-register.co.uk/BuildingControl/Display/{reference}
 * Handles disclaimer page automatically via POST to /Disclaimer/Accept
 */

import got from 'got';
import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { CookieJar } from 'tough-cookie';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  baseUrl: 'https://wnc.planning-register.co.uk',
  timeout: 30000,
  retries: 3,
  retryDelay: 1000,
};

// Application type definitions for context
const APPLICATION_TYPES = {
  'Full Plans': {
    description: 'Full plans submission where approval and completion certificates may be available',
    certificatesAvailable: true,
  },
  'Building Notice': {
    description: 'Notice served stating building work is planned. No approval notice issued.',
    certificatesAvailable: false,
  },
  'Initial Notice': {
    description: 'Notice served by Private Building Control Body (Approved Inspector)',
    certificatesAvailable: false,
  },
  'Competent Persons': {
    description: 'Work undertaken by Competent Persons with self-certification',
    certificatesAvailable: false,
  },
};

// ============================================================================
// Custom Error Classes
// ============================================================================

/**
 * Custom error for scraping failures
 */
class ScraperError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ScraperError';
    this.code = code;
    this.details = details;
  }
}

// ============================================================================
// HTTP Client
// ============================================================================

/**
 * Creates a configured Got instance with cookie support for session handling
 * @returns {import('got').Got} Configured Got instance
 */
function createHttpClient() {
  const cookieJar = new CookieJar();

  return got.extend({
    prefixUrl: CONFIG.baseUrl,
    timeout: { request: CONFIG.timeout },
    retry: {
      limit: CONFIG.retries,
      methods: ['GET', 'POST'],
      statusCodes: [408, 413, 429, 500, 502, 503, 504],
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    followRedirect: true,
    cookieJar,
    hooks: {
      beforeRetry: [
        (error, retryCount) => {
          console.log(`Retry attempt ${retryCount} after error: ${error.message}`);
        }
      ],
    },
  });
}

// ============================================================================
// Disclaimer Handling
// ============================================================================

/**
 * Accepts the disclaimer by POSTing to the Accept endpoint
 * The form action is: /Disclaimer/Accept?returnUrl={encodedReturnUrl}
 * Server requires Content-Length header, so we send empty body
 *
 * @param {import('got').Got} client - Got HTTP client instance
 * @param {string} returnUrl - URL to redirect to after accepting
 * @returns {Promise<import('got').Response>} HTTP response
 * @throws {ScraperError} If disclaimer acceptance fails
 */
async function acceptDisclaimer(client, returnUrl) {
  const acceptUrl = `Disclaimer/Accept?returnUrl=${encodeURIComponent(returnUrl)}`;

  try {
    const response = await client.post(acceptUrl, {
      body: '', // Empty body to satisfy Content-Length requirement
      followRedirect: true,
    });

    return response;
  } catch (error) {
    throw new ScraperError(
      'Failed to accept disclaimer',
      'DISCLAIMER_FAILED',
      { originalError: error.message, returnUrl }
    );
  }
}

/**
 * Fetches the building control page HTML, handling the disclaimer flow
 *
 * @param {import('got').Got} client - Got HTTP client instance
 * @param {string} reference - Application reference number
 * @returns {Promise<import('got').Response>} HTTP response with page HTML
 * @throws {ScraperError} If page fetch fails
 */
async function fetchBuildingControlPage(client, reference) {
  const returnUrl = `/BuildingControl/Display/${reference}`;
  const pageUrl = `BuildingControl/Display/${reference}`;

  try {
    // First try direct access to see if we get redirected to disclaimer
    const response = await client.get(pageUrl);

    // Check if we got the disclaimer page (contains the accept form)
    if (response.body.includes('Disclaimer/Accept') || response.body.includes('Terms and Conditions')) {
      // Accept the disclaimer
      const acceptedResponse = await acceptDisclaimer(client, returnUrl);

      // The accept response should redirect to the actual page
      // But if not, fetch it again
      if (acceptedResponse.body.includes('Disclaimer')) {
        return await client.get(pageUrl);
      }

      return acceptedResponse;
    }

    return response;
  } catch (error) {
    if (error instanceof ScraperError) throw error;

    throw new ScraperError(
      `Failed to fetch building control page: ${error.message}`,
      'FETCH_FAILED',
      { reference, originalError: error.message }
    );
  }
}

// ============================================================================
// Data Parsing Functions
// ============================================================================

/**
 * Cleans text by normalizing whitespace and removing extra line breaks
 * @param {string} text - Raw text to clean
 * @returns {string} Cleaned text
 */
function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
}

/**
 * Normalizes field names to consistent camelCase format
 * @param {string} name - Field name to normalize
 * @returns {string} Normalized camelCase field name
 */
function normalizeFieldName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^\s+/, '')
    .trim();
}

/**
 * Parses the main details section from the page
 * The WNC site uses table cells with label and span value, separated by <br />
 * Format: <td>Label <br /> <div><span>Value</span></div></td>
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance
 * @returns {Object} Parsed main details
 */
function parseMainDetails($) {
  const details = {};

  // WNC format: td elements with label text and span for value
  $('td.halfwidth, td.fullwidth').each((_, td) => {
    const $td = $(td);
    const fullText = $td.text().trim();

    // The label is the text before the span, the value is inside the span
    const $span = $td.find('span');
    if ($span.length > 0) {
      const value = cleanText($span.text());

      // Get the label by removing the span text from full text
      let label = fullText.replace($span.text(), '').trim();
      label = label.replace(/\s+/g, ' ').trim();

      if (label) {
        const fieldName = normalizeFieldName(label);
        details[fieldName] = value || null;
      }
    }
  });

  // Fallback: Definition list (dt/dd pairs)
  if (Object.keys(details).length === 0) {
    $('dl').each((_, dl) => {
      $(dl).find('dt').each((_, dt) => {
        const label = $(dt).text().trim().replace(/:$/, '');
        const dd = $(dt).next('dd');
        const value = cleanText(dd.text());

        if (label) {
          details[normalizeFieldName(label)] = value || null;
        }
      });
    });
  }

  return details;
}

/**
 * Parses the plots/units information from the page
 * Plots are displayed in a table with columns: Plot Number, Plot Address, Plot Status, etc.
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance
 * @returns {Array<Object>} Array of plot objects
 */
function parsePlots($) {
  const plots = [];

  // Find all tables and look for the plots table
  $('table').each((_, table) => {
    const tableText = $(table).text().toLowerCase();

    // Check if this table contains plot information
    if (tableText.includes('plot number') || tableText.includes('plot status')) {
      const headers = [];

      // Get headers from thead or first row
      $(table).find('thead th').each((_, th) => {
        headers.push($(th).text().trim());
      });

      // Fallback: get headers from first row if no thead
      if (headers.length === 0) {
        $(table).find('tr').first().find('th, td').each((_, cell) => {
          headers.push($(cell).text().trim());
        });
      }

      // Parse data rows
      $(table).find('tbody tr').each((_, row) => {
        const plot = {};
        $(row).find('td').each((idx, td) => {
          const header = headers[idx] || `column_${idx}`;
          const value = cleanText($(td).text());
          if (value) {
            plot[normalizeFieldName(header)] = value;
          }
        });

        if (Object.keys(plot).length > 0) {
          plots.push(plot);
        }
      });
    }
  });

  return plots;
}

/**
 * Parses the site history information from the page
 * Site history shows related applications linked by UPRN
 * Headers: Application number, Received Date, Validated Date, Application Type, Location, Proposal
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance
 * @returns {Array<Object>} Array of history records
 */
function parseSiteHistory($) {
  const history = [];

  // Find all tables and look for the history table
  $('table').each((_, table) => {
    const tableText = $(table).text().toLowerCase();

    // Check if this table contains history/linked applications
    if (tableText.includes('application number') && tableText.includes('location') && tableText.includes('proposal')) {
      const headers = [];

      // Get headers from thead or first tr with th elements
      $(table).find('thead tr th, tr th').each((_, th) => {
        const headerText = $(th).text().trim();
        if (headerText && !headers.includes(headerText)) {
          headers.push(headerText);
        }
      });

      // Parse data rows (rows with td elements)
      $(table).find('tbody tr, tr').each((_, row) => {
        const $tds = $(row).find('td');
        if ($tds.length === 0) return; // Skip header rows

        const record = {};
        $tds.each((idx, td) => {
          const header = headers[idx] || `column_${idx}`;
          const value = cleanText($(td).text());
          if (value) {
            record[normalizeFieldName(header)] = value;
          }
        });

        // Only add if it's a real data record (has multiple fields, not just a header)
        if (Object.keys(record).length > 1) {
          history.push(record);
        }
      });
    }
  });

  return history;
}

/**
 * Extracts any document links from the page
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance
 * @returns {Array<Object>} Array of document objects with name and url
 */
function parseDocuments($) {
  const documents = [];

  // Look for document links (PDFs, etc.)
  $('a[href*=".pdf"], a[href*="document"], a[href*="Document"]').each((_, link) => {
    const href = $(link).attr('href');
    const text = cleanText($(link).text());
    if (href && text && !href.includes('Disclaimer')) {
      documents.push({
        name: text,
        url: href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`,
      });
    }
  });

  return documents;
}

/**
 * Extracts contact information from the page
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance
 * @returns {Object|null} Contact info object or null
 */
function parseContactInfo($) {
  const contacts = {};

  // Look for email addresses
  $('a[href^="mailto:"]').each((_, link) => {
    const email = $(link).attr('href').replace('mailto:', '');
    if (email && email.includes('@')) {
      contacts.email = email;
    }
  });

  return Object.keys(contacts).length > 0 ? contacts : null;
}

/**
 * Adds application type context/metadata
 *
 * @param {string} applicationType - The application type from scraped data
 * @returns {Object|null} Application type metadata
 */
function getApplicationTypeInfo(applicationType) {
  if (!applicationType) return null;

  for (const [key, value] of Object.entries(APPLICATION_TYPES)) {
    if (applicationType.toLowerCase().includes(key.toLowerCase())) {
      return { type: key, ...value };
    }
  }

  return null;
}

// ============================================================================
// Data Validation
// ============================================================================

/**
 * Validates the scraped data structure
 *
 * @param {Object} data - Scraped data object
 * @returns {Object} Validation result with isValid and errors
 */
function validateScrapedData(data) {
  const errors = [];

  // Check required metadata
  if (!data.metadata?.reference) {
    errors.push('Missing reference number in metadata');
  }

  // Check main details has some content
  if (!data.mainDetails || Object.keys(data.mainDetails).length === 0) {
    errors.push('No main details extracted - page may not have loaded correctly');
  }

  // Validate reference number format (WNC uses formats like FP/2025/0159, BN/2024/1234)
  if (data.mainDetails?.referenceNumber) {
    const refPattern = /^[A-Z]{2}\/\d{4}\/\d+$/;
    if (!refPattern.test(data.mainDetails.referenceNumber)) {
      errors.push(`Reference number format unexpected: ${data.mainDetails.referenceNumber}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
  };
}

// ============================================================================
// Main Scraper Function
// ============================================================================

/**
 * Main scraper function - scrapes a WNC building control application
 *
 * @param {string} reference - Application reference number (e.g., 'FP/2025/0159')
 * @param {Object} options - Scraper options
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {Promise<Object>} Scraped building control data
 * @throws {ScraperError} If scraping fails
 */
async function scrapeBuildingControl(reference, options = {}) {
  const { verbose = false } = options;

  const log = (msg) => verbose && console.log(msg);

  log(`\nScraping WNC Building Control: ${reference}`);
  log('='.repeat(50));

  const client = createHttpClient();

  try {
    // Fetch the page (handles disclaimer automatically)
    log('Fetching page...');
    const response = await fetchBuildingControlPage(client, reference);
    const $ = cheerio.load(response.body);

    // Extract page title
    const pageTitle = cleanText($('h1').first().text());
    log(`Page title: ${pageTitle}`);

    // Parse all sections
    log('Parsing main details...');
    const mainDetails = parseMainDetails($);

    log('Parsing plots...');
    const plots = parsePlots($);

    log('Parsing site history...');
    const siteHistory = parseSiteHistory($);

    log('Parsing documents...');
    const documents = parseDocuments($);

    log('Parsing contact info...');
    const contactInfo = parseContactInfo($);

    // Get application type metadata
    const applicationTypeInfo = getApplicationTypeInfo(mainDetails.applicationType);

    // Build the result object
    const result = {
      metadata: {
        reference,
        scrapedAt: new Date().toISOString(),
        sourceUrl: `${CONFIG.baseUrl}/BuildingControl/Display/${reference}`,
        pageTitle: pageTitle || null,
        scraperVersion: '1.0.0',
      },
      mainDetails,
      applicationTypeInfo,
      plots: plots.length > 0 ? plots : null,
      siteHistory: siteHistory.length > 0 ? siteHistory : null,
      documents: documents.length > 0 ? documents : null,
      contactInfo,
    };

    // Validate the data
    const validation = validateScrapedData(result);
    if (!validation.isValid) {
      console.warn('Data validation warnings:', validation.errors);
    }
    result.metadata.validation = validation;

    // Log summary
    log('\nExtracted Data Summary:');
    log(`- Page Title: ${pageTitle || 'N/A'}`);
    log(`- Main Details: ${Object.keys(mainDetails).length} fields`);
    log(`- Plots: ${plots.length} records`);
    log(`- Site History: ${siteHistory.length} records`);
    log(`- Documents: ${documents.length} links`);
    log(`- Validation: ${validation.isValid ? 'PASSED' : 'FAILED'}`);

    return result;

  } catch (error) {
    if (error instanceof ScraperError) throw error;

    throw new ScraperError(
      `Scraping failed: ${error.message}`,
      'SCRAPE_FAILED',
      { reference, originalError: error.message, stack: error.stack }
    );
  }
}

// ============================================================================
// File Output
// ============================================================================

/**
 * Saves the scraped data to a JSON file
 *
 * @param {Object} data - Data to save
 * @param {string} filename - Output filename
 * @returns {Promise<string>} Path to saved file
 */
async function saveToJson(data, filename) {
  const outputDir = join(__dirname, '../../output');
  await mkdir(outputDir, { recursive: true });

  const filepath = join(outputDir, filename);
  await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');

  return filepath;
}

// ============================================================================
// CLI Execution
// ============================================================================

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    reference: 'FP/2025/0159',
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
      options.reference = arg;
    }
  }

  return options;
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
WNC Building Control Scraper

Usage: node wnc-scraper.js [reference] [options]

Arguments:
  reference    Application reference number (default: FP/2025/0159)

Options:
  -v, --verbose    Enable verbose logging
  -h, --help       Show this help message

Examples:
  node wnc-scraper.js FP/2025/0159
  node wnc-scraper.js BN/2024/1234 --verbose
`);
}

/**
 * Main execution function
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('WNC Building Control Scraper');
  console.log('='.repeat(50));
  console.log(`Reference: ${options.reference}`);
  console.log(`Verbose: ${options.verbose}`);
  console.log('');

  try {
    const data = await scrapeBuildingControl(options.reference, { verbose: options.verbose });

    // Save to file
    const filename = `wnc-${options.reference.replace(/\//g, '-')}.json`;
    const filepath = await saveToJson(data, filename);
    console.log(`\nData saved to: ${filepath}`);

    // Output to console
    console.log('\n' + '='.repeat(50));
    console.log('SCRAPED DATA:');
    console.log('='.repeat(50));
    console.log(JSON.stringify(data, null, 2));

    // Exit with appropriate code based on validation
    process.exit(data.metadata.validation.isValid ? 0 : 1);

  } catch (error) {
    console.error('\nScraping failed!');
    console.error(`Error: ${error.message}`);

    if (error instanceof ScraperError) {
      console.error(`Code: ${error.code}`);
      console.error('Details:', JSON.stringify(error.details, null, 2));
    }

    process.exit(1);
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  scrapeBuildingControl,
  saveToJson,
  ScraperError,
  CONFIG,
  APPLICATION_TYPES,
};

// Run if called directly
main();
