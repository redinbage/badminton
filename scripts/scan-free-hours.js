// Scan output/occupancy-raw.json for any non-empty free_hours and summarize
import { readFile } from 'node:fs/promises';

async function main() {
  const text = await readFile('output/occupancy-raw.json', 'utf8');
  const json = JSON.parse(text);
  const stations = json.stations || [];
  let totalSlots = 0;
  for (const st of stations) {
    const rows = (st.days || []).filter(d => Array.isArray(d.free_hours) && d.free_hours.length > 0);
    if (rows.length === 0) continue;
    console.log(`Station: ${st.name} (${st.id}) — ${rows.length} day(s) with free_hours`);
    for (const d of rows) {
      console.log(`  Date: ${d.date} — ${d.free_hours.length} slot(s)`);
      for (const slot of d.free_hours) {
        totalSlots += 1;
        console.log(`    - ${slot.begin_time || slot.begin || slot.start || 'N/A'} -> ${slot.end_time || slot.end || slot.finish || 'N/A'}`, slot);
      }
    }
  }

  if (totalSlots === 0) {
    console.log('No free_hours entries found in the raw occupancy payload.');
  } else {
    console.log(`Total free slots found in payload: ${totalSlots}`);
  }
}

main().catch(err => { console.error('Error scanning free_hours:', err); process.exit(2); });
