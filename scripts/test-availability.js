// Test harness for availability detection
// Run: node scripts/test-availability.js

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

// Sample occupancy simulating a Sep 5 slot
const occupancy = {
  stations: [
    {
      id: 101,
      name: 'badminton A',
      type: 'badminton',
      days: [
        {
          date: '2026-09-05',
          free_hours: [
            { begin_time: '17:00', end_time: '18:30' },
            { begin_time: '19:00', end_time: '20:00' }
          ]
        }
      ]
    }
  ]
};

const targetDates = ['2026-09-05'];

const stations = occupancy.stations.filter(s => (String(s.type || '').toLowerCase()) === 'badminton');

const availability = targetDates.map((date) => {
  const slots = stations.flatMap((station) => {
    const day = station.days.find((item) => item.date.replaceAll('/', '-') === date);
    if (!day) return [];

    return day.free_hours
      .map((slot) => clipSlotToWindow(station, date, slot, EVENING_START, EVENING_END))
      .filter((slot) => slot && slot.durationMinutes >= MIN_SLOT_MINUTES);
  });

  return { date, available: slots.length > 0, slots: slots.sort(compareSlots) };
});

console.log('Test target dates:', targetDates);
console.log('Detected availability:', JSON.stringify(availability, null, 2));

const day = availability.find(d => d.date === '2026-09-05');
if (day && day.available) {
  console.log('SUCCESS: Sep 5 availability detected.');
  process.exit(0);
} else {
  console.error('FAIL: Sep 5 availability NOT detected.');
  process.exit(2);
}
