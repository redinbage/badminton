// Verify normalizeDate handles ISO datetime strings

const EVENING_START = '18:00';
const EVENING_END = '22:00';
const MIN_SLOT_MINUTES = 60;

function timeToMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(value) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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

function compareSlots(left, right) {
  return left.start.localeCompare(right.start) || left.stationName.localeCompare(right.stationName);
}

// Occupancy with ISO datetime date field
const occupancy = {
  stations: [
    {
      id: 202,
      name: 'badminton ISO',
      type: 'badminton',
      days: [
        {
          date: '2026-09-05T00:00:00Z',
          free_hours: [ { begin_time: '18:00', end_time: '19:30' } ]
        }
      ]
    }
  ]
};

const targetDates = ['2026-09-05'];

// replicate normalizeDate logic from patched script
function normalizeDate(value) {
  if (!value) return value;
  const datePart = String(value).split('T')[0];
  return datePart.replaceAll('/', '-');
}

const stations = occupancy.stations.filter(s => (String(s.type || '').toLowerCase()) === 'badminton');

const availability = targetDates.map((date) => {
  const slots = stations.flatMap((station) => {
    const day = station.days.find((item) => normalizeDate(item.date) === date);
    if (!day) return [];

    return day.free_hours
      .map((slot) => clipSlotToWindow(station, date, slot, EVENING_START, EVENING_END))
      .filter((slot) => slot && slot.durationMinutes >= MIN_SLOT_MINUTES);
  });

  return { date, available: slots.length > 0, slots: slots.sort(compareSlots) };
});

console.log('Detected availability for ISO date:', JSON.stringify(availability, null, 2));

if (availability[0].available) {
  console.log('SUCCESS: ISO datetime handled correctly.');
  process.exit(0);
} else {
  console.error('FAIL: ISO datetime not handled.');
  process.exit(3);
}
