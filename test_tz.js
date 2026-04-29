
function getViennaParts(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Vienna',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const d = {};
    parts.forEach(p => d[p.type] = p.value);
    return {
        hour: parseInt(d.hour),
        minute: parseInt(d.minute),
        weekday: d.weekday,
        isWeekend: (d.weekday === 'Sat' || d.weekday === 'Sun')
    };
}

// April 8, 2026 is a Wednesday.
// CEST is UTC+2.

const tests = [
    { name: "Start of window (12:20 local)", utc: "2026-04-08T10:20:00Z", expectedHour: 12, expectedMin: 20 },
    { name: "End of window (16:30 local)", utc: "2026-04-08T14:30:00Z", expectedHour: 16, expectedMin: 30 },
    { name: "Midnight local", utc: "2026-04-07T22:00:00Z", expectedHour: 0, expectedMin: 0 },
];

tests.forEach(t => {
    const d = new Date(t.utc);
    const parts = getViennaParts(d);
    console.log(`Test: ${t.name}`);
    console.log(`  UTC: ${t.utc}`);
    console.log(`  Result: ${parts.hour}:${parts.minute} (${parts.weekday})`);
    const success = parts.hour === t.expectedHour && parts.minute === t.expectedMin;
    console.log(`  Success: ${success}`);
});
