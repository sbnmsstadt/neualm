const API_URL = "https://neualm-infotafel.sb-nmsstadt.workers.dev/api";

let students = [];
let settings = {};
let rewards = [];
let events = [];
let planFlipInterval = null; 
let _celebrationSignaled = false; // Prevents repeated popups
let _lastCelebrationId = null;   // Tracks last seen celebration event
let _isBlinking = false;         // Global blink state for Tamagotchi
let _blinkStarted = false;       // Flag to prevent multiple blink loops
let _lastAlarmKey = null;        // Tracks last triggered time-based alarm (HH:mm)
let _audioEnabled = true;       // Enabled by default as per user request

/**
 * Unlocks audio context on first user interaction.
 * Required because browsers block autoplaying audio without a click.
 */
document.addEventListener('click', () => {
    _audioEnabled = true;
    const silent = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    silent.play().catch(() => {});
}, { once: true });

function enableAudio() {
    _audioEnabled = true;
}

let _audioContext = null;

/**
 * Triggers a simple synthesized beep to test audio hardware.
 */
function beep(freq = 440, duration = 150) {
    try {
        if (!_audioContext) {
            _audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_audioContext.state === 'suspended') {
            _audioContext.resume();
        }
        const osc = _audioContext.createOscillator();
        const gain = _audioContext.createGain();
        osc.connect(gain);
        gain.connect(_audioContext.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, _audioContext.currentTime);
        gain.gain.setValueAtTime(0.1, _audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, _audioContext.currentTime + duration/1000);
        osc.start();
        osc.stop(_audioContext.currentTime + duration/1000);
    } catch (e) {
        console.warn("Beep failed:", e);
    }
}

function playTimeSound(file, statusCallback = null) {
    console.log("Attempting to play sound:", file, "Audio enabled:", _audioEnabled);
    
    if (!_audioEnabled) {
        if (statusCallback) statusCallback("🚫 Nicht aktiviert (Button klicken!)");
        return;
    }

    const audio = new Audio();
    // Path list to try: relative, root-relative, and whatever was passed
    const paths = [
        file, 
        file.startsWith('../') ? file.substring(3) : file, 
        '/' + (file.startsWith('../') ? file.substring(3) : file),
        'audio/' + (file.includes('zeit') ? (file.split('/').pop()) : file)
    ];
    
    let currentTry = 0;

    const tryNext = () => {
        if (currentTry >= paths.length) {
            if (statusCallback) statusCallback("❌ Alle Pfade fehlgeschlagen (404)");
            return;
        }
        
        const path = paths[currentTry];
        if (statusCallback) statusCallback(`Teste Pfad ${currentTry + 1}: ${path}...`);
        
        audio.src = path;
        
        audio.oncanplaythrough = () => {
            audio.oncanplaythrough = null;
            audio.onerror = null;
            if (statusCallback) statusCallback(`✅ Geladen! Pfad: ${path}`);
            audio.play().catch(e => {
                if (e.name === 'NotAllowedError') {
                    console.warn("Audio playback blocked by browser. User interaction needed.");
                    if (statusCallback) statusCallback("🚫 Blockiert (Browser-Einstellung oder Klick fehlt)");
                } else {
                    if (statusCallback) statusCallback(`⚠️ Fehler: ${e.name}`);
                }
            });
        };

        audio.onerror = () => {
            const err = audio.error;
            let code = err ? err.code : 'unknown';
            console.warn(`Diagnostic: Path failed: ${path} (Code: ${code})`);
            currentTry++;
            tryNext();
        };
        
        audio.load();
    };

    tryNext();
}

// Broadcast listener for instant updates from Admin
try {
    const bc = new BroadcastChannel('nachmi_updates');
    bc.onmessage = (msg) => {
        if (msg.data.type === 'appointments_updated') {
            fetchData();
        } else if (msg.data.type === 'play_sound') {
            console.log("Remote sound request received:", msg.data.file);
            
            // diagnostic: trigger a tiny beep instantly to verify audio hardware
            beep(523, 100); 

            playTimeSound(msg.data.file, (status) => {
                if (msg.data.test) {
                    showAnnouncement("SOUND TEST", `Status: ${status}\nPfad: ${msg.data.file}`, "🔈", 10000);
                }
            });
        }
    };
} catch (e) {}

// ── PARTICLES ──────────────────────────────────
function createParticles() {
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'];
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
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('clock').textContent = `${h}:${m}`;
    
    // Check for time-based announcements (Heimgeher-Zeiten)
    checkTimeAlarms(h, m);
}

// ── FETCH ──────────────────────────────────────
async function safeFetch(endpoint, fallback = []) {
    try {
        const res = await fetch(`${API_URL}/${endpoint}`);
        if (res.ok) return await res.json();
        console.warn(`Fetch failed for ${endpoint}: ${res.status}`);
    } catch (err) {
        console.error(`Network error for ${endpoint}:`, err);
    }
    return fallback;
}

