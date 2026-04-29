
const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Vienna',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false
});

function calculateActiveHours(lastUpdate, now, ignoreFreeze) {
    if (ignoreFreeze) {
        return (now - lastUpdate) / (1000 * 3600);
    }
    let activems = 0;
    let current = lastUpdate;
    const step = 60 * 1000;
    while (current < now) {
        const next = Math.min(current + step, now);
        const mid = new Date(current + (next - current) / 2);
        const parts = formatter.formatToParts(mid);
        const d = {};
        parts.forEach(p => d[p.type] = p.value);
        const hour = parseInt(d.hour);
        const min = parseInt(d.minute);
        const isWeekend = (d.weekday === 'Sat' || d.weekday === 'Sun');
        const totalMinutes = hour * 60 + min;
        const isActive = !isWeekend && totalMinutes >= (12 * 60 + 20) && totalMinutes < (16 * 60 + 30);
        if (isActive) {
            activems += (next - current);
        }
        current = next;
    }
    return activems / (1000 * 3600);
}

// April 8, 2026 (Wed) - CEST (UTC+2)
// 12:20 Vienna = 10:20 UTC
// 16:30 Vienna = 14:30 UTC

console.log("--- Comprehensive Verification ---");

// Test 1: Full active window
const tStart = new Date("2026-04-08T10:20:00Z").getTime();
const tEnd = new Date("2026-04-08T14:30:00Z").getTime();
const hours1 = calculateActiveHours(tStart, tEnd, false);
console.log("Test 1 (Full Window 12:20-16:30):", hours1.toFixed(4), "hours");
console.log("Expected: 4.1667");

// Test 2: Overlapping window (11:00 to 13:00 local)
// Active part is 12:20 to 13:00 = 40 mins = 0.6667 hours
const t2a = new Date("2026-04-08T09:00:00Z").getTime(); // 11:00 local
const t2b = new Date("2026-04-08T11:00:00Z").getTime(); // 13:00 local
const hours2 = calculateActiveHours(t2a, t2b, false);
console.log("Test 2 (11:00-13:00 Local):", hours2.toFixed(4), "hours");
console.log("Expected: 0.6667");

// Test 3: Weekend (Saturday)
const t3a = new Date("2026-04-11T10:00:00Z").getTime(); // 12:00 local
const t3b = new Date("2026-04-11T15:00:00Z").getTime(); // 17:00 local
const hours3 = calculateActiveHours(t3a, t3b, false);
console.log("Test 3 (Weekend Sat 12:00-17:00):", hours3.toFixed(4), "hours");
console.log("Expected: 0.0000");

// Test 4: Across two days (Wed 16:00 to Thu 13:00)
// Wed: 16:00-16:30 = 30m
// Thu: 12:20-13:00 = 40m
// Total: 70m = 1.1667 hours
const t4a = new Date("2026-04-08T14:00:00Z").getTime(); // Wed 16:00 local
const t4b = new Date("2026-04-09T11:00:00Z").getTime(); // Thu 13:00 local
const hours4 = calculateActiveHours(t4a, t4b, false);
console.log("Test 4 (Across two days):", hours4.toFixed(4), "hours");
console.log("Expected: 1.1667");
