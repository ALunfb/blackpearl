import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, 'brand-assets', 'og-image.png');

// Allow passing a URL (for local dev) or default to file:// for CI
const url = process.argv[2] || `file://${path.join(__dirname, 'index.html')}`;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

// Screenshot the viewport (hero section at 1200x630 OG dimensions)
await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();

console.log(`OG image saved: ${outPath}`);
