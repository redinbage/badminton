import fs from 'fs/promises';
import { chromium } from 'playwright';

const TARGET = 'https://app.tenis4u.pl/#/court/104';
const OUT_DIR = 'output';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const captures = [];

  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (/occupancy|court|reservation|full-day|/i.test(url)) {
        const ct = res.headers()['content-type'] || '';
        let body = null;
        try {
          if (ct.includes('application/json')) {
            body = await res.json();
          } else {
            body = await res.text();
          }
        } catch (e) {
          body = await res.text().catch(() => null);
        }

        captures.push({ url, status: res.status(), body });
      }
    } catch (err) {
      // ignore
    }
  });

  await page.goto(TARGET, { waitUntil: 'networkidle' });

  // wait a bit for SPA rendering
  await page.waitForTimeout(3000);

  // Save full page HTML
  const html = await page.content();
  await fs.writeFile(`${OUT_DIR}/tenis4u-court-104-rendered.html`, html, 'utf8');

  // Try to extract slots by station headings
  const slots = await page.evaluate(() => {
    const result = [];
    const timeRegex = /^(?:[0-2]?\d):[0-5]\d$/;
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    for (const h of headings) {
      const title = h.innerText && h.innerText.trim();
      if (!title) continue;
      // find following sibling elements up to next heading
      let node = h.nextElementSibling;
      const times = new Set();
      while (node && !/^H[1-6]$/i.test(node.tagName)) {
        // find descendant text nodes that look like times
        const elements = node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : [];
        elements.push(node);
        for (const el of elements) {
          const text = el.innerText && el.innerText.trim();
          if (!text) continue;
          const parts = text.split(/\s+/).filter(Boolean);
          for (const part of parts) {
            const p = part.replace(/[^0-9:\.]/g, '').replace('.', ':');
            if (timeRegex.test(p)) times.add(p);
          }
        }
        node = node.nextElementSibling;
      }
      if (times.size > 0) result.push({ station: title, times: Array.from(times).sort() });
    }
    return result;
  });

  await fs.writeFile(`${OUT_DIR}/tenis4u-network-captures.json`, JSON.stringify(captures, null, 2), 'utf8');
  await fs.writeFile(`${OUT_DIR}/tenis4u-rendered-slots.json`, JSON.stringify(slots, null, 2), 'utf8');

  console.log('Saved rendered HTML, network captures, and extracted slots to output/.');

  await browser.close();
}

run().catch(err => { console.error(err); process.exit(2); });