async function fetchData() {
    try {
        // Optimized: Combined request for all display data
        const res = await fetch(`${API_URL}/sync/display`);
        if (!res.ok) return;
        
        const data = await res.json();
        students = data.students || [];
        settings = data.settings || {};
        rewards = data.rewards || [];
        badges = data.badges || [];
        events = data.appointments || [];

        renderAll();

        const now = new Date();
        const lastUpdatedEl = document.getElementById('last-updated');
        if (lastUpdatedEl) {
            lastUpdatedEl.textContent =
                `Zuletzt: ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        }

        // Start Blinking Cycle for Tamagotchi (Once)
        if (!_blinkStarted) {
            _blinkStarted = true;
            startBlinkingCycle();
        }

        // Trigger Tamagotchi action detection even if renderAll wasn't called yet
        handleTamaActionDetection(settings.tamagotchi);

    } catch (err) {
        console.error('Outer fetchData error:', err);
    }
}

// ── BLINK LOGIC ────────────────────────────────
function startBlinkingCycle() {
    const blink = () => {
        _isBlinking = true;
        renderTamagotchi();
        setTimeout(() => {
            _isBlinking = false;
            renderTamagotchi();
        }, 200); // 200ms blink duration

        // Schedule next blink (3-7s random)
        setTimeout(blink, 3000 + Math.random() * 4000);
    };
    setTimeout(blink, 2000);
}

// ── SMOOTH UPDATE HELPER ───────────────────────
// Skips DOM update if content unchanged (keeps scroll running).
// If changed: update content, only reset animation if duration changed.
async function smoothUpdate(el, newHTML, { animDuration = null, scrolling = false } = {}) {
    if (!el) return;
    const key = newHTML.replace(/\s+/g, '');
    if (el._contentKey === key) return; // no change → don't touch
    el._contentKey = key;

    if (!scrolling) {
        // Fade out ONLY for static elements
        el.style.transition = 'opacity 0.3s ease';
        el.style.opacity = '0';
        await new Promise(r => setTimeout(r, 320));
    }

    // Update content natively
    el.innerHTML = newHTML;

    if (scrolling) {
        // For scrolling elements: ONLY reset the CSS animation if the duration changed.
        // If only content changed, leave the animation completely untouched so the
        // scroll continues from its current position without any visual jump/reset.
        const oldDur = el.style.animationDuration;
        if (animDuration && oldDur !== animDuration) {
            // Duration changed → need a clean restart
            el.style.animation = 'none';
            void el.offsetWidth; // force reflow
            el.style.animation = '';
            el.style.animationDuration = animDuration;
        } else if (animDuration && !oldDur) {
            // First time: just set the duration, CSS animation name already applies
            el.style.animationDuration = animDuration;
        }
        // If duration unchanged → do nothing, animation keeps running seamlessly
    } else {
        // Reset animation cleanly for static elements
        if (el.style.animationName || el.classList.contains('scrolling')) {
            el.style.animation = 'none';
            void el.offsetWidth;
            el.style.animation = '';
            if (animDuration) el.style.animationDuration = animDuration;
        }
        el.style.opacity = '1';
    }
}

function renderAll() {
    renderKids();
    renderCountdown();
    renderFilmtag();
    renderProjects();
    renderUpcomingProjects();
    renderTodayPlan();
    renderDailyNotes();
    renderVIPs();
    renderTicker();
    renderStudentOfWeek();
    renderAttendance(); // NEW: Today's attendance list
    renderBadgeGalerie();
    renderTamagotchi(); // NEW: Digital Pet logic
    checkBirthdayMode();
    checkCelebrationMode(); // NEW: Check for group milestone celebrations
}

// ── CELEBRATION MODE ───────────────────────────
function checkCelebrationMode() {
    if (!settings || !settings.celebration || !settings.celebration.active) return;
    
    const celebId = settings.celebration.id;
    if (celebId && celebId !== _lastCelebrationId) {
        console.log("New Celebration detected!", celebId);
        showGoalCelebration(settings.celebration.title);
        _lastCelebrationId = celebId;
    }
}

// ── STUDENT OF THE WEEK ────────────────────────
function renderStudentOfWeek() {
    const card = document.getElementById('sotw-card');
    const content = document.getElementById('sotw-content');
    if (!card || !content) return;

    const sotw = settings && settings.studentOfWeek;
    if (!sotw || !sotw.studentId) {
        card.style.display = 'none';
        return;
    }

    const student = students.find(s => String(s.id) === String(sotw.studentId));
    if (!student) {
        // Student might not be loaded yet — show with only the name stored in sotw
        card.style.display = 'block';
        content.innerHTML = `
            <div class="sotw-avatar">⭐</div>
            <div class="sotw-info">
                <div class="sotw-name">${sotw.studentId}</div>
                ${sotw.reason ? `<div class="sotw-reason">"${sotw.reason}"</div>` : ''}
            </div>
            <div style="font-size:2.5rem; animation: vipPulse 2s ease-in-out infinite;">⭐</div>
        `;
        return;
    }

    const avatar = student.avatar || student.name.charAt(0).toUpperCase();
    card.style.display = 'block';
    content.innerHTML = `
        <div class="sotw-avatar">${avatar}</div>
        <div class="sotw-info">
            <div class="sotw-name">${student.name.split(' ')[0]}</div>
            ${sotw.reason ? `<div class="sotw-reason">"${sotw.reason}"</div>` : ''}
        </div>
        <div style="font-size:2.5rem; animation: vipPulse 2s ease-in-out infinite;">⭐</div>
    `;
}
function renderAttendance() {
    const list = document.getElementById('attendance-list');
    if (!list) return;

    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const todayIndex = new Date().getDay();
    const todayKey = days[todayIndex];

    // Temporarily disabled for testing (Weekend support)
    /*
    if (todayIndex === 0 || todayIndex === 6) {
        smoothUpdate(list, `<div class="empty-state">Wochenende! 🍿</div>`);
        return;
    }
    */

    const presentStudents = students.filter(s => s.attendance && s.attendance[todayKey]);

    if (presentStudents.length === 0) {
        smoothUpdate(list, `<div class="empty-state">Heute ist noch keiner da. 🤔</div>`);
        return;
    }

    const html = presentStudents.map(s => {
        const avatar = s.avatar || s.name.charAt(0).toUpperCase();
        
        // Map badge IDs to emojis
        const badgeEmojis = (s.badges || []).map(bid => {
            const b = badges.find(x => x.id === bid);
            return b ? `<span class="attendance-badge-icon" title="${b.name}">${b.emoji}</span>` : '';
        }).join('');

        const timeClass = (s.pickupTime || '15:30').replace(':', '');
        return `
            <div class="attendance-item">
                <div class="attendance-avatar">${avatar}</div>
                <div class="attendance-name">
                    <span class="attendance-name-text">${s.name.split(' ')[0]}</span>
                    <div class="attendance-badges">${badgeEmojis}</div>
                </div>
                <span class="attendance-time-tag time-${timeClass}">${s.pickupTime || '15:30'}</span>
            </div>
        `;
    }).join('');

    smoothUpdate(list, html);
}

// ── BADGE GALLERY (Motivation) ─────────────────
const MOTIVATIONAL_BADGES = [
    { icon: "🤝", name: "Ehren-Buddy", desc: "Ich helfe anderen ohne Aufforderung!" },
    { icon: "💎", name: "Vibe-Master", desc: "Ich sorge für gute Stimmung!" },
    { icon: "🛡️", name: "Fairness-Wächter", desc: "Ich bin fair und ehrlich!" },
    { icon: "🎨", name: "Pixel-Picasso", desc: "Ich erschaffe kreative Meisterwerke!" },
    { icon: "🚀", name: "Master-Engineer", desc: "Ich baue die krassesten Konstruktionen!" },
    { icon: "🧠", name: "Brainiac", desc: "Ich löse jedes Rätsel blitzschnell!" },
    { icon: "⚡", name: "High-Speed", desc: "Ich erledige Aufgaben besonders effizient!" },
    { icon: "🧘", name: "Zen-Meister", desc: "Ich bleibe auch bei Trubel entspannt!" },
    { icon: "🔥", name: "Goat", desc: "Ich gebe heute alles für die Gruppe!" },
    { icon: "🏅", name: "Abzeichen-Tipp", desc: "Zeig dich positiv und hol dir coole Badges!" }
];
let badgeIndex = 0;

function renderBadgeGalerie() {
    const iconEl = document.getElementById('badge-display-icon');
    const nameEl = document.getElementById('badge-display-name');
    const descEl = document.getElementById('badge-display-desc');
    if (!iconEl || !nameEl || !descEl) return;

    // Use actual badges from DB if available, otherwise fallback to defaults
    const sourceBadges = (badges && badges.length > 0) ? badges : [
        { emoji: "🤝", name: "Ehren-Buddy", desc: "Ich helfe anderen ohne Aufforderung!" },
        { emoji: "💎", name: "Vibe-Master", desc: "Ich sorge für gute Stimmung!" },
        { emoji: "🛡️", name: "Fairness-Wächter", desc: "Ich bin fair und ehrlich!" },
        { emoji: "🎨", name: "Pixel-Picasso", desc: "Ich erschaffe kreative Meisterwerke!" },
        { emoji: "🚀", name: "Master-Engineer", desc: "Ich baue die krassesten Konstruktionen!" },
        { emoji: "🧠", name: "Brainiac", desc: "Ich löse jedes Rätsel blitzschnell!" },
        { icon: "⚡", name: "High-Speed", desc: "Ich erledige Aufgaben besonders effizient!" },
        { icon: "🧘", name: "Zen-Meister", desc: "Ich bleibe auch bei Trubel entspannt!" },
        { icon: "🔥", name: "Goat", desc: "Ich gebe heute alles für die Gruppe!" }
    ];

    // Combine with a static tip item
    const galleryItems = [...sourceBadges, { emoji: "💡", name: "Pro-Tipp", desc: "Hilf anderen und sammle EHRE!" }];

    // Pick next item
    const item = galleryItems[badgeIndex % galleryItems.length];
    badgeIndex++;

    // Smooth update with fade
    const parent = document.getElementById('badge-refresh-area');
    if (parent) {
        parent.style.opacity = '0';
        setTimeout(() => {
            iconEl.textContent = item.emoji || item.icon;
            nameEl.textContent = item.name;
            descEl.textContent = item.description || item.desc || "-";
            parent.style.opacity = '1';
        }, 600);
    }
}

// ── BIRTHDAY MODE ──────────────────────────────
let birthdayModeActive = false;
let birthdayInterval = null;
let goalInterval = null;

function checkBirthdayMode() {
    const today = new Date();
    const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const hasToday = students.some(s => {
        if (!s.birthday) return false;
        const bMD = s.birthday.substring(5); // MM-DD
        return bMD === todayMD;
    });

    const titleEl = document.getElementById('bday-title');
    const iconEl = document.getElementById('bday-icon');

    if (hasToday && !birthdayModeActive) {
        birthdayModeActive = true;
        document.body.classList.add('birthday-mode');
        if (titleEl) titleEl.textContent = 'HEUTE GEBURTSTAG!';
        if (iconEl) iconEl.textContent = '🎂';
        startConfetti();
    } else if (!hasToday && birthdayModeActive) {
        birthdayModeActive = false;
        document.body.classList.remove('birthday-mode');
        if (titleEl) titleEl.textContent = 'GEBURTSTAGE';
        if (iconEl) iconEl.textContent = '🎈';
        stopConfetti();
    }
}

function startConfetti(isGoal = false) {
    const colors = isGoal ? ['#3b82f6', '#8b5cf6', '#3b82f6', '#8b5cf6', '#ffffff'] : ['#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#3b82f6', '#ef4444'];
    
    // Stop previous of same type
    if (isGoal) { if (goalInterval) clearInterval(goalInterval); }
    else { if (birthdayInterval) clearInterval(birthdayInterval); }

    const interval = setInterval(() => {
        const el = document.createElement('div');
        el.className = 'birthday-confetti'; // CSS is generic enough
        el.style.left = Math.random() * 100 + 'vw';
        el.style.background = colors[Math.floor(Math.random() * colors.length)];
        const dur = (Math.random() * 2 + 2).toFixed(1) + 's';
        el.style.animationDuration = dur;
        el.style.width = el.style.height = (Math.random() * 8 + 8) + 'px';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), parseFloat(dur) * 1000 + 100);
    }, isGoal ? 150 : 250); // Goal is faster!

    if (isGoal) goalInterval = interval;
    else birthdayInterval = interval;
}

function stopConfetti(isGoal = false) {
    if (isGoal) {
        if (goalInterval) { clearInterval(goalInterval); goalInterval = null; }
    } else {
        if (birthdayInterval) { clearInterval(birthdayInterval); birthdayInterval = null; }
    }
}


// ── KIDS: SCROLL BAND ─────────────────────────
function renderKids() {
    const inner = document.getElementById('scroll-band-inner');
    if (!inner || students.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const wDay = today.getDay() || 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - wDay + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    // Sort by: today first → this week → upcoming birthday order
    const sorted = [...students].sort((a, b) => {
        const getScore = (s) => {
            if (!s.birthday) return Infinity;
            const [, m, d] = s.birthday.split('-').map(Number);
            let bday = new Date(today.getFullYear(), m - 1, d);
            if (bday < today) bday = new Date(today.getFullYear() + 1, m - 1, d);
            return Math.round((bday - today) / 86400000);
        };
        const sA = getScore(a);
        const sB = getScore(b);
        if (sA !== sB) return sA - sB;
        return a.name.localeCompare(b.name);
    });

    const makeCard = (s) => {
        let isToday = false, isThisWeek = false, dateStr = '', daysLabel = '';
        if (s.birthday) {
            const [, m, d] = s.birthday.split('-').map(Number);
            let bday = new Date(today.getFullYear(), m - 1, d);
            isToday = bday.toDateString() === today.toDateString();
            isThisWeek = bday >= monday && bday <= sunday;
            dateStr = `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
            if (bday < today) bday = new Date(today.getFullYear() + 1, m - 1, d);
            const days = Math.round((bday - today) / 86400000);
            daysLabel = isToday ? '🎂 HEUTE!' : `in ${days} Tagen`;
        }
        const cls = isToday ? 'today' : isThisWeek ? 'upcoming' : '';
        const badgePill = isToday
            ? `<div class="kid-card-badge today-badge">HEUTE!</div>`
            : isThisWeek
                ? `<div class="kid-card-badge" style="background:rgba(236,72,153,0.1);color:#f9a8d4;border:1px solid rgba(236,72,153,0.3);">diese Woche</div>`
                : '';

        const studentBadgeEmojis = (s.badges || [])
            .map(bid => { const b = badges.find(x => x.id === bid); return b ? b.emoji : ''; })
            .filter(Boolean).join(' ');

        return `
            <div class="kid-card ${cls}" style="margin-bottom:10px;">
                <div class="kid-card-avatar">${s.avatar || s.name.charAt(0)}</div>
                <div class="kid-card-info">
                    <div class="kid-card-name">${s.name}${studentBadgeEmojis ? ' <span style="font-size:0.85em;">' + studentBadgeEmojis + '</span>' : ''}</div>
                    <div class="kid-card-date">${dateStr}${dateStr && daysLabel ? ' · ' + daysLabel : daysLabel}</div>
                </div>
                ${badgePill}
            </div>`;
    };

    // Ensure we have enough copies to fill the screen for a perfect seamless loop!
    const copiesNeeded = Math.ceil(15 / Math.max(1, sorted.length));
    let halfItems = [];
    for (let i = 0; i < copiesNeeded; i++) halfItems.push(...sorted);

    const halfHtml = halfItems.map(makeCard).join('');
    // html contains EXACTLY two identical DOM halves
    const html = halfHtml + halfHtml;

    // Total duration for one half to scroll
    const duration = `${halfItems.length * 3.5}s`;
    smoothUpdate(inner, html, { animDuration: duration, scrolling: true });
}


