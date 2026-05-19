import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const API_BASE_URL = "https://api.tenis4u.pl";
const CLUB_ID = Number(process.env.CLUB_ID || 104);
const CLUB_NAME = process.env.CLUB_NAME || "Fame Sport Club";
const SPORT_TYPE = (process.env.SPORT_TYPE || "badminton").toLowerCase();
const DAYS_AHEAD = clamp(Number(process.env.DAYS_AHEAD || 14), 1, 14);
const EVENING_START = process.env.EVENING_START || "18:00";
const EVENING_END = process.env.EVENING_END || "22:00";
const MIN_SLOT_MINUTES = clamp(Number(process.env.MIN_SLOT_MINUTES || 60), 1, 24 * 60);
const TIME_ZONE = process.env.TIME_ZONE || "Europe/Warsaw";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "output";

const checkedAt = new Date();
const targetDates = getNextLocalDates(checkedAt, DAYS_AHEAD, TIME_ZONE);
const occupancy = await fetchJson(`${API_BASE_URL}/occupancy/${CLUB_ID}`);
const courtData = await fetchJson(`${API_BASE_URL}/court/${CLUB_ID}`);
const stations = occupancy.stations.filter((station) => {
  return String(station.type || "").toLowerCase() === SPORT_TYPE;
});

const availability = targetDates.map((date) => {
  const slots = stations.flatMap((station) => {
    const day = station.days.find((item) => normalizeDate(item.date) === date);
    if (!day) {
      return [];
    }

    return day.free_hours
      .map((slot) => clipSlotToWindow(station, date, slot, EVENING_START, EVENING_END))
      .filter((slot) => slot && slot.durationMinutes >= MIN_SLOT_MINUTES);
  });

  return {
    date,
    available: slots.length > 0,
    slots: slots.sort(compareSlots)
  };
});

const payload = {
  club: {
    id: CLUB_ID,
    name: courtData.name || CLUB_NAME,
    address: courtData.address,
    website: courtData.website,
    contactNumber: courtData.contact_number
  },
  sportType: SPORT_TYPE,
  timeZone: TIME_ZONE,
  checkedAt: checkedAt.toISOString(),
  eveningStart: EVENING_START,
  eveningEnd: EVENING_END,
  minimumSlotMinutes: MIN_SLOT_MINUTES,
  datesChecked: targetDates,
  availableSlotCount: availability.reduce((total, day) => total + day.slots.length, 0),
  availability
};

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(`${OUTPUT_DIR}/fame-badminton-availability.json`, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile(`${OUTPUT_DIR}/fame-badminton-availability.md`, toMarkdown(payload), "utf8");

console.log(`Checked ${payload.club.name} ${SPORT_TYPE} availability from ${EVENING_START} to ${EVENING_END}.`);
console.log(`Minimum slot duration: ${MIN_SLOT_MINUTES} minutes`);
console.log(`Dates: ${targetDates.join(", ")}`);
console.log(`Available slots: ${payload.availableSlotCount}`);

for (const day of availability) {
  for (const slot of day.slots) {
    console.log(`${day.date}: ${slot.start}-${slot.end} on ${slot.stationName}`);
  }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Tenis-User-Agent": "tenis4u-web-frontoffice/3.5.0"
      }
    });

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
  const { stdout } = await execFileAsync(curlCommand, [
    "-s",
    "-L",
    "--max-time",
    "60",
    "-H",
    "Accept: application/json",
    "-H",
    "X-Tenis-User-Agent: tenis4u-web-frontoffice/3.5.0",
    url
  ]);

  return JSON.parse(stdout);
}

function shouldFallbackToCurl(error) {
  const code = error?.cause?.code || error?.code;
  return code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" || code === "SELF_SIGNED_CERT_IN_CHAIN";
}

function clipSlotToWindow(station, date, slot, eveningStart, eveningEnd) {
  const slotStart = timeToMinutes(slot.begin_time);
  const slotEnd = timeToMinutes(slot.end_time);
  const eveningStartMinutes = timeToMinutes(eveningStart);
  const eveningEndMinutes = timeToMinutes(eveningEnd);
  const clippedStart = Math.max(slotStart, eveningStartMinutes);
  const clippedEnd = Math.min(slotEnd, eveningEndMinutes);

  if (slotEnd <= eveningStartMinutes || slotStart >= eveningEndMinutes || clippedStart >= clippedEnd) {
    return null;
  }

  return {
    stationId: station.id,
    stationName: station.name,
    stationType: station.type,
    date,
    start: minutesToTime(clippedStart),
    end: minutesToTime(clippedEnd),
    durationMinutes: clippedEnd - clippedStart,
    originalStart: slot.begin_time.slice(0, 5),
    originalEnd: slot.end_time.slice(0, 5)
  };
}

function toMarkdown(payload) {
  const lines = [
    "# Available Badminton Courts",
    "",
    `${payload.club.name}, ${payload.club.address || "Krakow"}`,
    `Window: ${payload.eveningStart}-${payload.eveningEnd}`,
    `Minimum duration: ${payload.minimumSlotMinutes} minutes`,
    ""
  ];

  for (const day of payload.availability) {
    if (!day.available) {
      continue;
    }

    lines.push(`## ${day.date}`);
    lines.push("");

    for (const slot of day.slots) {
      lines.push(`- ${slot.stationName}: ${slot.start}-${slot.end}`);
    }

    lines.push("");
  }

  return `${lines.join("\n")}\n`;
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
  return value.replaceAll("/", "-");
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

function compareSlots(left, right) {
  return left.start.localeCompare(right.start) || left.stationName.localeCompare(right.stationName);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.trunc(value), min), max);
}
