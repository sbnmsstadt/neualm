const API_URL = "https://neualm-infotafel.sb-nmsstadt.workers.dev/api";

let students = [];
let settings = {};
let rewards = [];
let events = [];
let planFlipInterval = null; 
let _celebrationSignaled = false; // Prevents repeated popups
let _lastCelebrationId = null;   // Tracks last seen celebration event

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



    } catch (err) {
        console.error('Outer fetchData error:', err);
    }
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
    renderBirthdayWeek();
    renderTicker();
    renderStudentOfWeek();
    renderAttendance(); // NEW: Today's attendance list
    // renderBadgeGalerie();

    renderLernzeit(); // NEW: Lernzeit & Betreuung
    checkBirthdayMode();
    checkCelebrationMode(); // NEW: Check for group milestone celebrations
}

function renderLernzeit() {
    const lehrerEl = document.getElementById('lernzeit-lehrer');
    const uhrzeitEl = document.getElementById('lernzeit-uhrzeit');
    if (!lehrerEl || !uhrzeitEl) return;

    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const todayIndex = new Date().getDay();
    const todayKey = days[todayIndex];

    const activeTeachers = (settings.lernzeitTeachers || []).filter(t => t.days && t.days[todayKey]);

    if (activeTeachers.length > 0) {
        lehrerEl.textContent = activeTeachers.map(t => t.name).join(' & ');
    } else {
        lehrerEl.textContent = "Keine Angabe";
    }

    uhrzeitEl.textContent = `${settings.lernzeitTime || "14:30 bis 15:20"} Uhr`;
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
    const kommenList = document.getElementById('kommen-list');
    const gehenList = document.getElementById('gehen-list');
    const abwesendList = document.getElementById('abwesend-list');
    if (!kommenList || !gehenList || !abwesendList) return;

    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const todayIndex = new Date().getDay();
    const todayKey = days[todayIndex];

    const presentStudents = students.filter(s => s.attendance && s.attendance[todayKey] && !s.sick);
    const absentStudents = students.filter(s => s.sick);

    // Sort by comingTime for Kommen
    const sortedKommen = [...presentStudents].sort((a, b) => {
        const timeA = a.comingTime || '12:00';
        const timeB = b.comingTime || '12:00';
        return timeA.localeCompare(timeB) || a.name.localeCompare(b.name);
    });

    const dayIdx = todayIndex - 1;

    const getStudentBadgesForDay = (student, dayKey, idx) => {
        if (!student || !student.badges) return [];
        if (Array.isArray(student.badges)) {
            const val = student.badges[idx];
            return val ? [String(val)] : [];
        }
        if (typeof student.badges === 'object') {
            const val = student.badges[dayKey];
            if (Array.isArray(val)) {
                return val.map(String).filter(id => id !== "");
            }
            if (val) {
                return [String(val)].filter(id => id !== "");
            }
        }
        return [];
    };

    const createStudentHTML = (s, showTimeTag = true, isComing = false) => {
        const avatar = s.avatar || s.name.charAt(0).toUpperCase();
        
        const time = isComing ? (s.comingTime || '11:40') : (s.pickupTime || '15:30');
        const timeClass = time.replace(':', '');
        
        let color = '';
        let tagStyle = '';
        
        if (isComing) {
            if (timeClass === '1140') {
                color = '#10b981'; // Green
                tagStyle = 'color: #10b981; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.15);';
            } else if (timeClass === '1235') {
                color = '#0ea5e9'; // Sky Blue
                tagStyle = 'color: #0ea5e9; background: rgba(14, 165, 233, 0.08); border: 1px solid rgba(14, 165, 233, 0.15);';
            } else if (timeClass === '1330') {
                color = '#6366f1'; // Indigo
                tagStyle = 'color: #6366f1; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.15);';
            } else {
                color = '#ec4899'; // Pink (Custom)
                tagStyle = 'color: #ec4899; background: rgba(236, 72, 153, 0.12); border: 1px solid rgba(236, 72, 153, 0.25);';
            }
        } else {
            if (timeClass === '1330') {
                color = '#06b6d4'; // Cyan
                tagStyle = 'color: #06b6d4; background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.15);';
            } else if (timeClass === '1430') {
                color = '#3b82f6'; // Blue
                tagStyle = 'color: #3b82f6; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.15);';
            } else if (timeClass === '1530') {
                color = '#f59e0b'; // Amber
                tagStyle = 'color: #f59e0b; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.15);';
            } else if (timeClass === '1630') {
                color = '#f43f5e'; // Rose
                tagStyle = 'color: #f43f5e; background: rgba(244, 63, 94, 0.08); border: 1px solid rgba(244, 63, 94, 0.15);';
            } else {
                color = '#a78bfa'; // Purple (Custom)
                tagStyle = 'color: #a78bfa; background: rgba(167, 139, 250, 0.12); border: 1px solid rgba(167, 139, 250, 0.25);';
            }
        }

        const timeTag = showTimeTag ? `<span class="attendance-time-tag time-${timeClass}" style="${tagStyle}">${time}</span>` : '';
        const itemStyle = `border-left: 4px solid ${color};`;

        return `
            <div class="attendance-item" style="${itemStyle}">
                <div class="attendance-avatar">${avatar}</div>
                <div class="attendance-name">
                    <span class="attendance-name-text">${s.name.split(' ')[0]}</span>
                </div>
                ${timeTag}
            </div>
        `;
    };

    // Render Kommen
    if (sortedKommen.length === 0) {
        smoothUpdate(kommenList, `<div class="empty-state">Heute ist noch keiner da. 🤔</div>`);
    } else {
        const kommenHTML = sortedKommen.map(s => createStudentHTML(s, true, true)).join('');
        smoothUpdate(kommenList, kommenHTML);
    }

    // Render Grouped Chronological Gehen
    const timeGroups = {};

    presentStudents.forEach(s => {
        const studentBadgeIds = getStudentBadgesForDay(s, todayKey, dayIdx);
        
        if (studentBadgeIds.length > 0) {
            studentBadgeIds.forEach(badgeId => {
                const badgeDef = badges.find(b => String(b.id) === String(badgeId));
                if (badgeDef) {
                    const time = (badgeDef.time && badgeDef.time.trim()) || s.pickupTime || '15:30';
                    if (!timeGroups[time]) {
                        timeGroups[time] = { time, categories: {} };
                    }
                    if (!timeGroups[time].categories[badgeId]) {
                        timeGroups[time].categories[badgeId] = {
                            type: 'badge',
                            badge: badgeDef,
                            students: []
                        };
                    }
                    if (!timeGroups[time].categories[badgeId].students.some(x => x.id === s.id)) {
                        timeGroups[time].categories[badgeId].students.push(s);
                    }
                } else {
                    const time = s.pickupTime || '15:30';
                    if (!timeGroups[time]) {
                        timeGroups[time] = { time, categories: {} };
                    }
                    if (!timeGroups[time].categories['heimgehen']) {
                        timeGroups[time].categories['heimgehen'] = {
                            type: 'heimgehen',
                            name: 'Heimgehen',
                            emoji: '🏠',
                            color: '#a78bfa',
                            students: []
                        };
                    }
                    if (!timeGroups[time].categories['heimgehen'].students.some(x => x.id === s.id)) {
                        timeGroups[time].categories['heimgehen'].students.push(s);
                    }
                }
            });
        } else {
            const time = s.pickupTime || '15:30';
            if (!timeGroups[time]) {
                timeGroups[time] = { time, categories: {} };
            }
            if (!timeGroups[time].categories['heimgehen']) {
                timeGroups[time].categories['heimgehen'] = {
                    type: 'heimgehen',
                    name: 'Heimgehen',
                    emoji: '🏠',
                    color: '#a78bfa',
                    students: []
                };
            }
            if (!timeGroups[time].categories['heimgehen'].students.some(x => x.id === s.id)) {
                timeGroups[time].categories['heimgehen'].students.push(s);
            }
        }
    });

    const sortedTimes = Object.keys(timeGroups).sort((a, b) => a.localeCompare(b));

    if (sortedTimes.length === 0) {
        smoothUpdate(gehenList, `<div class="empty-state">Heute geht noch keiner. 🍿</div>`);
    } else {
        let gehenHTML = '';

        sortedTimes.forEach(time => {
            const group = timeGroups[time];
            const categoryKeys = Object.keys(group.categories);
            const isOnlyHeimgehen = categoryKeys.length === 1 && categoryKeys[0] === 'heimgehen';

            let categoriesHTML = '';

            if (isOnlyHeimgehen) {
                const cats = group.categories['heimgehen'];
                cats.students.sort((a, b) => a.name.localeCompare(b.name));
                
                const studentsHTML = cats.students.map(s => {
                    const avatar = s.avatar || s.name.charAt(0).toUpperCase();
                    return `
                        <div class="ue-student-chip" style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; font-size: 0.8rem; font-weight: 700; color: white;">
                            <div class="ue-student-avatar" style="width: 18px; height: 18px; border-radius: 50%; background: rgba(167, 139, 250, 0.15); border: 1px solid rgba(167, 139, 250, 0.3); display: flex; align-items: center; justify-content: center; font-size: 0.6rem; color: #a78bfa; flex-shrink: 0; font-weight: 800;">
                                ${avatar}
                            </div>
                            <span class="ue-student-name">${s.name.split(' ')[0]}</span>
                        </div>
                    `;
                }).join('');

                categoriesHTML = `
                    <div class="gehen-students-list" style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${studentsHTML}
                    </div>
                `;
            } else {
                categoryKeys.sort((a, b) => {
                    if (a === 'heimgehen') return 1;
                    if (b === 'heimgehen') return -1;
                    const nameA = group.categories[a].badge?.name || '';
                    const nameB = group.categories[b].badge?.name || '';
                    return nameA.localeCompare(nameB);
                });

                categoriesHTML = categoryKeys.map(catKey => {
                    const cat = group.categories[catKey];
                    cat.students.sort((a, b) => a.name.localeCompare(b.name));
                    
                    const emoji = cat.type === 'badge' ? (cat.badge.emoji || '📚') : (cat.emoji || '🏠');
                    const name = cat.type === 'badge' ? cat.badge.name : cat.name;
                    const color = cat.type === 'badge' ? (cat.badge.color || '#a78bfa') : (cat.color || '#a78bfa');

                    const studentsHTML = cat.students.map(s => {
                        const avatar = s.avatar || s.name.charAt(0).toUpperCase();
                        return `
                            <div class="ue-student-chip" style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; font-size: 0.8rem; font-weight: 700; color: white;">
                                <div class="ue-student-avatar" style="width: 18px; height: 18px; border-radius: 50%; background: ${color}22; border: 1px solid ${color}44; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; color: ${color}; flex-shrink: 0; font-weight: 800;">
                                    ${avatar}
                                </div>
                                <span class="ue-student-name">${s.name.split(' ')[0]}</span>
                            </div>
                        `;
                    }).join('');

                    return `
                        <div class="gehen-category-group" style="width: 100%;">
                            <div class="gehen-category-header" style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; font-weight: 800; color: ${color}; margin-bottom: 6px; border-bottom: 1px solid ${color}33; padding-bottom: 2px;">
                                <span>${emoji}</span>
                                <span>${name}</span>
                            </div>
                            <div class="gehen-students-list" style="display: flex; flex-wrap: wrap; gap: 6px;">
                                ${studentsHTML}
                            </div>
                        </div>
                    `;
                }).join('');
            }

            gehenHTML += `
                <div class="gehen-time-section" style="break-inside: avoid; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;">
                    <div class="gehen-time-header" style="display: flex; align-items: center;">
                        <span style="font-size: 0.85rem; font-weight: 900; color: #ff6b6b; background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.25); padding: 2px 8px; border-radius: 20px; font-variant-numeric: tabular-nums;">
                            🕒 ${time}
                        </span>
                    </div>
                    ${categoriesHTML}
                </div>
            `;
        });

        smoothUpdate(gehenList, gehenHTML);
    }

    // Render Abwesend
    if (absentStudents.length === 0) {
        smoothUpdate(abwesendList, `<div class="empty-state">Keiner krank. 😊</div>`);
    } else {
        const absentHTML = absentStudents.map(s => {
            const avatar = s.avatar || s.name.charAt(0).toUpperCase();
            const isExcused = s.sick === 'excused';
            const statusLabel = isExcused ? 'Krank (E)' : 'Krank (U)';
            const tagStyle = isExcused 
                ? 'color: #10b981; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.15);' 
                : 'color: #ef4444; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.15);';
            
            return `
                <div class="attendance-item" style="border-left: 4px solid ${isExcused ? '#10b981' : '#ef4444'};">
                    <div class="attendance-avatar">${avatar}</div>
                    <div class="attendance-name">
                        <span class="attendance-name-text">${s.name.split(' ')[0]}</span>
                    </div>
                    <span class="attendance-time-tag" style="${tagStyle}">${statusLabel}</span>
                </div>
            `;
        }).join('');
        smoothUpdate(abwesendList, absentHTML);
    }
}