// ── COUNTDOWN ──────────────────────────────────
function renderCountdown() {
    const pill = document.getElementById('countdown-text');
    if (!pill) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = students
        .filter(s => s.birthday)
        .map(s => {
            const [, m, d] = s.birthday.split('-').map(Number);
            let bday = new Date(today.getFullYear(), m - 1, d);
            if (bday < today) bday = new Date(today.getFullYear() + 1, m - 1, d);
            const days = Math.round((bday - today) / 86400000);
            return { name: s.name.split(' ')[0], days, isToday: days === 0 };
        })
        .sort((a, b) => a.days - b.days);

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

// ── FILMTAG ────────────────────────────────────
function renderFilmtag() {
    const gr = settings.groupReward;
    const centerCol = document.getElementById('center-column');

    // Hide if no reward or progress is 0 (and not yet approved)
    if (!gr || (gr.current === 0 && !gr.isApproved)) {
        if (centerCol) centerCol.classList.add('filmtag-hidden');
        return;
    }

    // Show and update
    if (centerCol) centerCol.classList.remove('filmtag-hidden');

    const titleEl = document.getElementById('filmtag-title');
    const currentEl = document.getElementById('filmtag-current');
    const targetEl = document.getElementById('filmtag-target');
    const barEl = document.getElementById('filmtag-bar');
    const statusEl = document.getElementById('filmtag-status');

    if (titleEl) titleEl.textContent = `${gr.icon || '🎬'} ${gr.title || 'Filmtag'}`;
    if (currentEl) currentEl.textContent = gr.current || 0;
    if (targetEl) targetEl.textContent = gr.target || '?';
    
    const pct = Math.min(100, ((gr.current || 0) / (gr.target || 1)) * 100);
    if (barEl) barEl.style.width = `${pct}%`;
    
    const left = (gr.target || 0) - (gr.current || 0);

    let statusHtml = '';
    if (gr.isApproved) {
        statusHtml = `<span style="color:#10b981; font-size:1.1rem; font-weight:900;">🎉 Juhuuu! Filmtag genehmigt! 🍿</span>`;
    } else if (left <= 0) {
        statusHtml = `<span style="color:#10b981">🎉 Ziel erreicht! Genehmigung ausstehend.</span>`;
    } else {
        statusHtml = `Noch <strong>${left}</strong> Stempel bis zum Ziel 🎯`;
    }

    if (statusEl) statusEl.innerHTML = statusHtml;
}

function showGoalCelebration(title = "Filmtag") {
    const overlay = document.getElementById('celebration-overlay');
    if (!overlay) return;

    const phrases = [
        "ABSOLUTE EHRE! 🏆🎬🍿",
        "MACHER-MODUS AKTIVIERT! 🔥📽️",
        "WIR SIND DIE GOATS! 🐐👑🎞️",
        "LÄUFT BEI UNS! 👟🎞️🍿",
        "KOMPLETT WILD! 🌪️🎬✨",
        "BODENLOS GUT! 📉🎬🍿",
        "SIUUU! DAS ZIEL IST DA! ⚽🎥",
        "WIRKLICH GEHOBEN! 🛰️🎞️🍿",
        "KEINE CAP! LEGENDÄR! 🧢🏆"
    ];
    const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];

    // Update text
    const textEl = overlay.querySelector('.celebration-text');
    if (textEl) {
        textEl.textContent = `${title.toUpperCase()}: ${randomPhrase}`;
    }

    // Show overlay
    overlay.classList.add('active');
    
    // Intense Confetti (type: Goal)
    startConfetti(true);
    
    // Auto-hide after 20 seconds
    setTimeout(() => {
        overlay.classList.remove('active');
        stopConfetti(true); // Stop only goal confetti
    }, 20000);
}

// ── TIME-BASED ANNOUNCEMENTS ──────────────────
function checkTimeAlarms(h, m) {
    const timeKey = `${h}:${m}`;
    if (_lastAlarmKey === timeKey) return; // Already triggered this minute

    // ALARM 1: 15:30 - Departure Time
    if (timeKey === '15:30') {
        _lastAlarmKey = timeKey;
        showAnnouncement(
            "AB NACH HAUSE! 👋🏠",
            "Alle 15:30 Kinder dürfen jetzt heimgehen. Bis morgen!",
            "👋",
            120000 // 2 minutes
        );
        playTimeSound('../audio/zeit1.mp3');
    }
    
    // ALARM 2: 16:25 - Warning for 16:30 departure
    if (timeKey === '16:25') {
        _lastAlarmKey = timeKey;
        showAnnouncement(
            "VORBEREITEN! 🎒⏳",
            "In 5 Minuten ist Schluss für heute! Alle 16:30 Kinder können sich gleich bereit machen.",
            "🎒",
            180000 // 3 minutes
        );
    }

    // ALARM 3: 16:30 - Final Departure
    if (timeKey === '16:30') {
        _lastAlarmKey = timeKey;
        showAnnouncement(
            "FEIERABEND! 🌟🎬",
            "Alle Kinder dürfen jetzt heimgehen. Wir wünschen einen schönen Feierabend!",
            "🌟",
            120000 // 2 minutes
        );
        playTimeSound('../audio/zeit2.mp3');
    }
}

function showAnnouncement(title, text, emoji, duration = 30000) {
    const overlay = document.getElementById('announcement-overlay');
    const titleEl = document.getElementById('announcement-title');
    const textEl = document.getElementById('announcement-text');
    const emojiEl = document.getElementById('announcement-emoji');
    
    if (!overlay || !titleEl || !textEl || !emojiEl) return;

    titleEl.textContent = title;
    textEl.textContent = text;
    emojiEl.textContent = emoji;

    overlay.classList.add('active');
    
    // Optional: Play a subtle sound or trigger light confetti if desired
    // startConfetti(false); 

    setTimeout(() => {
        overlay.classList.remove('active');
    }, duration);
}



