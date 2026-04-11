import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = (name) => path.join(__dirname, 'temporary screenshots', `v2-${name}.png`);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 60000 });

// Wait for live data
await page.waitForFunction(
  () => document.getElementById('heroKnivesTracked')?.textContent !== '—',
  { timeout: 60000 }
);
// Extra time for images to load
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(() => document.querySelectorAll('.reveal,.stagger-children').forEach(el=>el.classList.add('visible')));
await new Promise(r => setTimeout(r, 500));

const shots = [
  ['hero', 0],
  ['cards-top', 2050],
  ['cards-mid', 2750],
  ['gallery', 4300],
];
for (const [name, y] of shots) {
  await page.evaluate(py => window.scrollTo(0, py), y);
  await new Promise(r => setTimeout(r, 800));
  const sy = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: out(name), clip: { x: 0, y: sy, width: 1440, height: 900 } });
  console.log(`Saved ${name}`);
}

// Owners panel open
await page.evaluate(() => window.scrollTo(0, 2050));
await new Promise(r => setTimeout(r, 500));
const karCount = await page.$('.knife-card[data-name="karambit"] .knife-count');
if (karCount) {
  await karCount.click();
  await new Promise(r => setTimeout(r, 800));
  const sy = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: out('owners'), clip: { x: 0, y: sy, width: 1440, height: 900 } });
  console.log('Saved owners');
}
await browser.close();
