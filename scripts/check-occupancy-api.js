import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const API_BASE_URL = "https://api.tenis4u.pl";
const CLUB_ID = Number(process.env.CLUB_ID || 104);
const API_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://app.tenis4u.pl",
  Referer: "https://app.tenis4u.pl/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  "X-Tenis-User-Agent": "tenis4u-web-frontoffice/3.6.0"
};

const occupancy = await fetchJson(`${API_BASE_URL}/occupancy/${CLUB_ID}`);
const stations = Array.isArray(occupancy.stations) ? occupancy.stations : [];
const bySport = new Map();

for (const station of stations) {
  const sport = String(station.type || "unknown");
  const summary = bySport.get(sport) || {
    stations: 0,
    days: 0,
    daysWithFreeHours: 0,
    freeHourEntries: 0,
    blockades: 0
  };

  summary.stations += 1;

  for (const day of station.days || []) {
    const freeHours = Array.isArray(day.free_hours) ? day.free_hours.length : 0;
    const blockades = Array.isArray(day.blockades) ? day.blockades.length : 0;

    summary.days += 1;
    summary.freeHourEntries += freeHours;
    summary.blockades += blockades;
    if (freeHours > 0) {
      summary.daysWithFreeHours += 1;
    }
  }

  bySport.set(sport, summary);
}

const result = {
  clubId: CLUB_ID,
  checkedAt: new Date().toISOString(),
  stationCount: stations.length,
  bySport: Object.fromEntries([...bySport.entries()].sort(([left], [right]) => left.localeCompare(right)))
};

console.log("Raw occupancy API summary:");
console.log(JSON.stringify(result, null, 2));

const totalFreeHourEntries = [...bySport.values()].reduce((total, sport) => total + sport.freeHourEntries, 0);
if (totalFreeHourEntries === 0) {
  console.warn("WARNING: occupancy API returned zero free_hours entries across all sports.");
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { headers: API_HEADERS });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
    }

    return response.json();
  } catch (error) {
    if (!shouldFallbackToCurl(error)) {
      throw error;
    }

    return fetchJsonWithCurl(url);
  }
}

async function fetchJsonWithCurl(url) {
  const curlCommand = process.platform === "win32" ? "curl.exe" : "curl";
  const args = ["-s", "-L", "--max-time", "60"];

  for (const [name, value] of Object.entries(API_HEADERS)) {
    args.push("-H", `${name}: ${value}`);
  }

  args.push(url);

  const { stdout } = await execFileAsync(curlCommand, args);
  return JSON.parse(stdout);
}

function shouldFallbackToCurl(error) {
  const code = error?.cause?.code || error?.code;
  return code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" || code === "SELF_SIGNED_CERT_IN_CHAIN";
}