// ── PROJECTS ──────────────────────────────────
function renderProjects() {
    const el = document.getElementById('projects-list');
    if (!el) return;
    const txt = settings.currentProjects || "Keine aktuellen Projekte.";
    el.innerHTML = formatList(txt);
}

// ── UPCOMING PROJECTS ─────────────────────────
function renderUpcomingProjects() {
    const el = document.getElementById('upcoming-projects-list');
    if (!el) return;
    const txt = settings.upcomingProjects || "Keine kommenden Projekte geplant.";
    el.innerHTML = formatList(txt);
}

// ── DAILY NOTES ───────────────────────────────
function renderDailyNotes() {
    const el = document.getElementById('daily-notes-list');
    if (!el) return;

    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const todayEvents = events.filter(e => e.date === today);
    
    // Sort events by time
    todayEvents.sort((a, b) => a.time.localeCompare(b.time));

    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let html = '';

    // Render dynamic events as list items
    if (todayEvents.length > 0) {
        html += todayEvents.map(e => {
            const [h, m] = e.time.split(':').map(Number);
            const eventMinutes = h * 60 + m;
            const isPassed = (currentMinutes > eventMinutes + 5);
            return `<div class="${isPassed ? 'is-passed' : ''}" style="margin-bottom: 2px;">• <span style="color:var(--primary-light);">🕒 ${e.time}</span> <strong style="color:white;">${e.studentName}:</strong> <span style="color: rgba(255,255,255,0.95);">${e.text}</span></div>`;
        }).join('');
    }

    // Render static notes (the ones from system settings)
    if (settings.dailyNotes && settings.dailyNotes.trim()) {
        // If we already have appointments, add a small gap
        if (html) html += '<div style="margin-top: 6px;"></div>';
        html += `<div class="static-daily-notes">${formatList(settings.dailyNotes)}</div>`;
    }

    if (!html.trim()) {
        html = `<div style="color:var(--text-muted); font-style:italic;">Keine besonderen Notizen für heute.</div>`;
    }

    el.innerHTML = html;
}

// ── TODAY PLAN ────────────────────────────────
function renderTodayPlan() {
    const el = document.getElementById('today-plan-list');
    if (!el) return;

    const txt = settings.todayPlan || "Noch kein Plan für heute eingetragen.";
    el.innerHTML = formatList(txt);
}


// ── VIP ────────────────────────────────────────
function renderVIPs() {
    const el = document.getElementById('vip-list');
    const vipDuration = settings.vipDurationDays || 3;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const vips = students.filter(s => s.vip && s.vip.active);

    if (vips.length === 0) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">⭐</div><span>Kein aktiver VIP</span></div>`;
        return;
    }

    el.innerHTML = vips.map(s => {
        let dayText = '';
        if (s.vip.grantedAt) {
            const g = new Date(s.vip.grantedAt);
            g.setHours(0, 0, 0, 0);
            const diff = Math.floor((today - g) / 86400000) + 1;
            const left = vipDuration - diff + 1;
            dayText = left <= 1 ? '🔴 Letzter Tag!' : `Tag ${diff} / ${vipDuration}`;
        }
        return `
            <div class="vip-big fade-in">
                <div class="vip-star">⭐</div>
                <div class="vip-avatar-big">${s.avatar || s.name.charAt(0)}</div>
                <div class="vip-info-horizontal">
                    <div class="vip-name-big">${s.name}</div>
                    ${dayText ? `<div class="vip-days-big" style="width:fit-content;">${dayText}</div>` : ''}
                </div>
            </div>`;
    }).join('');
}

// ── LIST FORMATTER HELPER ──────────────────────
function formatList(txt) {
    if (!txt || typeof txt !== 'string') return txt;
    return txt.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) ? line : `• ${line}`)
        .join('<br>');
}

// ── TICKER (RAF-based, never resets) ───────────────────────────────
// Pixel position for the ticker scroll — persists across content updates.
let _tickerPos = 0;
let _tickerRAF = null;
let _tickerHash = null;

// Build ticker display items from current data
function buildTickerItems() {
    const items = [];
    const cutoff = Date.now() - 72 * 3600 * 1000; // last 3 days
    students.forEach(s => {
        (s.history || []).forEach(h => {
            if (!h.date || !h.reason) return;
            if (new Date(h.date).getTime() < cutoff) return;
            items.push({
                name: s.name.split(' ')[0],
                reason: h.reason,
                date: h.date,
                emoji: h.emoji || '▸'
            });
        });
    });
    items.sort((a, b) => {
        const d = new Date(b.date) - new Date(a.date);
        return d !== 0 ? d : (a.name + a.reason).localeCompare(b.name + b.reason);
    });

    const display = items
        .filter(it => it.reason !== 'Admin-Korrektur' && !it.reason.toLowerCase().includes('entfernt'))
        .slice(0, 20);

    const stable = [...students].sort((a, b) => a.name.localeCompare(b.name));
    stable.filter(s => s.vip && s.vip.active).forEach(s => {
        display.unshift({ name: s.name.split(' ')[0], reason: '⭐ VIP-Status aktiv', emoji: '👑' });
    });
    stable.forEach(s => {
        if (s.badges && s.badges.length > 0) {
            [...s.badges].sort().forEach(bid => {
                const bDef = badges.find(b => String(b.id) === String(bid));
                if (bDef) display.push({ name: s.name.split(' ')[0], reason: `Abzeichen "${bDef.name}"`, emoji: bDef.emoji });
            });
        }
    });
    if (display.length === 0) display.push({ name: 'NACHMI', reason: '🌟 Noch keine Aktivitäten', emoji: '📢' });
    return display;
}

// Stable hash — only re-render DOM when data actually changed
function getTickerHash() {
    return students.map(s => {
        const hist = (s.history || []).filter(h => h.date && h.reason && h.reason !== 'Admin-Korrektur' && !h.reason.toLowerCase().includes('entfernt')).map(h => `${h.date}|${h.reason}`).join(',');
        return `${s.id}:${hist}:${(s.vip && s.vip.active) ? 1 : 0}:${[...(s.badges || [])].sort().join(',')}`;
    }).join(';');
}

// RAF loop — runs forever, pixel-perfect, no CSS animation involved
function tickerLoop() {
    const scroll = document.getElementById('ticker-scroll');
    if (!scroll) { _tickerRAF = requestAnimationFrame(tickerLoop); return; }

    const halfW = scroll.scrollWidth / 2;
    if (halfW > 0) {
        _tickerPos += 0.7; // px per frame (~42px/s at 60fps)
        if (_tickerPos >= halfW) _tickerPos -= halfW; // seamless modulo wrap
        scroll.style.transform = `translateX(-${_tickerPos}px)`;
    }
    _tickerRAF = requestAnimationFrame(tickerLoop);
}

function renderTicker() {
    const scroll = document.getElementById('ticker-scroll');
    if (!scroll) return;

    // Only rebuild DOM if data actually changed
    const hash = getTickerHash();
    if (hash === _tickerHash) return;
    _tickerHash = hash;

    const display = buildTickerItems();

    // Enough copies so the total width >> viewport width for seamless wrap
    const copies = Math.ceil(20 / Math.max(1, display.length)) + 1;
    const half = [];
    for (let i = 0; i < copies; i++) half.push(...display);

    const halfHtml = half.map(it => `
        <div class="ticker-item" style="font-size:1.15em;">
            <span class="t-icon">${it.emoji}</span>
            <span class="t-name">${it.name}</span>
            <span>${it.reason}</span>
        </div>`).join('');

    // Two identical halves — _tickerPos modulo halfW keeps the loop invisible
    scroll.innerHTML = halfHtml + halfHtml;
    // NOTE: we do NOT touch scroll.style.transform here — the RAF loop handles it
}

// Start the RAF loop once (never stops)
function startTickerLoop() {
    if (_tickerRAF) return;
    _tickerRAF = requestAnimationFrame(tickerLoop);
}

// ── INIT ───────────────────────────────────────
createParticles();
updateClock();
setInterval(updateClock, 1000);

fetchData();
setInterval(fetchData, 60000); // Polling every 60s (bundled) to save API requests

// Start the ticker RAF loop immediately (it runs forever)
startTickerLoop();

// ── FILMTAG LIVE POLL (every 5s) ───────────────
// Note: fetchFilmtagLive removed to save requests, settings are now part of fetchData sync.
// setInterval(fetchFilmtagLive, 5000);

window.addEventListener('resize', () => {
    if (students.length) renderKids();
});

