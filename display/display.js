const API_URL = "https://neualm-infotafel.sb-nmsstadt.workers.dev/api";

let students = [];
let settings = {};
let rewards = [];

// ── PARTICLES ──────────────────────────────────
function createParticles() {
    const colors = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ec4899'];
    for (let i = 0; i < 16; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 5 + 3;
        p.style.cssText = `
            width:${size}px; height:${size}px;
            background:${colors[i % colors.length]};
            left:${Math.random() * 100}vw;
            animation-duration:${Math.random() * 18 + 14}s;
            animation-delay:${Math.random() * 14}s;`;
        document.body.appendChild(p);
    }
}

// ── CLOCK ──────────────────────────────────────
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    document.getElementById('clock').textContent = `${h}:${m}`;
}

// ── FETCH ──────────────────────────────────────
async function fetchData() {
    try {
        const [sRes, stRes, rRes] = await Promise.all([
            fetch(`${API_URL}/students`),
            fetch(`${API_URL}/settings`),
            fetch(`${API_URL}/rewards`)
        ]);
        students = sRes.ok ? await sRes.json() : [];
        settings = stRes.ok ? await stRes.json() : {};
        rewards  = rRes.ok ? await rRes.json() : [];

        renderAll();

        const now = new Date();
        document.getElementById('last-updated').textContent =
            `Zuletzt: ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

// ── SMOOTH UPDATE HELPER ───────────────────────
// Skips DOM update if content unchanged (keeps scroll running).
// If changed: fade out → update → reset animation → fade in.
async function smoothUpdate(el, newHTML, { animDuration = null, scrolling = false } = {}) {
    if (!el) return;
    const key = newHTML.replace(/\s+/g, '');
    if (el._contentKey === key) return; // no change → don't touch
    el._contentKey = key;

    // Fade out
    el.style.transition = 'opacity 0.35s ease';
    el.style.opacity = '0';
    await new Promise(r => setTimeout(r, 380));

    // Update
    el.innerHTML = newHTML;

    // Reset animation cleanly
    if (scrolling || el.style.animationName || el.classList.contains('scrolling')) {
        el.style.animation = 'none';
        void el.offsetWidth; // force reflow
        el.style.animation = '';
        if (animDuration) el.style.animationDuration = animDuration;
    }

    // Fade in
    el.style.opacity = '1';
}

function renderAll() {
    renderKids();
    renderCountdown();
    renderAttendance();
    renderProjects();
    renderTodayPlan();
    renderDailyNotes();
    renderStudentOfTheWeek();
    renderTicker();
}

// ── KIDS: SCROLL BAND ─────────────────────────
function renderKids() {
    const inner = document.getElementById('scroll-band-inner');
    if (!inner || students.length === 0) return;

    const today = new Date();
    today.setHours(0,0,0,0);
    const wDay = today.getDay() || 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - wDay + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23,59,59,999);

    // Sort by: today first → this week → upcoming birthday order
    const sorted = [...students].sort((a, b) => {
        const getScore = (s) => {
            if (!s.birthday) return Infinity;
            const [,m,d] = s.birthday.split('-').map(Number);
            let bday = new Date(today.getFullYear(), m-1, d);
            if (bday < today) bday = new Date(today.getFullYear()+1, m-1, d);
            const days = Math.round((bday.getTime() - today.getTime()) / 86400000);
            return days;
        };
        return getScore(a) - getScore(b);
    });

    const makeCard = (s) => {
        let isToday = false, isThisWeek = false, dateStr = '', daysLabel = '';
        if (s.birthday) {
            const [,m,d] = s.birthday.split('-').map(Number);
            let bday = new Date(today.getFullYear(), m-1, d);
            isToday    = bday.toDateString() === today.toDateString();
            isThisWeek = bday >= monday && bday <= sunday;
            dateStr    = `${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}.`;
            if (bday < today) bday = new Date(today.getFullYear()+1, m-1, d);
            const days = Math.round((bday.getTime() - today.getTime()) / 86400000);
            daysLabel  = isToday ? '🎂 HEUTE!' : `in ${days} Tagen`;
        }
        const cls = isToday ? 'today' : isThisWeek ? 'upcoming' : '';
        const badge = isToday
            ? `<div class="kid-card-badge today-badge">🎂 HEUTE!</div>`
            : isThisWeek
                ? `<div class="kid-card-badge" style="background:rgba(236,72,153,0.1);color:#f9a8d4;border:1px solid rgba(236,72,153,0.3);">diese Woche</div>`
                : '';
        return `
            <div class="kid-card ${cls}">
                <div class="kid-card-avatar">${s.avatar || s.name.charAt(0)}</div>
                <div class="kid-card-info">
                    <div class="kid-card-name">${s.name}</div>
                    <div class="kid-card-date">${dateStr}${dateStr && daysLabel ? ' · ' + daysLabel : daysLabel}</div>
                </div>
                ${badge}
            </div>`;
    };

    // Duplicate for seamless infinite scroll
    const html = [...sorted, ...sorted].map(makeCard).join('');
    const duration = `${Math.max(20, sorted.length * 3.5)}s`;
    smoothUpdate(inner, html, { animDuration: duration, scrolling: true });
}


// ── COUNTDOWN ──────────────────────────────────
function renderCountdown() {
    const pill = document.getElementById('countdown-text');
    if (!pill) return;

    const today = new Date();
    today.setHours(0,0,0,0);

    const upcoming = students
        .filter(s => s.birthday)
        .map(s => {
            const [,m,d] = s.birthday.split('-').map(Number);
            let bday = new Date(today.getFullYear(), m-1, d);
            if (bday < today) bday = new Date(today.getFullYear()+1, m-1, d);
            const days = Math.round((bday.getTime() - today.getTime()) / 86400000);
            return { name: s.name.split(' ')[0], days, isToday: days === 0 };
        })
        .sort((a,b) => a.days - b.days);

    if (upcoming.length === 0) {
        pill.textContent = 'Keine Geburtstage';
        return;
    }

    const next = upcoming[0];
    if (next.isToday) {
        pill.innerHTML = `<strong>${next.name}</strong> hat heute Geburtstag! 🎉`;
    } else {
        pill.innerHTML = `<strong>${next.name}</strong> in <span class="days">${next.days}</span> Tagen`;
    }
}

// ── ATTENDANCE ──────────────────────────────────
function renderAttendance() {
    const el = document.getElementById('attendance-list');
    if (!el) return;

    const daysMap = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const todayDay = daysMap[new Date().getDay()];
    
    // Filter students present today
    const present = students.filter(s => (s.attendanceDays || []).includes(todayDay));

    if (present.length === 0) {
        el.innerHTML = `<div class="empty-state"><span>Keine Kinder für ${todayDay} eingetragen.</span></div>`;
        return;
    }

    // Sort by departure time (greedy sort)
    present.sort((a,b) => (a.departureTime || '99:99').localeCompare(b.departureTime || '99:99'));

    const html = present.map(s => {
        let timeClass = '';
        if (s.departureTime === '15:30') timeClass = 'time-green';
        else if (s.departureTime === '16:30') timeClass = 'time-blue';
        else if (s.departureTime) timeClass = 'time-purple';

        return `
            <div class="attendance-item fade-in">
                <span class="attendance-name">${s.name}</span>
                <span class="attendance-time ${timeClass}">${s.departureTime || '--:--'}</span>
            </div>
        `;
    }).join('');

    el.innerHTML = html;
}



// ── PROJECTS ──────────────────────────────────
function renderProjects() {
    const el = document.getElementById('projects-list');
    if (!el) return;
    const txt = settings.currentProjects || "Keine aktuellen Projekte.";
    el.innerHTML = txt;
}

// ── DAILY NOTES ───────────────────────────────
function renderDailyNotes() {
    const el = document.getElementById('daily-notes-list');
    if (!el) return;
    const txt = settings.dailyNotes || "Keine besonderen Notizen für heute.";
    el.innerHTML = txt;
}

// ── TODAY PLAN ────────────────────────────────
function renderTodayPlan() {
    const el = document.getElementById('today-plan-list');
    if (!el) return;
    const txt = settings.todayPlan || "Noch kein Plan für heute eingetragen.";
    el.innerHTML = txt;
}

// ── STUDENT OF THE WEEK (VIP) ───────────────────
function renderStudentOfTheWeek() {
    const el = document.getElementById('vip-list');
    const duration = settings.vipDurationDays || 7;
    const today = new Date();
    today.setHours(0,0,0,0);

    const winners = students.filter(s => s.vip && s.vip.active);

    if (winners.length === 0) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><span>Noch kein Schüler d. Woche</span></div>`;
        return;
    }

    el.innerHTML = winners.map(s => {
        let dayText = '';
        if (s.vip.grantedAt) {
            const g = new Date(s.vip.grantedAt);
            g.setHours(0,0,0,0);
            const diff = Math.floor((today.getTime() - g.getTime()) / 86400000) + 1;
            const left = duration - diff + 1;
            dayText = left <= 1 ? '🔴 Letzter Tag!' : `Tag ${diff} / ${duration}`;
        }
        return `
            <div class="vip-big fade-in">
                <div class="vip-star">🏆</div>
                <div class="vip-avatar-big">${s.avatar||s.name.charAt(0)}</div>
                <div class="vip-info-horizontal">
                    <div class="vip-name-big" style="font-size: 1.8rem;">${s.name}</div>
                    ${dayText ? `<div class="vip-days-big" style="width:fit-content;">${dayText}</div>` : ''}
                </div>
            </div>`;
    }).join('');
}

