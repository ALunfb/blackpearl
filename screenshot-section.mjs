import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, 'temporary screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

const sections = [
  { name: 'hero', scrollY: 0 },
  { name: 'strip-features', scrollY: 850 },
  { name: 'database-top', scrollY: 1700 },
  { name: 'database-cards', scrollY: 2400 },
  { name: 'gallery', scrollY: 4000 },
  { name: 'cta-footer', scrollY: 5600 },
];

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2000));

// Force all reveals visible
await page.evaluate(() => {
  document.querySelectorAll('.reveal, .stagger-children').forEach(el => el.classList.add('visible'));
});
await new Promise(r => setTimeout(r, 300));

for (const s of sections) {
  await page.evaluate(y => window.scrollTo(0, y), s.scrollY);
  await new Promise(r => setTimeout(r, 800));
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: path.join(screenshotDir, `section-${s.name}.png`),
    clip: { x: 0, y: scrollY, width: 1440, height: 900 }
  });
  console.log(`Captured: ${s.name} at scrollY=${scrollY}`);
}

await browser.close();
console.log('Done.');