// ── TAMAGOTCHI: PIXEL ART DATA ─────────────────
const TAMA_SIZE = 12; // Back to 12x12 (Retro Coarse Pixel Look)
const PET_FRAMES = {
    baby: {
        neutral: [
            "............",
            "............",
            "..PP....PP..",
            ".PPPP..PPPP.",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BBEEBBBBEEBB", // White eyes for happy/neutral
            "BBBBBBBBBBBB",
            "DBBBMMMMBBBD", // Small smile
            "DDBBBBBBBBDD",
            ".DDDDDDDDDD.",
            "..BB....BB.."
        ],
        happy: [
            "............",
            "............",
            "..PP....PP..",
            ".PPPP..PPPP.",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BEEEBBBBEEEB", // Corrected eye symmetry (3 each)
            "BBBBBBBBBBBB",
            "DBBBBBBBBBBD",
            "DBBBMMMMBBBD",
            ".DDDDDDDDDD.",
            "..BB....BB.."
        ],
        blink: [
            "............",
            "............",
            "..PP....PP..",
            ".PPPP..PPPP.",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BBDDBBBBDDBB",
            "BBBBBBBBBBBB",
            "BBBBMMMMBBBB",
            "BBBBBBBBBBBB",
            ".DDDDDDDDDD.",
            "..BB....BB.."
        ],
        sad: [
            "............",
            "............",
            "..PP....PP..",
            ".PPPP..PPPP.",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BBDDBBBBDDBB", // Symmetrical dark dots
            "BBBBBBBBBBBB",
            "DBBBMMMMBBBD",
            "DBBMM..MMBBD",
            ".DDDDDDDDDD.",
            "..BB....BB.."
        ],
        sleep: [
            "............",
            "............",
            "..PP....PP..",
            ".PPPP..PPPP.",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BBDDBBBBDDBB",
            "BBBBBBBBBBBB",
            "DBBBBBBBBBBD",
            "DDBBBBBBBBDD",
            ".DDDDDDDDDD.",
            "..BB....BB.."
        ],
        bored: [
            "............",
            "............",
            "..PP....PP..",
            ".PPPP..PPPP.",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BBEEBBBBEEBB",
            "BBBBBBBBBBBB",
            "DBBBBBBBBBBD",
            "DDBBMMMMBBDD",
            ".DDDDDDDDDD.",
            "..BB....BB.."
        ],
        dead: [
            "............",
            "............",
            "..PP....PP..",
            ".PPPP..PPPP.",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BDEBDBBDEBDB", // X eyes (using dark pixels)
            "BBDBBBBBDBBB",
            "DBBBBBBBBBBD",
            "DDBBMMMMBBDD",
            ".DDDDDDDDDD.",
            "..BB....BB.."
        ]
    },
    adult: {
        neutral: [
            "....PPPP....",
            "...PPPPPP...",
            "..PPPPPPPP..",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BBEEBBBBEEBB",
            "BBBBBBBBBBBB",
            "BBBBMMMMBBBB",
            "BBBBBBBBBBBB",
            "DBBBBBBBBBBD",
            "DDBBBBBBBBDD",
            ".DDDDDDDDDD."
        ],
        happy: [
            "....PPPP....",
            "...PPPPPP...",
            "..PPPPPPPP..",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BEEEBBBBEEEB", // Symmetrical happy eyes
            "BBBBBBBBBBBB",
            "BBMMMMMMMMBB",
            "BBBBMMMMBBBB",
            "DBBBBBBBBBBD",
            "DDBBBBBBBBDD",
            ".DDDDDDDDDD."
        ],
        sad: [
            "....PPPP....",
            "...PPPPPP...",
            "..PPPPPPPP..",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BBDDBBBBDDBB",
            "BBBBBBBBBBBB",
            "BBMMBBBBMMBB", // Frowning corners
            "BBBBMMMMBBBB",
            "DBBBBBBBBBBD",
            "DDBBBBBBBBDD",
            ".DDDDDDDDDD."
        ],
        blink: [
            "....PPPP....",
            "...PPPPPP...",
            "..PPPPPPPP..",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BBDDBBBBDDBB", // Symmetrical blinking
            "BBBBBBBBBBBB",
            "BBBBMMMMBBBB",
            "BBBBBBBBBBBB",
            "DBBBBBBBBBBD",
            "DDBBBBBBBBDD",
            ".DDDDDDDDDD."
        ],
        dead: [
            "....PPPP....",
            "...PPPPPP...",
            "..PPPPPPPP..",
            ".BBBBBBBBBB.",
            "BBBBBBBBBBBB",
            "BDEBDBBDEBDB", // X eyes
            "BBDBBBBBDBBB",
            "BBBBMMMMBBBB",
            "BBBBBBBBBBBB",
            "DBBBBBBBBBBD",
            "DDBBBBBBBBDD",
            ".DDDDDDDDDD."
        ]
    },
    egg: {
        neutral: [
            "............",
            "............",
            "....WWWW....",
            "...WWWWWW...",
            "..WWWWWWWW..",
            "..WWWWWWWW..",
            "..WWWWWWWW..",
            "..WWWWWWWW..",
            "...WWWWWW...",
            "....WWWW....",
            "............",
            "............"
        ]
    }
};