// ── TICKER ─────────────────────────────────────
function renderTicker() {
    const scroll = document.getElementById('ticker-scroll');
    const items = [];

    // All recent history across students (last 48h)
    const cutoff = Date.now() - 48 * 3600 * 1000;
    students.forEach(s => {
        (s.history || []).forEach(h => {
            if (!h.date || !h.reason) return;
            const ts = new Date(h.date).getTime();
            if (ts >= cutoff - 86400000) { // last 2 days loosely
                items.push({ name: s.name.split(' ')[0], reason: h.reason, date: h.date });
            }
        });
    });

    // Sort newest first, filter out "Admin-Korrektur", take last 20
    items.sort((a,b) => new Date(b.date) - new Date(a.date));
    const display = items
        .filter(it => it.reason !== "Admin-Korrektur")
        .slice(0, 20);

    // Add Schüler d. Woche info
    students.filter(s => s.vip && s.vip.active).forEach(s => {
        display.unshift({ name: s.name.split(' ')[0], reason: '🏆 Schüler d. Woche!', date: s.vip.grantedAt||'' });
    });

    if (display.length === 0) {
        display.push({ name: 'NACHMI', reason: '🌟 Noch keine Aktivitäten', date: '' });
    }

    // Duplicate for seamless loop
    const html = [...display, ...display].map(it => `
        <div class="ticker-item">
            <span class="t-icon">▸</span>
            <span class="t-name">${it.name}</span>
            <span>${it.reason}</span>
        </div>`).join('');

    const duration = `${Math.max(20, display.length * 4)}s`;
    smoothUpdate(scroll, html, { animDuration: duration, scrolling: true });
}

// ── INIT ───────────────────────────────────────
createParticles();
updateClock();
setInterval(updateClock, 1000);

fetchData();
setInterval(fetchData, 30000);

// ── FILMTAG LIVE POLL (every 5s) ───────────────
// Only fetches /settings — lightweight, for near-realtime Filmtag updates.
async function fetchFilmtagLive() {
    try {
        const res = await fetch(`${API_URL}/settings`);
        if (!res.ok) return;
        const newSettings = await res.json();

        // Compare groupReward.current to detect change
        const oldCurrent = settings?.groupReward?.current;
        const newCurrent = newSettings?.groupReward?.current;

        if (oldCurrent !== newCurrent) {
            settings = newSettings;
            renderFilmtag(); // only re-render Filmtag bar
        }
    } catch (_) { /* silent fail */ }
}

// (Filmtag live poll disabled for Neualm)
// setInterval(fetchFilmtagLive, 5000);

// Re-layout kids on resize
window.addEventListener('resize', () => {
    if (students.length) renderKids();
});
