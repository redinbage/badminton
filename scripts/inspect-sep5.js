// Inspect output/occupancy-raw.json for free_hours on 2026-09-05
import { readFile } from 'node:fs/promises';

const TARGET = '2026-09-05';

function normalizeDate(d) {
  if (!d) return d;
  return d.split('T')[0].replaceAll('/', '-');
}

(async function main() {
  try {
    const text = await readFile('output/occupancy-raw.json', 'utf8');
    const json = JSON.parse(text);
    const stations = json.stations || [];

    const badminton = stations.filter(s => String(s.type || '').toLowerCase() === 'badminton');
    let found = false;

    for (const st of badminton) {
      const day = (st.days || []).find(d => normalizeDate(d.date) === TARGET);
      if (!day) continue;
      const free = day.free_hours || [];
      if (free.length > 0) {
        found = true;
        console.log(`${st.name} (${st.id}) has ${free.length} free_hours:`);
        for (const slot of free) {
          console.log(` - ${slot.begin_time || slot.begin || slot.start || 'N/A'} -> ${slot.end_time || slot.end || slot.finish || 'N/A'}`);
        }
      } else {
        console.log(`${st.name} (${st.id}) has no free_hours on ${TARGET}`);
      }
    }

    if (!found) {
      console.log('\nNo free slots found for any badminton station on', TARGET);
      process.exit(1);
    }
  } catch (err) {
    console.error('Error reading occupancy file:', err.message);
    process.exit(2);
  }
})();