const HAT_ASSETS = {
    hat_party: [
        "......R.....",
        ".....RRR....",
        "....RRRRR...",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_crown: [
        "...Y.Y.Y....",
        "...YYYYY....",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_cool: [
        "............",
        "............",
        ".EEEEEEEEEE.",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_detective: [
        "....DDDD....",
        "...DDDDDD...",
        ".DDDDDDDDDD.",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_top: [
        "....MMMM....",
        "....MMMM....",
        ".MMMMMMMMMM.",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_wizard: [
        ".....AA.....",
        "....AAAA....",
        "...AAAAAA...",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_ninja: [
        "............",
        "............",
        "............",
        "MMMMMMMMMMMM",
        "MM..WWWW..MM",
        "MMMMMMMMMMMM",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_bow: [
        "............",
        "....RR.RR...",
        ".....RRR....",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_viking: [
        "W..........W",
        "WW........WW",
        ".DDDDDDDDDD.",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_santahat: [
        ".......WW...",
        "......RRRR..",
        ".....RRRRRR.",
        "....WWWWWWWW",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_cowboy: [
        "............",
        "....DDDD....",
        "...DDDDDD...",
        "DDDDDDDDDDDD",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_chef: [
        "...WWWWW....",
        "...WWWWW....",
        "..WWWWWWW...",
        "..WWWWWWW...",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_headphones: [
        "....PPPP....",
        "...P....P...",
        "..P......P..",
        ".PP......PP.",
        ".PP......PP.",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_straw: [
        "............",
        "....YYYY....",
        "...YYYYYY...",
        "YYYYYYYYYYYY",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_graduation: [
        "............",
        ".MMMMMMMMMM.",
        "....MMMM....",
        ".....MM.....",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ],
    hat_eyepatch: [
        "............",
        "............",
        "....MMMMM...",
        "MMMMMMMMMMMM",
        "....MMMMM...",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............"
    ]
};

const POOP_ASSET = [
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
    "......YY....",
    ".....YYYY...",
    "....YYYYYY.."
];

let _tearInterval = null;

function spawnTear() {
    const container = document.getElementById('tama-zzz-container');
    if (!container) return;
    
    const spray = (side) => {
        const t = document.createElement('div');
        t.className = 'tear-particle';
        t.textContent = '💧';
        
        // Horizontal spread direction
        const vx = (side === 'left') ? -(Math.random() * 40 + 20) : (Math.random() * 40 + 20);
        t.style.setProperty('--vx', `${vx}px`);
        
        t.style.left = (side === 'left' ? 40 : 55) + '%';
        t.style.bottom = '55px';
        container.appendChild(t);
        setTimeout(() => t.remove(), 1500);
    };

    spray('left');
    spray('right');
    
    // Low love -> Double spray
    if (settings.tamagotchi && settings.tamagotchi.stats.love < 10) {
        setTimeout(() => {
            spray('left');
            spray('right');
        }, 300);
    }
}

// ── TAMAGOTCHI INTERACTION HELPERS ────────────────
let _isInteractionActive = false;
let _zzzInterval = null;
let _lastActionTimeSeen = null; // Track fresh interactions village
let _awayOffset = { x: 0, y: -20, scale: 0.6 }; // Reduced distance and increased scale (closer)

function updateWeatherView() {
    const weather = settings.weather;
    const overlay = document.getElementById('weather-overlay');
    const bgImg = document.getElementById('tama-bg-img');
    if (!overlay || !weather) return;

    overlay.className = 'tama-weather-overlay'; // Reset
    
    // weather_code mappings (Simplified Open-Meteo)
    // 0: Clear, 1-3: Partly Cloudy, 45-48: Fog
    // 51-67: Rain/Drizzle, 71-77: Snow, 80-82: Showers
    const code = weather.code || 0;
    
    if (code >= 71 && code <= 77) {
        overlay.classList.add('weather-snow');
        if (bgImg) {
            bgImg.src = 'assets/tama_bg.png'; // No snow BG yet
            bgImg.style.filter = 'brightness(0.8) saturate(0.5) sepia(0.2)';
        }
    } else if (code >= 51 && code <= 82) {
        overlay.classList.add('weather-rain');
        if (bgImg) {
            bgImg.src = 'assets/tama_bg_rain.png';
            bgImg.style.filter = 'brightness(0.6) saturate(0.8)';
        }
    } else if (code <= 3) {
        overlay.classList.add('weather-sun');
        if (bgImg) {
            bgImg.src = 'assets/tama_bg.png';
            bgImg.style.filter = 'brightness(1.1) saturate(1.2)';
        }
    } else {
        if (bgImg) {
            bgImg.src = 'assets/tama_bg.png';
            bgImg.style.filter = 'brightness(0.9)';
        }
    }
}

let _bubbleTimeout = null;
function showSpeechBubble(text, duration = 4000) {
    const bubble = document.getElementById('tama-bubble');
    if (!bubble) return;
    
    if (_bubbleTimeout) clearTimeout(_bubbleTimeout);
    
    bubble.textContent = text;
    bubble.classList.add('active');
    
    _bubbleTimeout = setTimeout(() => {
        bubble.classList.remove('active');
        _bubbleTimeout = null;
    }, duration);
}

function triggerFeedAnimation(foodEmoji = '🍎') {
    const gridEl = document.getElementById('tama-pixel-grid');
    const food = document.createElement('div');
    food.className = 'pixel-food';
    food.textContent = foodEmoji;
    gridEl.appendChild(food);
    
    setTimeout(() => food.remove(), 1500);
}

function triggerBrushAnimation() {
    const gridEl = document.getElementById('tama-pixel-grid');
    const screen = document.querySelector('.tama-screen');
    const container = document.getElementById('tama-item-container');
    if (!gridEl || !screen || !container) return;

    // 1. Show Brush Emoji to the side
    const b = document.createElement('div');
    b.className = 'brush-fx';
    b.textContent = '🪥';
    
    const rect = gridEl.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const relativeX = (rect.left - screenRect.left) + (rect.width / 2);
    
    // Position to the side
    b.style.left = `calc(50% + ${relativeX - (screenRect.width/2) - 40}px)`;
    container.appendChild(b);
    setTimeout(() => b.remove(), 2500);

    // 2. Trigger "Foam" bubbles on the pet
    triggerBubbleEffect(30, false, relativeX); // Regular bubbles serve as "foam"
}

function triggerRecycleAnimation() {
    const gridEl = document.getElementById('tama-pixel-grid');
    const r = document.createElement('div');
    r.className = 'recycle-fx';
    r.innerHTML = '🌍♻️';
    gridEl.appendChild(r);
    setTimeout(() => r.remove(), 2000);
}

function spawnZzz() {
    const container = document.getElementById('tama-zzz-container');
    if (!container) return;
    const z = document.createElement('div');
    z.className = 'zzz-particle';
    z.textContent = 'Z';
    // Offset from head
    z.style.left = (Math.random() * 20 + 45) + '%';
    z.style.bottom = '60px'; /* Lowered from 90px */
    container.appendChild(z);
    setTimeout(() => z.remove(), 3000);
}

function triggerPlayAnimation() {
    if (_isInteractionActive) return;
    _isInteractionActive = true;
    
    const itemContainer = document.getElementById('tama-item-container');
    const gridEl = document.getElementById('tama-pixel-grid');
    if (!itemContainer || !gridEl) return;

    // Add Ball
    const items = ['⚽', '🧶', '🎾'];
    const item = document.createElement('div');
    item.className = 'tama-play-item';
    item.textContent = items[Math.floor(Math.random() * items.length)];
    itemContainer.appendChild(item);

    // Start Chase
    gridEl.classList.add('chasing');

    setTimeout(() => {
        item.remove();
        gridEl.classList.remove('chasing');
        _isInteractionActive = false;
    }, 12000); // Play for 12 seconds
}

function triggerWaterAnimation() {
    if (_isInteractionActive) return;
    _isInteractionActive = true;

    const container = document.getElementById('tama-item-container');
    if (!container) return;

    const drinks = ['💧', '🥤', '🍼', '🧉'];
    const item = document.createElement('div');
    item.className = 'tama-water-item';
    item.textContent = drinks[Math.floor(Math.random() * drinks.length)];
    container.appendChild(item);

    setTimeout(() => {
        item.remove();
        _isInteractionActive = false;
    }, 3000);
}

function triggerLoveAnimation() {
    if (_isInteractionActive) return;
    _isInteractionActive = true;

    const container = document.getElementById('tama-heart-container');
    if (!container) return;

    const spawnHeart = () => {
        const h = document.createElement('div');
        h.className = 'heart-particle';
        h.textContent = '❤️';
        h.style.left = (Math.random() * 40 + 30) + '%';
        h.style.bottom = (Math.random() * 20 + 30) + 'px'; /* Lowered from 40px base */
        container.appendChild(h);
        setTimeout(() => h.remove(), 4000);
    };

    // Spawn multiple hearts over time
    let count = 0;
    const interval = setInterval(() => {
        spawnHeart();
        count++;
        if (count >= 12) clearInterval(interval);
    }, 400);

    setTimeout(() => {
        _isInteractionActive = false;
    }, 6000); // Love effect for 6 seconds
}

function renderTamagotchi() {
    const card = document.getElementById('tamagotchi-card');
    const tama = settings.tamagotchi;
    
    if (!tama || !card || tama.visible === false) {
        if (card) card.style.display = 'none';
        return;
    }

    const gridEl = document.getElementById('tama-pixel-grid');
    const nameEl = document.getElementById('tama-name');
    const statusEl = document.getElementById('tama-status-text');
    const bgImg = document.getElementById('tama-bg-img');

    // Ensure Background
    if (bgImg && !bgImg.src.includes('assets/')) {
        bgImg.src = 'assets/tama_bg.png';
        bgImg.onerror = () => { bgImg.style.display = 'none'; };
    }

    // 1. Initialize Grid (Force clear if size mismatch)
    if (gridEl && gridEl.children.length !== TAMA_SIZE * TAMA_SIZE) {
        gridEl.innerHTML = '';
        for (let i = 0; i < TAMA_SIZE * TAMA_SIZE; i++) {
            const px = document.createElement('div');
            px.className = 'pixel px-transparent';
            gridEl.appendChild(px);
        }
    }

    // 2. Determine Frame
    let stage = tama.stats.level >= 10 ? "adult" : "baby";
    if (tama.status === "egg") stage = "egg";
    
    let mood = "neutral";
    if (tama.status === "hatched") {
        if (tama.isSleeping) mood = "sleep";
        else if (tama.stats.hunger < 30 || tama.stats.thirst < 30 || tama.stats.love < 30) mood = "sad";
        else if (tama.stats.fun < 30) mood = "bored";
        else if (_isBlinking) mood = "blink"; // Blinking takes priority over neutral/happy
        else if (tama.stats.hunger > 80 && tama.stats.thirst > 80 && tama.stats.love > 80) mood = "happy";
    }

    const frame = (PET_FRAMES[stage] && PET_FRAMES[stage][mood]) || PET_FRAMES.baby.neutral;
    const hat = tama.currentHat ? HAT_ASSETS[tama.currentHat] : null;

    // 3. Render Frame to Grid (Including Hat Layer)
    if (gridEl) {
        const pixels = gridEl.children;
        for (let r = 0; r < TAMA_SIZE; r++) {
            for (let c = 0; c < TAMA_SIZE; c++) {
                let char = frame[r][c];
                
                // Overlay Hat if exists and pixel is transparent in base frame
                if (hat && hat[r][c] !== '.') {
                    char = hat[r][c];
                }

                const idx = r * TAMA_SIZE + c;
                let cls = "px-transparent";
                if (char === 'B') cls = "px-body";
                if (char === 'D') cls = "px-body-dark";
                if (char === 'E') cls = "px-eye";
                if (char === 'M') cls = "px-mouth";
                if (char === 'W') cls = "px-white";
                if (char === 'R') cls = "px-red";
                if (char === 'P') cls = "px-pink";
                if (char === 'Y') cls = "px-yellow";
                if (char === 'T') cls = "px-blue"; // Tears
                if (char === 'A') cls = "px-accent"; // Wizard hat or similar
                if (char === 'N') cls = "px-white"; // Nose/Mouth detail
                
                const targetCls = `pixel ${cls}`;
                if (pixels[idx] && pixels[idx].className !== targetCls) {
                    pixels[idx].className = targetCls;
                }
            }
        }
    }

    // 3.5 Render Poop
    const poopContainer = document.getElementById('poop-container');
    if (poopContainer) {
        const currentPoopCount = poopContainer.children.length;
        const targetPoopCount = tama.poopCount || 0;
        if (currentPoopCount !== targetPoopCount) {
            poopContainer.innerHTML = '';
            for (let i = 0; i < targetPoopCount; i++) {
                const wrapper = document.createElement('div');
                wrapper.className = 'poop-wrapper';
                
                // Deterministic random positions based on index so they don't jump on every sync
                // Wide spread across the whole screen width and meadow height
                const randomX = ((i * 137.5) % 94) + 3; // 3% to 97%
                const randomY = ((i * 97.3) % 100) + 5;  // 5px to 105px (on the meadow)
                
                wrapper.style.left = `${randomX}%`;
                wrapper.style.bottom = `${randomY}px`;
                wrapper.style.position = 'absolute';
                
                // Steam effect
                const steam = document.createElement('div');
                steam.className = 'poop-steam';
                steam.textContent = '♨️';
                steam.style.animationDelay = `${(i * 0.5) % 2}s`;
                
                // Poop emoji
                const p = document.createElement('div');
                p.textContent = '💩';
                p.style.fontSize = '1.2rem';
                
                wrapper.appendChild(steam);
                wrapper.appendChild(p);
                poopContainer.appendChild(wrapper);
            }
        }
    }

    // 3.6 Render Trash (Recycling task)
    const trashContainer = document.getElementById('trash-container');
    if (trashContainer) {
        const targetTrashCount = tama.trashCount || 0;
        if (trashContainer.children.length !== targetTrashCount) {
            trashContainer.innerHTML = '';
            for (let i = 0; i < targetTrashCount; i++) {
                const tr = document.createElement('div');
                tr.className = 'trash-item';
                // Deterministic positions
                const rx = ((i * 157.3) % 90) + 5;
                const ry = ((i * 113.1) % 80) + 10;
                tr.style.left = `${rx}%`;
                tr.style.bottom = `${ry}px`;
                tr.style.position = 'absolute';
                tr.style.fontSize = '1.1rem';
                // Alternate between paper and can
                tr.textContent = (i % 2 === 0) ? '📄' : '🥫';
                trashContainer.appendChild(tr);
            }
        }
    }

    // 3.7 Update Weather
    updateWeatherView();

    // 4. Update UI Text & Bars
    if (tama.status === "egg") {
        card.style.display = 'block';
        if (nameEl) nameEl.textContent = "MYSTERY EGG";
        if (statusEl) statusEl.textContent = "WACKELT...";
        gridEl.style.animation = 'tamaEggWiggle 3s ease-in-out infinite';
    } else {
        card.style.display = 'block';
        
        // Interaction logic moved to change detector below for better reliability


        // Handle Sleep (No float, Zzz)
        if (tama.isSleeping) {
            gridEl.classList.add('no-float');
            if (!_zzzInterval) {
                _zzzInterval = setInterval(spawnZzz, 2000);
            }
        } else {
            gridEl.classList.remove('no-float');
            if (_zzzInterval) {
                clearInterval(_zzzInterval);
                _zzzInterval = null;
            }
        }
        
        // Handle Tears (Love < 20)
        if (tama.stats.love < 20 && !tama.isSleeping) {
            if (!_tearInterval) {
                _tearInterval = setInterval(spawnTear, 1200);
            }
        } else {
            if (_tearInterval) {
                clearInterval(_tearInterval);
                _tearInterval = null;
            }
        }

        if (!gridEl.classList.contains('no-float') && !gridEl.classList.contains('chasing')) {
            gridEl.style.animation = 'pixelFloat 3.5s ease-in-out infinite, pixelGlow 2s ease-in-out infinite';
        } else if (gridEl.classList.contains('no-float')) {
            gridEl.style.animation = 'pixelGlow 2s ease-in-out infinite';
        }

        const hungerEl = document.getElementById('tama-hunger');
        const thirstEl = document.getElementById('tama-thirst');
        const hygieneEl = document.getElementById('tama-hygiene');
        const loveEl = document.getElementById('tama-love');
        const funEl = document.getElementById('tama-fun');
        const xpEl = document.getElementById('tama-xp');

        const hungerVal = document.getElementById('tama-hunger-val');
        const thirstVal = document.getElementById('tama-thirst-val');
        const hygieneVal = document.getElementById('tama-hygiene-val');
        const loveVal = document.getElementById('tama-love-val');
        const funVal = document.getElementById('tama-fun-val');
        const levelVal = document.getElementById('tama-level');

        const stats = tama.stats || { hunger: 50, thirst: 50, love: 50, fun: 50, hygiene: 100, xp: 0, level: 1 };

        if (hungerEl) hungerEl.style.width = `${stats.hunger}%`;
        if (thirstEl) thirstEl.style.width = `${stats.thirst}%`;
        if (hygieneEl) hygieneEl.style.width = `${stats.hygiene || 0}%`;
        if (loveEl) loveEl.style.width = `${stats.love}%`;
        if (funEl) funEl.style.width = `${stats.fun || 0}%`;

        // XP Bar
        const nextLevelXp = stats.level * 100;
        const xpPercent = Math.min(100, (stats.xp / nextLevelXp) * 100);
        if (xpEl) xpEl.style.width = `${xpPercent}%`;

        if (hungerVal) hungerVal.textContent = `${Math.round(stats.hunger)}%`;
        if (thirstVal) thirstVal.textContent = `${Math.round(stats.thirst)}%`;
        if (hygieneVal) hygieneVal.textContent = `${Math.round(stats.hygiene || 0)}%`;
        if (loveVal) loveVal.textContent = `${Math.round(stats.love)}%`;
        if (funVal) funVal.textContent = `${Math.round(stats.fun || 0)}%`;
        if (levelVal) levelVal.textContent = `Lvl ${stats.level}`;

        let statusText = "Alles super! ✨";
        if (tama.status === "dead") {
            statusText = "GEIST 👻";
            gridEl.classList.add('tama-dead');
        } else {
            gridEl.classList.remove('tama-dead');
            if (tama.isSleeping) statusText = "Schläft... 💤";
            else if (stats.hunger < 30) statusText = "Hungrig! 🍏";
            else if (stats.thirst < 30) statusText = "Durstig! 💧";
            else if (stats.fun < 30) statusText = "Langweilig... 🥱";
            else if (stats.love < 30) statusText = "Braucht Liebe ❤️";
        }
        const now = Date.now();
        // Calc inactivity relative ONLY to last interaction
        const actionTime = tama.lastActionTime ? new Date(tama.lastActionTime).getTime() : (tama.born || tama.hatchDate || now);
        const inactiveSeconds = (now - actionTime) / 1000;

        // --- Interaction Protection ---
        handleTamaActionDetection(tama);
        
        // --- Idle State Machine (Self-Entertainment) ---
        handleTamaIdleBehavior(tama, inactiveSeconds, gridEl, statusEl);
        
        if (statusEl) statusEl.textContent = statusText;
    }
}

let _idleActionStartTime = 0;
let _currentIdleAction = null;
let _idleTargetPos = { x: 0, scale: 1 };

function handleTamaIdleBehavior(tama, inactiveSeconds, gridEl, statusEl) {
    if (tama.isSleeping) {
        clearIdleState(gridEl);
        return;
    }

    // --- Tier 1: Gentle Idle Stroll (30s - 10m) ---
    if (inactiveSeconds > 30 && inactiveSeconds <= 600) {
        const now = Date.now();
        if (!_currentIdleAction || (now - _idleActionStartTime > 15000)) { // Change spot every 15s
            _idleActionStartTime = now;
            _currentIdleAction = 'stroll';
            _idleTargetPos.x = (Math.random() - 0.5) * 400; 
            _idleTargetPos.scale = 0.7 + Math.random() * 0.3;
            clearIdleState(gridEl);
            gridEl.classList.add('strolling');
        }
        
        // Depth Illusion: Higher scale = Closer (at bottom), Smaller scale = Further (higher up)
        // Screen height is 320px. Bottom 1/3 is ~106px. Base is 40px. 
        // We move up by max ~60px to stay safe.
        const verticalShift = (1 - _idleTargetPos.scale) * -150; 
        
        gridEl.style.setProperty('--tama-x', `${_idleTargetPos.x}px`);
        gridEl.style.setProperty('--tama-y', `${verticalShift}px`);
        gridEl.style.setProperty('--tama-scale', _idleTargetPos.scale);
        return;
    }

    // --- Tier 2: Self-Entertainment Actions ( > 10m) ---
    if (inactiveSeconds > 600) {
        const now = Date.now();
        
        // Every 2 minutes (120s), pick a new action
        if (!_currentIdleAction || (now - _idleActionStartTime > 120000)) {
            _idleActionStartTime = now;
            const actions = ['walk', 'flip', 'roll', 'hop', 'chill'];
            _currentIdleAction = actions[Math.floor(Math.random() * actions.length)];
            
            // Pick a random spot on the grass
            _idleTargetPos.x = (Math.random() - 0.5) * 600; // Large range
            _idleTargetPos.scale = 0.6 + Math.random() * 0.4; // Depth

            clearIdleState(gridEl);
            
            if (_currentIdleAction === 'walk') {
                gridEl.classList.add('tama-walking');
                showSpeechBubble("Ich geh mal die Wiese erkunden... 🚶‍♂️");
            } else if (_currentIdleAction === 'flip') {
                gridEl.classList.add('tama-flipping');
                showSpeechBubble("SIUUU! Schau mal! 🤸‍♂️");
            } else if (_currentIdleAction === 'roll') {
                gridEl.classList.add('tama-rolling');
                showSpeechBubble("Wiiiiieeee! 🌀");
            } else if (_currentIdleAction === 'hop') {
                gridEl.classList.add('tama-hopping');
                showSpeechBubble("Ich bin ein Gummibär! 🍬");
            } else {
                showSpeechBubble("Macher-Modus! 🔥");
            }
        }

        // Apply visual transformation for movement
        if (_currentIdleAction !== 'chill') {
            const verticalShift = (1 - _idleTargetPos.scale) * -150;
            gridEl.style.setProperty('--tama-x', `${_idleTargetPos.x}px`);
            gridEl.style.setProperty('--tama-y', `${verticalShift}px`);
            gridEl.style.setProperty('--tama-scale', _idleTargetPos.scale);
        } else {
            gridEl.style.setProperty('--tama-x', '0px');
            gridEl.style.setProperty('--tama-y', '0px');
            gridEl.style.setProperty('--tama-scale', '1');
        }
    } else {
        // Only reset if truly active (interaction within last 10s)
        if (inactiveSeconds < 10 && _currentIdleAction) {
            clearIdleState(gridEl);
            _currentIdleAction = null;
            gridEl.style.transform = 'translateX(-50%)';
        }
    }
}

function clearIdleState(gridEl) {
    if (!gridEl) return;
    gridEl.classList.remove('strolling', 'tama-walking', 'tama-flipping', 'tama-rolling', 'tama-hopping');
    gridEl.style.setProperty('--tama-x', '0px');
    gridEl.style.setProperty('--tama-y', '0px');
    gridEl.style.setProperty('--tama-scale', '1');
}

// Dedicated helper to detect and trigger action animations
function handleTamaActionDetection(tama) {
    if (!tama || !tama.lastActionTime) return;

    let shouldTrigger = false;
    if (_lastActionTimeSeen === null) {
        _lastActionTimeSeen = tama.lastActionTime || "none";
        console.log("Tamagotchi base interaction set:", _lastActionTimeSeen);
    } else if (tama.lastActionTime && tama.lastActionTime !== _lastActionTimeSeen) {
        _lastActionTimeSeen = tama.lastActionTime;
        shouldTrigger = true;
    }

    if (shouldTrigger) {
        const gridEl = document.getElementById('tama-pixel-grid');
        if (!gridEl) return;

        console.log("TAMAGOTCHI ACTION DETECTED:", tama.lastAction);

        // 1. Reset any idle/walking states if away
        clearIdleState(gridEl);
        _currentIdleAction = null; // Kill the idle cycle
        gridEl.classList.add('hopping-back');
        setTimeout(() => gridEl.classList.remove('hopping-back'), 1200);

        // 2. Trigger Specific Animation
        if (tama.lastAction === 'play') {
            triggerPlayAnimation();
            showSpeechBubble(`Juhu! 🎾`);
        } else if (tama.lastAction === 'love') {
            triggerLoveAnimation();
            showSpeechBubble(`Hab dich lieb, ${tama.lastActionStudentName || 'Abenteurer'}! ❤️`);
        } else if (tama.lastAction === 'feed') {
            const sub = (tama.lastSubAction || "").toLowerCase();
            const foodEmoji = (sub === 'donut') ? '🍩' : '🍎';
            triggerFeedAnimation(foodEmoji);
            showSpeechBubble(`Yummy! ${foodEmoji}`);
        } else if (tama.lastAction === 'water') {
            triggerWaterAnimation();
            showSpeechBubble(`Erfrischend! 💧`);
        } else if (tama.lastAction === 'clean') {
            triggerShowerAnimation();
            showSpeechBubble(`Das tat gut! 🧼🚿`);
        } else if (tama.lastAction === 'handwash') {
            triggerHandWashAnimation();
            showSpeechBubble(`Hände sind sauber! 🧼✨`);
        } else if (tama.lastAction === 'read') {
            triggerReadAnimation();
            showSpeechBubble(`Ich liebe lesen! 📖`);
        } else if (tama.lastAction === 'homework') {
            triggerHomeworkAnimation(tama.lastHomework);
        } else if (tama.lastAction === 'train') {
            showSpeechBubble(`Ich werde immer schlauer! 🧠✨`);
        }
    }
}
function triggerHandWashAnimation() {
    const gridEl = document.getElementById('tama-pixel-grid');
    const screen = document.querySelector('.tama-screen');
    if (!gridEl || !screen) return;
    
    // Get current horizontal center relative to screen
    const rect = gridEl.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const relativeX = (rect.left - screenRect.left) + (rect.width / 2);

    triggerBubbleEffect(40, false, relativeX); 
}

function triggerShowerAnimation() {
    const gridEl = document.getElementById('tama-pixel-grid');
    const screen = document.querySelector('.tama-screen');
    const container = document.getElementById('tama-item-container');
    if (!gridEl || !screen || !container) return;

    // 1. Show the Shower Emoji on the side (like food/water)
    const shower = document.createElement('div');
    shower.className = 'shower-fx';
    shower.textContent = '🚿';
    // Position it relative to the pet
    const rect = gridEl.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const relativeX = (rect.left - screenRect.left) + (rect.width / 2);
    
    // Shift slightly to the side
    shower.style.left = `calc(50% + ${relativeX - (screenRect.width/2) + 40}px)`;
    container.appendChild(shower);
    setTimeout(() => shower.remove(), 2500);

    // 2. Trigger centered bubbles/water
    triggerBubbleEffect(60, true, relativeX); 
}

function triggerBubbleEffect(count, isShower, targetX) {
    const screen = document.querySelector('.tama-screen');
    if (!screen) return;
    
    const width = screen.offsetWidth;
    // If targetX not provided, use center
    const centerX = targetX !== undefined ? targetX : (width / 2);

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const bubble = document.createElement('div');
            bubble.style.position = 'absolute';
            // Spawn NARROWLY around the pet
            const randomX = (centerX - 40) + Math.random() * 80;
            bubble.style.left = randomX + 'px';
            bubble.style.bottom = '15px';
            bubble.style.fontSize = (Math.random() * 1.5 + 0.8) + 'rem';
            bubble.style.zIndex = '14'; 
            bubble.style.pointerEvents = 'none';
            
            if (isShower) {
                const waterCodes = ['🫧', '💦', '💧', '🧼'];
                bubble.innerText = waterCodes[Math.floor(Math.random() * waterCodes.length)];
            } else {
                bubble.innerText = '🫧';
            }
            
            // Random horizontal drift
            const drift = (Math.random() - 0.5) * 40;
            const height = 140 + Math.random() * 60;

            bubble.animate([
                { transform: 'translateY(0) scale(0)', opacity: 0 },
                { transform: `translateY(-${height/2}px) translateX(${drift/2}px) scale(1.6)`, opacity: 0.9 },
                { transform: `translateY(-${height}px) translateX(${drift}px) scale(0)`, opacity: 0 }
            ], {
                duration: 1500 + Math.random() * 800,
                easing: 'ease-out'
            });
            
            screen.appendChild(bubble);
            setTimeout(() => bubble.remove(), 2500);
        }, i * (isShower ? 25 : 45));
    }
}

function triggerReadAnimation() {
    const gridEl = document.getElementById('tama-pixel-grid');
    if (!gridEl) return;
    
    const book = document.createElement('div');
    book.className = 'pixel-food'; // Reuse food styling for side-item
    book.textContent = '📖';
    gridEl.appendChild(book);
    
    setTimeout(() => book.remove(), 2500);
}

function triggerHomeworkAnimation(problem) {
    if (!problem) return;
    
    // Step 1: Thinking
    showSpeechBubble("Hm... 🤔", 2000);
    
    // Step 2: Show Problem
    setTimeout(() => {
        showSpeechBubble(`${problem.a} ${problem.op} ${problem.b} = ?`, 3000);
    }, 2000);
    
    // Step 3: Show Result
    setTimeout(() => {
        const text = `${problem.a} ${problem.op} ${problem.b} = ${problem.result}`;
        if (problem.isCorrect) {
            showSpeechBubble(`${text} 🌟 Richtig!`, 5000);
            triggerLoveAnimation(); // Celebrate
        } else {
            showSpeechBubble(`${text} 🤯 Oh nein...`, 5000);
        }
    }, 5000);
}
