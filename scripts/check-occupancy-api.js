import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const API_BASE_URL = "https://api.tenis4u.pl";
const CLUB_ID = Number(process.env.CLUB_ID || 104);
const SPORT_TYPE = (process.env.SPORT_TYPE || "badminton").toLowerCase();
const DAYS_AHEAD = clamp(Number(process.env.DAYS_AHEAD || 14), 1, 14);
const EVENING_START = process.env.EVENING_START || "18:00";
const EVENING_END = process.env.EVENING_END || "22:30";
const MIN_SLOT_MINUTES = clamp(Number(process.env.MIN_SLOT_MINUTES || 60), 1, 24 * 60);
const TIME_ZONE = process.env.TIME_ZONE || "Europe/Warsaw";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "output";
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
const checkedAt = new Date();
const targetDates = getNextLocalDates(checkedAt, DAYS_AHEAD, TIME_ZONE);

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

const filterDiagnostics = getFilterDiagnostics(stations, targetDates);
console.log("Availability filter diagnostics:");
console.log(JSON.stringify(filterDiagnostics, null, 2));

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(
  `${OUTPUT_DIR}/occupancy-api-diagnostics.json`,
  `${JSON.stringify({ rawSummary: result, filterDiagnostics }, null, 2)}\n`,
  "utf8"
);

const totalFreeHourEntries = [...bySport.values()].reduce((total, sport) => total + sport.freeHourEntries, 0);
if (totalFreeHourEntries === 0) {
  console.log("WARNING: occupancy API returned zero free_hours entries across all sports.");
}

if (filterDiagnostics.rawSlotCount > 0 && filterDiagnostics.acceptedSlotCount === 0) {
  console.log(`WARNING: ${filterDiagnostics.rawSlotCount} raw ${SPORT_TYPE} slots were returned for the checked dates, but none matched the reporting filters.`);
}

function getFilterDiagnostics(allStations, dates) {
  const selectedStations = allStations.filter((station) => String(station.type || "").toLowerCase() === SPORT_TYPE);
  const diagnosticsByDate = dates.map((date) => {
    const slots = [];

    for (const station of selectedStations) {
      const day = (station.days || []).find((item) => normalizeDate(item.date) === date);
      if (!day) {
        continue;
      }

      for (const slot of day.free_hours || []) {
        slots.push(describeSlot(station, date, slot));
      }
    }

    return {
      date,
      rawSlotCount: slots.length,
      acceptedSlotCount: slots.filter((slot) => slot.accepted).length,
      slots
    };
  });

  const rejectionReasons = {};
  for (const day of diagnosticsByDate) {
    for (const slot of day.slots) {
      if (slot.accepted) {
        continue;
      }

      rejectionReasons[slot.reason] = (rejectionReasons[slot.reason] || 0) + 1;
    }
  }

  return {
    sportType: SPORT_TYPE,
    timeZone: TIME_ZONE,
    datesChecked: dates,
    eveningStart: EVENING_START,
    eveningEnd: EVENING_END,
    minimumSlotMinutes: MIN_SLOT_MINUTES,
    rawSlotCount: diagnosticsByDate.reduce((total, day) => total + day.rawSlotCount, 0),
    acceptedSlotCount: diagnosticsByDate.reduce((total, day) => total + day.acceptedSlotCount, 0),
    rejectionReasons,
    dates: diagnosticsByDate.filter((day) => day.rawSlotCount > 0 || day.acceptedSlotCount > 0)
  };
}

function describeSlot(station, date, slot) {
  const slotStart = timeToMinutes(slot.begin_time);
  const slotEnd = timeToMinutes(slot.end_time);
  const eveningStart = timeToMinutes(EVENING_START);
  const eveningEnd = timeToMinutes(EVENING_END);
  const clippedStart = Math.max(slotStart, eveningStart);
  const clippedEnd = Math.min(slotEnd, eveningEnd);
  const clippedDurationMinutes = Math.max(0, clippedEnd - clippedStart);

  let reason = "accepted";
  if (slotEnd <= eveningStart || slotStart >= eveningEnd || clippedStart >= clippedEnd) {
    reason = "outside-reporting-window";
  } else if (clippedDurationMinutes < MIN_SLOT_MINUTES) {
    reason = "shorter-than-minimum-after-window";
  }

  return {
    stationId: station.id,
    stationName: station.name,
    date,
    rawStart: slot.begin_time.slice(0, 5),
    rawEnd: slot.end_time.slice(0, 5),
    rawDurationMinutes: slotEnd - slotStart,
    clippedStart: clippedDurationMinutes > 0 ? minutesToTime(clippedStart) : null,
    clippedEnd: clippedDurationMinutes > 0 ? minutesToTime(clippedEnd) : null,
    clippedDurationMinutes,
    accepted: reason === "accepted",
    reason
  };
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

function getNextLocalDates(date, count, timeZone) {
  const today = getLocalDateParts(date, timeZone);
  const dates = [];

  for (let offset = 0; offset < count; offset += 1) {
    const middayUtc = new Date(Date.UTC(today.year, today.month - 1, today.day + offset, 12));
    const parts = getLocalDateParts(middayUtc, timeZone);
    dates.push(formatDate(parts.year, parts.month, parts.day));
  }

  return dates;
}

function getLocalDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year").value),
    month: Number(parts.find((part) => part.type === "month").value),
    day: Number(parts.find((part) => part.type === "day").value)
  };
}

function normalizeDate(value) {
  if (!value) return value;
  const datePart = String(value).split("T")[0];
  return datePart.replaceAll("/", "-");
}

function formatDate(year, month, day) {
  return [year, month, day].map((value) => String(value).padStart(2, "0")).join("-");
}

function timeToMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(value) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.trunc(value), min), max);
}