// ── BADGE GALLERY (Motivation) ─────────────────
// ── BADGE GALLERY (Unterrichtseinheiten) ─────────────────
function renderBadgeGalerie() {
    const el = document.getElementById('badge-galerie-content');
    if (!el) return;

    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const todayIndex = new Date().getDay();
    const todayKey = days[todayIndex];
    const dayIdx = todayIndex - 1;

    // Helper to get badge IDs for a student on the current day
    const getStudentBadgesForDay = (student, dayKey, idx) => {
        if (!student || !student.badges) return [];
        if (Array.isArray(student.badges)) {
            const val = student.badges[idx];
            return val ? [String(val)] : [];
        }
        if (typeof student.badges === 'object') {
            const val = student.badges[dayKey];
            if (Array.isArray(val)) {
                return val.map(String).filter(id => id !== "");
            }
            if (val) {
                return [String(val)].filter(id => id !== "");
            }
        }
        return [];
    };

    // Map to group students by badge ID
    const badgeToStudentsMap = {};

    students.forEach(student => {
        const studentBadgeIds = getStudentBadgesForDay(student, todayKey, dayIdx);
        studentBadgeIds.forEach(badgeId => {
            if (!badgeToStudentsMap[badgeId]) {
                badgeToStudentsMap[badgeId] = [];
            }
            if (!badgeToStudentsMap[badgeId].some(s => s.id === student.id)) {
                badgeToStudentsMap[badgeId].push(student);
            }
        });
    });

    const activeBadgeIds = Object.keys(badgeToStudentsMap);

    if (activeBadgeIds.length === 0) {
        const emptyHTML = `
            <div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; padding: 30px 0; color: var(--text-muted); width: 100%; height: 100%; min-height: 150px; flex: 1;">
                <div class="empty-icon" style="font-size: 2.5rem; filter: drop-shadow(0 0 8px rgba(139, 92, 246, 0.3)); animation: badgeFloat 3s ease-in-out infinite;">📚</div>
                <span style="font-size: 0.95rem; font-weight: 700; color: rgba(255,255,255,0.7); line-height: 1.4;">Keine Unterrichtseinheiten<br>für heute eingetragen</span>
            </div>
        `;
        smoothUpdate(el, emptyHTML);
        return;
    }

    // Sort badges alphabetically by name
    activeBadgeIds.sort((a, b) => {
        const badgeA = badges.find(x => String(x.id) === String(a));
        const badgeB = badges.find(x => String(x.id) === String(b));
        const nameA = badgeA ? badgeA.name : `Einheit ${a}`;
        const nameB = badgeB ? badgeB.name : `Einheit ${b}`;
        return nameA.localeCompare(nameB);
    });

    let html = '<div style="display: flex; flex-direction: column; gap: 14px; width: 100%;">';

    activeBadgeIds.forEach(badgeId => {
        const badgeDef = badges.find(b => String(b.id) === String(badgeId));
        const badge = badgeDef || {
            emoji: "📚",
            name: `Einheit ${badgeId}`,
            description: "",
            color: "#a78bfa"
        };

        const categoryColor = badge.color || '#a78bfa';
        const categoryStudents = badgeToStudentsMap[badgeId];
        
        // Sort students alphabetically
        categoryStudents.sort((a, b) => a.name.localeCompare(b.name));

        const studentsHTML = categoryStudents.map(s => {
            const avatar = s.avatar || s.name.charAt(0).toUpperCase();
            return `
                <div class="ue-student-chip" style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; font-size: 0.8rem; font-weight: 700; color: white;">
                    <div class="ue-student-avatar" style="width: 18px; height: 18px; border-radius: 50%; background: ${categoryColor}22; border: 1px solid ${categoryColor}44; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; color: ${categoryColor}; flex-shrink: 0; font-weight: 800;">
                        ${avatar}
                    </div>
                    <span class="ue-student-name">${s.name.split(' ')[0]}</span>
                </div>
            `;
        }).join('');

        html += `
            <div class="ue-category" style="width: 100%; text-align: left;">
                <!-- Category Header -->
                <div class="ue-category-header" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid ${categoryColor}33;">
                    <span class="ue-category-emoji" style="font-size: 1.25rem; filter: drop-shadow(0 0 6px ${categoryColor}55);">${badge.emoji || '📚'}</span>
                    <div style="display: flex; flex-direction: column; min-width: 0;">
                        <span class="ue-category-name" style="font-size: 0.9rem; font-weight: 800; color: white; line-height: 1.2;">${badge.name}</span>
                        ${badge.description || badge.desc ? `<span class="ue-category-desc" style="font-size: 0.68rem; color: ${categoryColor}; opacity: 0.85; font-style: italic; line-height: 1.2; margin-top: 1px;">${badge.description || badge.desc}</span>` : ''}
                    </div>
                </div>
                <!-- Students List -->
                <div class="ue-students-list" style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${studentsHTML}
                </div>
            </div>
        `;
    });

    html += '</div>';

    smoothUpdate(el, html);
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

        const getStudentBadgeEmojisList = (student) => {
            if (!student.badges) return [];
            if (Array.isArray(student.badges)) return student.badges.filter(Boolean);
            if (typeof student.badges === 'object') return Object.values(student.badges).filter(Boolean);
            return [];
        };

        const studentBadgeEmojis = getStudentBadgeEmojisList(s)
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


// ── GEBURTSTAGSKIND DER WOCHE ──────────────────
function renderBirthdayWeek() {
    const el = document.getElementById('birthday-week-list');
    if (!el) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const wDay = today.getDay() || 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - wDay + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const isBirthdayThisWeek = (birthdayStr) => {
        if (!birthdayStr) return false;
        const parts = birthdayStr.split('-');
        if (parts.length < 3) return false;
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        
        const yearsToCheck = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];
        for (const y of yearsToCheck) {
            const bdate = new Date(y, m - 1, d);
            if (bdate >= monday && bdate <= sunday) {
                return true;
            }
        }
        return false;
    };

    const bdayKids = students.filter(s => isBirthdayThisWeek(s.birthday));

    if (bdayKids.length === 0) {
        el.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon" style="color: #ec4899; opacity: 0.6;">🎈</div>
                <span>Kein Geburtstag diese Woche</span>
            </div>`;
        return;
    }

    const daysOfWeekGerman = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

    // Sort birthday kids by their birthday weekday this week
    const getBdayDateThisWeek = (birthdayStr) => {
        const parts = birthdayStr.split('-');
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        for (const y of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
            const bdate = new Date(y, m - 1, d);
            if (bdate >= monday && bdate <= sunday) {
                return bdate;
            }
        }
        return new Date();
    };

    bdayKids.sort((a, b) => {
        return getBdayDateThisWeek(a.birthday) - getBdayDateThisWeek(b.birthday);
    });

    el.innerHTML = bdayKids.map(s => {
        const bdate = getBdayDateThisWeek(s.birthday);
        const bdayWeekday = daysOfWeekGerman[bdate.getDay()];
        const avatar = s.avatar || s.name.charAt(0);
        return `
            <div class="bday-big fade-in">
                <div class="bday-cake">🎂</div>
                <div class="bday-avatar-big">${avatar}</div>
                <div class="bday-info-horizontal">
                    <div class="bday-name-big">${s.name}</div>
                    <div class="bday-days-big">${bdayWeekday}</div>
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

// Build ticker display items from weeklyNews setting
function buildTickerItems() {
    const items = [];
    if (settings.weeklyNews && settings.weeklyNews.trim()) {
        const lines = settings.weeklyNews.split('\n').map(l => l.trim()).filter(Boolean);
        lines.forEach(line => {
            // Check if the line starts with an emoji using Intl.Segmenter
            const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
            const segments = Array.from(segmenter.segment(line));
            const firstSegment = segments[0]?.segment || "";
            const isEmoji = /\p{Extended_Pictographic}/u.test(firstSegment);

            if (isEmoji) {
                const text = line.substring(firstSegment.length).trim();
                items.push({
                    emoji: firstSegment,
                    text: text || "News"
                });
            } else {
                items.push({
                    emoji: "📢",
                    text: line
                });
            }
        });
    }
    if (items.length === 0) {
        items.push({
            emoji: "📢",
            text: "Willkommen in der Nachmittagsbetreuung!"
        });
    }
    return items;
}

function getTickerHash() {
    return settings.weeklyNews || "";
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
        <div class="ticker-item" style="font-size:1.5em;">
            <span class="t-icon">${it.emoji}</span>
            <span>${it.text}</span>
        </div>`).join('');

    // Two identical halves — _tickerPos modulo halfW keeps the loop invisible
    scroll.innerHTML = halfHtml + halfHtml;
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

window.addEventListener('resize', () => {
    if (students.length) renderKids();
});
