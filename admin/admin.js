const API_URL = "https://stempelkarte.sb-nmsstadt.workers.dev/api";
const PIN_ADMIN = "8520";
window.students = [];
let REWARDS = [];
let lastStudentsSnapshot = "";
let currentSettings = null; // Global settings cache
let lastLoadedValues = {};  // Cache to track what was last put into DOM

const adminApp = document.getElementById('admin-app');
const loginOverlay = document.getElementById('login-overlay');

// Simple PIN protection for Admin Dashboard
function checkAuth() {
    if (sessionStorage.getItem('admin_auth') === PIN_ADMIN) {
        if (loginOverlay) loginOverlay.style.display = 'none';
        if (adminApp) adminApp.style.display = 'block';
        loadSettings(); // Load settings once authorized
    } else {
        if (loginOverlay) loginOverlay.style.display = 'flex';
        if (adminApp) adminApp.style.display = 'none';
        document.getElementById('admin-pin-input')?.focus();
    }
}

function verifyAdminPin() {
    const input = document.getElementById('admin-pin-input');
    if (input.value === PIN_ADMIN) {
        sessionStorage.setItem('admin_auth', PIN_ADMIN);
        checkAuth();
    } else {
        alert("Falscher PIN!");
        input.value = "";
        input.focus();
    }
}

checkAuth();

document.addEventListener('DOMContentLoaded', async () => {
    await fetchRewards();
    await fetchBadges(); // ← muss VOR fetchStudents fertig sein, sonst fehlen Badges beim Rendern
    await loadSettings();
    Logbook.init();
    Appointments.init();
    fetchStudents();

    // Poll every 60 seconds for new data (increased from 30s to further save API requests)
    setInterval(fetchStudentsSilent, 60000);

    document.getElementById('add-btn')?.addEventListener('click', createNewStudent);
    document.getElementById('add-reward-btn')?.addEventListener('click', createNewReward);

    // Logbook Navigation
    document.getElementById('nav-logbook-btn')?.addEventListener('click', () => {
        const overview = document.getElementById('admin-student-list');
        const overviewTitle = document.querySelector('.main-content h2');
        const logbook = document.getElementById('logbook-view');
        const navBtn = document.getElementById('nav-logbook-btn');

        if (logbook.classList.contains('hidden')) {
            // Show Logbook
            overview.classList.add('hidden');
            if (overviewTitle) overviewTitle.innerText = "Pädagog. Logbuch";
            logbook.classList.remove('hidden');
            document.getElementById('search-students').parentElement.style.display = 'none';
            navBtn.querySelector('h3').innerText = "⬅ Übersicht";

            // Initialize/Render Logbook
            Logbook.init();
            Logbook.renderStudents();
        } else {
            // Back to Overview
            overview.classList.remove('hidden');
            if (overviewTitle) overviewTitle.innerText = "Schüler-Übersicht";
            logbook.classList.add('hidden');
            document.getElementById('search-students').parentElement.style.display = 'flex';
            navBtn.querySelector('h3').innerText = "Pädagog. Logbuch";
        }
    });

    // Appointments Navigation
    document.getElementById('nav-appointments-btn')?.addEventListener('click', () => {
        const overview = document.getElementById('admin-student-list');
        const overviewTitle = document.querySelector('.main-content h2');
        const appointments = document.getElementById('appointments-view');
        const navBtn = document.getElementById('nav-appointments-btn');
        const searchBar = document.getElementById('search-students').parentElement;

        if (appointments.classList.contains('hidden')) {
            // Hide everything else
            document.getElementById('logbook-view').classList.add('hidden');
            document.getElementById('nav-logbook-btn').querySelector('h3').innerText = "Pädagog. Logbuch";
            
            // Show Appointments
            overview.classList.add('hidden');
            if (overviewTitle) overviewTitle.innerText = "Termin-Planer";
            appointments.classList.remove('hidden');
            searchBar.style.display = 'none';
            navBtn.querySelector('h3').innerText = "⬅ Übersicht";

            // Initialize/Render
            Appointments.init();
        } else {
            // Back to Overview
            overview.classList.remove('hidden');
            if (overviewTitle) overviewTitle.innerText = "Schüler-Übersicht";
            appointments.classList.add('hidden');
            searchBar.style.display = 'flex';
            navBtn.querySelector('h3').innerText = "Termin-Planer";
        }
    });

    // Search functionality
    document.getElementById('search-students')?.addEventListener('input', (e) => {
        renderAdminList(e.target.value.toLowerCase());
    });

    // ── BADGE CHIP CLICKS (permanent single listener) ──
    // Attached here once so it doesn't stack on every renderAdminList call.
    document.getElementById('admin-student-list')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.badge-chip-btn');
        if (!btn || btn.disabled) return;
        const studentId = btn.dataset.student;
        const badgeId = btn.dataset.badge;
        if (!studentId || !badgeId) return;

        btn.style.opacity = '0.5';
        btn.disabled = true;

        const student = window.students.find(s => s.id === studentId);
        if (!student) { btn.style.opacity = '1'; btn.disabled = false; return; }

        const current = student.badges || [];
        const newBadges = current.includes(badgeId)
            ? current.filter(id => id !== badgeId)
            : [...current, badgeId];

        try {
            const res = await fetch(`${API_URL}/students/${studentId}/badges`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ badges: newBadges })
            });
            if (res.ok) {
                // Update local state directly — no full re-fetch needed
                student.badges = newBadges;
                renderAdminList(document.getElementById('search-students')?.value.toLowerCase() || '');
            } else {
                const errText = await res.text();
                alert(`Fehler beim Zuweisen: ${res.status} \u2014 ${errText}`);
                btn.style.opacity = '1';
                btn.disabled = false;
            }
        } catch (err) {
            alert('Verbindungsfehler: ' + err.message);
            btn.style.opacity = '1';
            btn.disabled = false;
        }
    });

    // ── TAMAGOTCHI TOGGLE LISTENER ──
    document.getElementById('setting-tama-ignore-freeze')?.addEventListener('change', saveSettings);
});

async function fetchRewards() {
    try {
        const response = await fetch(`${API_URL}/rewards`);
        if (response.ok) {
            REWARDS = await response.json();
            REWARDS.sort((a, b) => a.threshold - b.threshold);
            renderRewardDashboard();
            updateStats();
        }
    } catch (err) {
        console.error("Fehler beim Laden der Belohnungen", err);
    }
}

async function fetchStudents() {
    try {
        const response = await fetch(`${API_URL}/students`);
        if (response.ok) {
            const raw = await response.text();
            lastStudentsSnapshot = raw;
            window.students = JSON.parse(raw);
            renderAdminList();
            renderBirthdayDashboard();
            renderRedemptionDashboard();
            updateStats();
            populateSotwDropdown();
            renderSotwCurrent();
            if (typeof Appointments !== 'undefined') Appointments.renderStudentList();
        } else {
            showStatus("Fehler beim Laden der Schüler.", "error");
        }
    } catch (err) {
        showStatus("Verbindung zum Server fehlgeschlagen.", "error");
    }
}

async function clearStudentOfWeek() {
    if (!confirm('SOTW wirklich löschen?')) return;
    try {
        const res = await fetch(`${API_URL}/students/student-of-the-week`, {
            method: 'DELETE'
        });
        if (res.ok) {
            loadSettings();
        }
    } catch (err) { }
}

// ── TAMAGOTCHI ADMIN ─────────────────────────────
function updateTamagotchiAdmin(tama) {
    if (!tama) return;
    const statusEl = document.getElementById('tama-admin-status');
    const hatchControls = document.getElementById('tama-hatch-controls');
    const activeControls = document.getElementById('tama-active-controls');

    if (tama.status === "egg") {
        if (statusEl) statusEl.innerHTML = "Ei 🥚";
        if (hatchControls) hatchControls.classList.remove('hidden');
        if (activeControls) activeControls.classList.add('hidden');
    } else {
        const stageLabel = tama.stage || "Baby";
        if (statusEl) statusEl.innerHTML = `${tama.name} 🐣 (${stageLabel})`;
        if (hatchControls) hatchControls.classList.add('hidden');
        if (activeControls) activeControls.classList.remove('hidden');
        
        const hunger = document.getElementById('tama-admin-hunger');
        const thirst = document.getElementById('tama-admin-thirst');
        const hygiene = document.getElementById('tama-admin-hygiene');
        const love = document.getElementById('tama-admin-love');
        const fun = document.getElementById('tama-admin-fun');

        if (hunger) hunger.innerText = `${Math.round(tama.stats.hunger || 0)}%`;
        if (thirst) thirst.innerText = `${Math.round(tama.stats.thirst || 0)}%`;
        if (hygiene) hygiene.innerText = `${Math.round(tama.stats.hygiene || 0)}%`;
        if (love) love.innerText = `${Math.round(tama.stats.love || 0)}%`;
        if (fun) fun.innerText = `${Math.round(tama.stats.fun || 0)}%`;
    }
}

async function hatchTamagotchi() {
    const nameInput = document.getElementById('tama-new-name');
    const name = nameInput ? nameInput.value : "Pixelino";
    try {
        const res = await fetch(`${API_URL}/tamagotchi/hatch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            alert(`${name} ist geschlüpft! 🎉`);
            loadSettings();
        }
    } catch (err) { alert("Fehler beim Schlüpfen."); }
}

async function resetTamagotchi() {
    if (!confirm("Tierchen wirklich zurücksetzen? Alle Fortschritte gehen verloren.")) return;
    
    // We update settings manually to reset
    const newSettings = { ...currentSettings };
    newSettings.tamagotchi = {
        status: "egg",
        name: "Pixelino",
        hatchDate: null,
        lastUpdate: Date.now(),
        stats: { hunger: 100, thirst: 100, love: 100, energy: 100 },
        stage: "egg",
        isSleeping: false
    };
    
    try {
        const res = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });
        if (res.ok) {
            alert("Tierchen zurückgesetzt.");
            loadSettings();
        }
    } catch (err) { alert("Fehler beim Zurücksetzen."); }
}

async function toggleTamaVisibility() {
    if (!currentSettings) return;
    const newSettings = { ...currentSettings };
    if (!newSettings.tamagotchi) return;
    
    const isVisible = newSettings.tamagotchi.visible !== false;
    newSettings.tamagotchi.visible = !isVisible;
    
    try {
        const res = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });
        if (res.ok) {
            currentSettings = newSettings;
            const visBtn = document.getElementById('tama-visibility-btn');
            if (visBtn) {
                visBtn.innerText = !isVisible ? "TAMA EIN" : "TAMA AUS"; // showing current state of target
                visBtn.style.color = !isVisible ? "#60a5fa" : "#ef4444";
                visBtn.style.borderColor = !isVisible ? "#60a5fa44" : "#ef444444";
            }
            // No alert needed for minimalist feel, just visual feedback
        }
    } catch (err) { alert("Fehler beim Umschalten."); }
}

// ── TAMAGOTCHI TEST CONSOLE ──────────────────────
async function testTamaStats(h, t, l, f) {
    if (!currentSettings) return;
    const newSettings = JSON.parse(JSON.stringify(currentSettings));
    if (!newSettings.tamagotchi) return;
    newSettings.tamagotchi.stats = { 
        hunger: h, 
        thirst: t, 
        love: l,
        fun: f || 100
    };
    
    try {
        await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });
        loadSettings();
    } catch (err) { }
}

async function simulateTamaAction(action) {
    if (!currentSettings) return;
    // Deep clone to avoid mutation side effects
    const newSettings = JSON.parse(JSON.stringify(currentSettings));
    if (!newSettings.tamagotchi) return;
    
    newSettings.tamagotchi.lastAction = action;
    newSettings.tamagotchi.lastActionTime = new Date().toISOString();
    
    // Immediate stat boost for the simulation (matching new gameplay balance)
    if (action === 'play') {
        newSettings.tamagotchi.stats.fun = Math.min(100, (newSettings.tamagotchi.stats.fun || 0) + 25);
    } else if (action === 'feed') {
        newSettings.tamagotchi.stats.hunger = Math.min(100, (newSettings.tamagotchi.stats.hunger || 0) + 25);
    } else if (action === 'water') {
        newSettings.tamagotchi.stats.thirst = Math.min(100, (newSettings.tamagotchi.stats.thirst || 0) + 25);
    } else if (action === 'love') {
        newSettings.tamagotchi.stats.love = Math.min(100, (newSettings.tamagotchi.stats.love || 0) + 25);
    } else if (action === 'poop') {
        newSettings.tamagotchi.poopCount = Math.min(100, (newSettings.tamagotchi.poopCount || 0) + 1);
    }
    
    try {
        const res = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });
        if (res.ok) {
            console.log(`Action ${action} simulated.`);
            loadSettings();
        }
    } catch (err) { }
}

async function toggleTamaSleep(active) {
    if (!currentSettings) return;
    const newSettings = { ...currentSettings };
    if (!newSettings.tamagotchi) return;
    newSettings.tamagotchi.isSleeping = active;
    
    try {
        await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });
        loadSettings();
    } catch (err) { }
}

function testSound(id) {
    const file = `../audio/${id}.mp3`;
    console.log("Broadcasting sound test for", file);
    const bc = new BroadcastChannel('nachmi_updates');
    bc.postMessage({ 
        type: 'play_sound', 
        file: file, 
        test: true 
    });
}

async function fetchStudentsSilent() {
    if (document.hidden) return;
    try {
        // Optimized: Single request for both students and settings
        const response = await fetch(`${API_URL}/sync/admin`);
        if (response.ok) {
            const data = await response.json();
            const { students: freshStudents, settings: freshSettings, rewards: freshRewards } = data;

            // Update rewards if provided
            if (freshRewards) {
                const rawRewards = JSON.stringify(freshRewards);
                if (rawRewards !== JSON.stringify(REWARDS)) {
                    REWARDS = freshRewards;
                    REWARDS.sort((a, b) => a.threshold - b.threshold);
                    renderRewardDashboard();
                    renderRedemptionDashboard();
                    updateStats();
                }
            }

            // Check if students data actually changed
            const rawStudents = JSON.stringify(freshStudents);
            if (rawStudents !== lastStudentsSnapshot) {
                lastStudentsSnapshot = rawStudents;
                window.students = freshStudents;
                renderAdminList(document.getElementById('search-students')?.value.toLowerCase());
                renderBirthdayDashboard();
                renderRedemptionDashboard();
                updateStats();
                if (typeof Appointments !== 'undefined') Appointments.renderStudentList();
            }

            // Sync settings
            if (freshSettings) {
                currentSettings = freshSettings;
                // Sync UI elements from settings
                const updateField = (id, value, isCheckbox = false) => {
                    const el = document.getElementById(id);
                    if (!el || document.activeElement === el) return;
                    if (lastLoadedValues[id] !== undefined && el[isCheckbox ? 'checked' : 'value'] !== lastLoadedValues[id]) return;
                    el[isCheckbox ? 'checked' : 'value'] = value;
                    lastLoadedValues[id] = value;
                };

                updateField('setting-community-visible', freshSettings.communityGoalVisible !== false, true);
                updateField('setting-community-title', freshSettings.communityTitle || "Pizza-Party");
                updateField('setting-community-target', freshSettings.communityTarget || 500);
                updateField('setting-tama-ignore-freeze', freshSettings.tamagotchi?.ignoreWeekendFreeze || false, true);
                updateField('setting-vip-duration', freshSettings.vipDurationDays || 3);
                window._vipDuration = freshSettings.vipDurationDays || 3;
                
                renderSotwCurrent();
                updateTamagotchiAdmin(freshSettings.tamagotchi);
            }
        }
    } catch (err) { }
}

function updateStats() {
    const totalStudents = window.students.length;
    const totalStamps = window.students.reduce((sum, s) => sum + (s.stamps || 0), 0);
    const totalRewards = REWARDS.length;

    let pendingRedemptions = 0;
    students.forEach(s => {
        if (s.redemptions) {
            Object.values(s.redemptions).forEach(val => {
                if (val === 'pending') pendingRedemptions++;
            });
        }
    });

    document.getElementById('stat-total-students').innerText = totalStudents;
    document.getElementById('stat-total-stamps').innerText = totalStamps;
    document.getElementById('stat-pending-redemptions').innerText = pendingRedemptions;
    document.getElementById('stat-total-rewards').innerText = totalRewards;
}

function renderRedemptionDashboard() {
    const db = document.getElementById('redemption-dashboard');
    if (!db) return;
    db.innerHTML = '';

    let requests = [];
    window.students.forEach(s => {
        if (s.redemptions) {
            for (const [threshold, status] of Object.entries(s.redemptions)) {
                if (status === 'pending') {
                    let rewardName = getRewardNameByThreshold(parseInt(threshold));
                    requests.push({ id: s.id, name: s.name, threshold: parseInt(threshold), rewardName });
                }
            }
        }
    });

    if (requests.length === 0) {
        db.innerHTML = '<i>Keine offenen Anfragen.</i>';
        return;
    }

    requests.forEach(req => {
        const el = document.createElement('div');
        el.style.background = 'rgba(255,255,255,0.05)';
        el.style.padding = '10px';
        el.style.borderRadius = '12px';
        el.style.marginBottom = '10px';
        el.innerHTML = `
            <div style="margin-bottom:8px; font-size:0.85rem">
                <span style="color:white; font-weight:700;">${req.name}</span><br>
                <span style="color:var(--accent);">${req.rewardName}</span>
            </div>
            <button onclick="confirmRedemption('${req.id}', ${req.threshold})" style="width:100%; background:var(--success); border:none; color:white; padding:6px; border-radius:8px; cursor:pointer; font-weight:700; font-size:0.8rem;">
                Bestätigen
            </button>
        `;
        db.appendChild(el);
    });
}

function getRewardNameByThreshold(threshold) {
    const r = REWARDS.find(x => x.threshold === parseInt(threshold));
    return r ? r.title : `Reward ${threshold}`;
}

async function confirmRedemption(studentId, threshold) {
    try {
        const response = await fetch(`${API_URL}/students/${studentId}/redeem`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ threshold: threshold, status: 'completed' })
        });
        if (response.ok) {
            await fetchStudents();
        }
    } catch (err) { }
}

function renderBirthdayDashboard() {
    const db = document.getElementById('birthday-dashboard');
    if (!db) return;
    db.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const twoWeeksLater = new Date(today);
    twoWeeksLater.setDate(today.getDate() + 14);

    let upcoming = [];
    window.students.forEach(s => {
        if (!s.birthday) return;
        const [y, m, d] = s.birthday.split('-').map(Number);
        let bDate = new Date(today.getFullYear(), m - 1, d);
        if (bDate < today) bDate = new Date(today.getFullYear() + 1, m - 1, d);

        if (bDate >= today && bDate <= twoWeeksLater) {
            upcoming.push({ name: s.name, date: bDate, original: `${d}.${m}.${y}`, age: bDate.getFullYear() - y });
        }
    });

    upcoming.sort((a, b) => a.date - b.date);

    if (upcoming.length === 0) {
        db.innerHTML = '<i>Keine in Sicht.</i>';
        return;
    }

    upcoming.forEach(u => {
        const diff = Math.ceil((u.date - today) / (1000 * 60 * 60 * 24));
        const relative = diff === 0 ? 'Heute!' : (diff === 1 ? 'Morgen' : `In ${diff} Tagen`);
        const el = document.createElement('div');
        el.style.fontSize = '0.7rem';
        el.style.marginBottom = '5px';
        el.innerHTML = `<strong>${u.name}</strong> (${u.age} J.) - <span style="color:var(--primary-light)">${relative}</span>`;
        db.appendChild(el);
    });
}

let editingReward = null;

function renderRewardDashboard() {
    const list = document.getElementById('admin-reward-list');
    if (!list) return;
    list.innerHTML = '';

    REWARDS.forEach(reward => {
        const item = document.createElement('div');
        item.className = 'reward-admin-item';

        if (editingReward && editingReward.oldThreshold === reward.threshold) {
            item.classList.add('editing');
            item.innerHTML = `
                <div class="edit-reward-grid">
                    <div class="edit-field">
                        <label>Icon</label>
                        <input type="text" id="edit-reward-icon" value="${editingReward.icon}" style="width:40px">
                    </div>
                    <div class="edit-field">
                        <label>Stempel</label>
                        <div class="threshold-adjuster">
                            <button onclick="adjustEditThreshold(-1)">-</button>
                            <input type="number" id="edit-reward-threshold" value="${editingReward.threshold}" 
                                oninput="editingReward.threshold = parseInt(this.value) || 0">
                            <button onclick="adjustEditThreshold(1)">+</button>
                        </div>
                    </div>
                    <div class="edit-field" style="grid-column: span 1">
                        <label>Titel</label>
                        <input type="text" id="edit-reward-title" value="${editingReward.title}">
                    </div>
                    <div class="edit-field" style="grid-column: span 1">
                        <label>Sichtbar</label>
                        <button onclick="toggleEditActive()" class="toggle-btn ${editingReward.active !== false ? 'active' : ''}">
                            ${editingReward.active !== false ? 'AN' : 'AUS'}
                        </button>
                    </div>
                    <div class="edit-field" style="grid-column: span 2;">
                        <label>Beschreibung</label>
                        <input type="text" id="edit-reward-desc" value="${editingReward.desc || ''}">
                    </div>
                    <div style="grid-column: span 2; display:flex; gap:8px; margin-top:8px;">
                        <button onclick="saveEditReward()" class="add-stamp-btn" style="flex:1; padding:8px; background:var(--success)">Speichern</button>
                        <button onclick="cancelEditReward()" class="add-stamp-btn" style="flex:1; padding:8px; background:rgba(255,255,255,0.1)">Abbrechen</button>
                    </div>
                </div>
            `;
        } else {
            const isActive = reward.active !== false;
            item.classList.toggle('inactive', !isActive);
            item.innerHTML = `
                <div class="reward-info-admin">
                    <span class="reward-threshold-badge">${reward.threshold}</span>
                    <span class="reward-icon-small" style="${!isActive ? 'opacity:0.3' : ''}">${reward.icon}</span>
                    <div class="reward-text-admin" style="${!isActive ? 'opacity:0.5' : ''}">
                        <div class="reward-title-admin">${reward.title} ${!isActive ? '(Deaktiviert)' : ''}</div>
                        <div class="subtitle" style="font-size:0.7rem">${reward.desc || ''}</div>
                    </div>
                </div>
                <div style="display:flex; gap:4px;">
                    <button onclick="quickToggleActive(${reward.threshold})" class="icon-btn-small" title="${isActive ? 'Ausschalten' : 'Einschalten'}">
                        ${isActive ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'}
                    </button>
                    <button onclick="startEditReward(${reward.threshold})" class="icon-btn-small" style="padding:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    <button onclick="deleteReward(${reward.threshold})" class="icon-btn-small" style="padding:4px; color:#ff6b6b;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            `;
        }
        list.appendChild(item);
    });
}

function startEditReward(t) {
    const r = REWARDS.find(x => x.threshold === t);
    if (r) {
        editingReward = { ...r, oldThreshold: t };
        renderRewardDashboard();
    }
}

function cancelEditReward() {
    editingReward = null;
    renderRewardDashboard();
}

function toggleEditActive() {
    if (!editingReward) return;
    editingReward.active = editingReward.active === false ? true : false;
    renderRewardDashboard();
}

async function quickToggleActive(threshold) {
    const idx = REWARDS.findIndex(r => r.threshold === threshold);
    if (idx === -1) return;
    REWARDS[idx].active = REWARDS[idx].active === false ? true : false;
    await saveRewardsAPI([...REWARDS]);
}

function adjustEditThreshold(delta) {
    if (!editingReward) return;
    editingReward.threshold = Math.max(1, (editingReward.threshold || 0) + delta);
    renderRewardDashboard();
}

async function saveEditReward() {
    if (!editingReward) return;

    // Use the values from our local editingReward state which is kept in sync by adjustEditThreshold
    // but icon/title/desc need to be grabbed from DOM
    const newIcon = document.getElementById('edit-reward-icon').value;
    const newTitle = document.getElementById('edit-reward-title').value;
    const newDesc = document.getElementById('edit-reward-desc').value;
    const newT = editingReward.threshold;

    if (!newTitle) {
        alert("Bitte einen Titel eingeben.");
        return;
    }

    // Check if new threshold already exists elsewhere
    if (newT !== editingReward.oldThreshold) {
        if (REWARDS.some(r => r.threshold === newT)) {
            alert(`Es gibt bereits eine Belohnung für ${newT} Stempel. Bitte wähle eine andere Anzahl.`);
            return;
        }
    }

    // We only want to replace the ONE reward we started editing
    let replaced = false;
    const updated = REWARDS.map(r => {
        if (!replaced && r.threshold === editingReward.oldThreshold) {
            replaced = true;
            return { threshold: newT, icon: newIcon, title: newTitle, desc: newDesc, active: editingReward.active !== false };
        }
        return r;
    });

    // Reset editing state BEFORE re-rendering
    editingReward = null;
    await saveRewardsAPI(updated);
}

async function saveRewardsAPI(arr) {
    try {
        const response = await fetch(`${API_URL}/rewards`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(arr)
        });
        if (response.ok) {
            REWARDS = await response.json();
            renderRewardDashboard();
            updateStats();
        }
    } catch (err) { }
}

async function createNewReward() {
    const t = parseInt(document.getElementById('new-reward-threshold').value);
    const i = document.getElementById('new-reward-icon').value || "🎁";
    const title = document.getElementById('new-reward-title').value;
    const desc = document.getElementById('new-reward-desc').value;

    if (!t || !title) {
        alert("Bitte Stempelanzahl und Titel eingeben.");
        return;
    }

    if (REWARDS.some(r => r.threshold === t)) {
        alert(`Es gibt bereits eine Belohnung für ${t} Stempel.`);
        return;
    }

    const updated = [...REWARDS, { threshold: t, icon: i, title, desc, active: true }];
    await saveRewardsAPI(updated);

    // Clear inputs
    document.getElementById('new-reward-threshold').value = '';
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-desc').value = '';
}

async function deleteReward(t) {
    if (!confirm("Löschen?")) return;
    const updated = REWARDS.filter(r => r.threshold !== t);
    await saveRewardsAPI(updated);
}

function renderAdminList(filter = "") {
    const container = document.getElementById('admin-student-list');
    if (!container) return;
    container.innerHTML = '';

    const filtered = filter ? window.students.filter(s => s.name.toLowerCase().includes(filter)) : window.students;

    filtered.forEach(student => {
        const item = document.createElement('div');
        item.className = 'glass-card admin-student-item';
        const isVip = student.vip && student.vip.active;
        const fullCards = Math.floor(student.stamps / 20);
        const vipEligible = fullCards >= 1;

        // Calculate VIP days
        let vipDayText = '';
        if (isVip && student.vip.grantedAt) {
            const grantedDate = new Date(student.vip.grantedAt);
            grantedDate.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const daysDiff = Math.floor((today - grantedDate) / (1000 * 60 * 60 * 24)) + 1;
            const vipDuration = window._vipDuration || 3;
            const daysLeft = vipDuration - daysDiff + 1;
            vipDayText = daysLeft <= 1
                ? `⭐ VIP — <span style="color:#ff6b6b">Letzter Tag!</span>`
                : `⭐ VIP — <span style="color:gold">Tag ${daysDiff}/${vipDuration}</span>`;
        }

        // Badge chips + toggle using data attributes (avoids inline onclick escaping issues)
        const studentBadgeIds = student.badges || [];
        const hasBadges = allBadges.length > 0;
        let badgeSection = '';
        if (hasBadges) {
            // Show only EARNED badges prominently
            const earnedChips = allBadges
                .filter(b => studentBadgeIds.includes(b.id))
                .map(b => `
                    <button 
                        data-student="${student.id}" 
                        data-badge="${b.id}"
                        class="badge-chip-btn active"
                        title="Abzeichen entfernen: ${b.name}"
                        style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:0.72rem;font-weight:700;cursor:pointer;transition:all 0.2s;border:1px solid ${b.color};background:${b.color}33;color:${b.color}; shadow: 0 4px 10px ${b.color}22;">
                        ${b.emoji} ${b.name}
                    </button>`).join('');

            // Full picker for unassigned badges (hidden by default)
            const unassignedChips = allBadges
                .filter(b => !studentBadgeIds.includes(b.id))
                .map(b => `
                    <button 
                        data-student="${student.id}" 
                        data-badge="${b.id}"
                        class="badge-chip-btn"
                        title="Abzeichen hinzufügen: ${b.name}"
                        style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:0.72rem;font-weight:700;cursor:pointer;transition:all 0.2s;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.4);">
                        ${b.emoji} ${b.name}
                    </button>`).join('');

            badgeSection = `
                <div class="badge-row" style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.08);">
                    <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                        ${earnedChips}
                        <button class="add-badge-toggle" onclick="this.parentElement.nextElementSibling.classList.toggle('hidden'); this.classList.toggle('active')" style="
                            width:32px; height:32px; border-radius:10px; border:1px dashed rgba(255,255,255,0.2); background:rgba(255,255,255,0.03); color:rgba(255,255,255,0.5); cursor:pointer; font-weight:800; font-size:1.1rem; display:flex; align-items:center; justify-content:center; transition: all 0.2s;
                        ">＋</button>
                    </div>
                    <div class="badge-picker-extra hidden" style="margin-top:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:14px; border:1px solid rgba(255,255,255,0.05); animation: fadeIn 0.3s ease-out;">
                        <div style="font-size:0.65rem; color:var(--text-muted); font-weight:900; margin-bottom:8px; opacity:0.8; letter-spacing:0.05em;">VERFÜGBARE ABZEICHEN:</div>
                        <div style="display:flex; flex-wrap:wrap; gap:6px;">
                            ${unassignedChips || '<span style="font-size:0.7rem; color:rgba(255,255,255,0.2);">Alle Abzeichen bereits vergeben.</span>'}
                        </div>
                    </div>
                </div>`;
        }

        item.innerHTML = `
            <div class="student-info" style="display:flex; align-items:center;">
                <div class="avatar" style="${isVip ? 'box-shadow: 0 0 12px gold; border: 2px solid gold;' : ''}">${student.avatar || student.name.charAt(0)}</div>
                <div style="flex:1">
                    <div style="font-weight:700; font-size:1.1rem">${student.name} ${isVip ? `<span style="font-size:0.7rem; font-weight:900; letter-spacing:0.05em;">${vipDayText}</span>` : ''}</div>
                    <div class="subtitle" style="font-size:0.75rem">ID: ${student.id} · ${fullCards} Karte(n)</div>
                </div>
                <!-- Compact Attendance Chips -->
                <div class="attendance-chips-container" style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                    <div style="display:flex; gap:4px;">
                        ${['mon', 'tue', 'wed', 'thu', 'fri'].map(day => {
                            const active = student.attendance && student.attendance[day];
                            const chars = { mon:'M', tue:'D', wed:'M', thu:'D', fri:'F' };
                            return `<div class="attendance-chip ${active ? 'active' : ''}" onclick="event.stopPropagation(); toggleAttendance('${student.id}', '${day}', ${active})" title="${day.toUpperCase()}">${chars[day]}</div>`;
                        }).join('')}
                    </div>
                    <!-- Pickup Time Toggle -->
                    <div class="pickup-toggle-container" style="display:flex; background:rgba(255,255,255,0.05); border-radius:8px; padding:2px; border:1px solid rgba(255,255,255,0.1);">
                        <button onclick="updatePickupTime('${student.id}', '15:30')" class="pickup-btn ${student.pickupTime === '15:30' ? 'active' : ''}" style="border:none; background:none; color:${student.pickupTime === '15:30' ? 'white' : 'rgba(255,255,255,0.3)'}; font-size:0.6rem; font-weight:800; padding:2px 6px; border-radius:6px; cursor:pointer;">15:30</button>
                        <button onclick="updatePickupTime('${student.id}', '16:30')" class="pickup-btn ${student.pickupTime === '16:30' ? 'active' : ''}" style="border:none; background:none; color:${student.pickupTime === '16:30' ? 'white' : 'rgba(255,255,255,0.3)'}; font-size:0.6rem; font-weight:800; padding:2px 6px; border-radius:6px; cursor:pointer;">16:30</button>
                    </div>
                </div>
            </div>

            ${badgeSection}

            <div class="admin-row-actions">
                <div class="admin-stamp-control">
                    <input type="number" class="admin-stamp-input" value="${student.stamps}" onchange="updateStamps('${student.id}', this.value)">
                    <span class="subtitle" style="margin-left:8px">Stempel</span>
                </div>
                
                <div class="admin-button-group" style="flex-wrap:wrap; justify-content:flex-end;">
                    ${vipEligible ? `<button onclick="toggleVip('${student.id}', ${!isVip})" class="icon-btn-small" style="padding:4px 8px; font-size:0.7rem; font-weight:800; ${isVip ? 'color:gold; border-color:gold;' : 'color:var(--text-muted);'}" title="${isVip ? 'VIP entziehen' : 'VIP vergeben'}">
                        ⭐ ${isVip ? 'VIP' : 'VIP?'}
                    </button>` : ''}
                    <button class="icon-btn-small" onclick="Logbook.showHistory('${student.id}')" title="Pädagogisches Archiv / Logbuch" style="color: #22c55e;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    </button>
                    <button class="icon-btn-small" onclick="copyLink('${student.id}')" title="Link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></button>
                    <button class="icon-btn-small" onclick="deleteStudent('${student.id}')" style="color:#ff6b6b"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
    // NOTE: Badge click listener is set up ONCE in DOMContentLoaded — not here.
}

async function toggleStudentBadge(studentId, badgeId) {
    // Fallback (kept for compatibility)
    const student = window.students.find(s => s.id === studentId);
    if (!student) return;
    const current = student.badges || [];
    const newBadges = current.includes(badgeId)
        ? current.filter(id => id !== badgeId)
        : [...current, badgeId];
    await assignBadgesToStudent(studentId, newBadges);
}

function formatDate(s) { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; }

async function toggleVip(id, activate) {
    let reason = '';
    if (activate) {
        reason = prompt('VIP-Grund (optional, z.B. "1 volle Karte erreicht"):') || '';
    } else {
        if (!confirm(`VIP-Status entziehen?`)) return;
    }
    try {
        const res = await fetch(`${API_URL}/students/${id}/vip`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: activate, reason })
        });
        if (res.ok) {
            await fetchStudents();
        } else {
            alert('Fehler beim Ändern des VIP-Status.');
        }
    } catch (err) {
        alert('Verbindungsfehler.');
    }
}

function copyLink(id) {
    const link = `${window.location.origin}${window.location.pathname.replace('admin/index.html', 'index.html')}?id=${id}`;
    navigator.clipboard.writeText(link).then(() => alert("Kopiert!"));
}

async function createNewStudent() {
    const nameInput = document.getElementById('new-student-name');
    const birthdayInput = document.getElementById('new-student-birthday');
    const pickupInput = document.getElementById('new-student-pickup');
    
    const name = nameInput.value.trim();
    const birthday = birthdayInput.value;
    const pickupTime = pickupInput.value;
    
    // Collect attendance from chips
    const attendance = {};
    document.querySelectorAll('.new-student-chip').forEach(chip => {
        attendance[chip.dataset.day] = chip.classList.contains('active');
    });

    if (!name) {
        alert("Bitte einen Namen eingeben.");
        return;
    }

    try {
        const response = await fetch(`${API_URL}/students`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, birthday, attendance, pickupTime })
        });

        if (response.ok) {
            // Reset fields
            nameInput.value = '';
            birthdayInput.value = '';
            document.querySelectorAll('.new-student-chip').forEach(chip => chip.classList.remove('active'));
            
            // Reset pickup selection UI
            pickupInput.value = '15:30';
            const btn1530 = document.getElementById('new-pickup-btn-1530');
            const btn1630 = document.getElementById('new-pickup-btn-1630');
            if (btn1530 && btn1630) {
                btn1530.classList.add('active');
                btn1530.style.color = 'white';
                btn1630.classList.remove('active');
                btn1630.style.color = 'rgba(255,255,255,0.3)';
            }

            fetchStudents();
        } else {
            alert("Fehler beim Erstellen des Schülers.");
        }
    } catch (err) {
        alert("Verbindungsfehler.");
    }
}

async function deleteStudent(id) {
    if (!confirm("Löschen?")) return;
    await fetch(`${API_URL}/students/${id}`, { method: 'DELETE' });
    fetchStudents();
}

async function updateStamps(id, c) {
    await fetch(`${API_URL}/students/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            stamps: parseInt(c),
            reason: "Admin-Korrektur"
        })
    });
    fetchStudents();
}

async function toggleAttendance(id, day, currentVal) {
    const newVal = !currentVal;
    
    const container = document.getElementById('admin-student-list');
    const studentCard = Array.from(container.children).find(el => el.innerHTML.includes(id));
    if (studentCard) {
        const chips = studentCard.querySelectorAll('.attendance-chip');
        const dayIdx = ['mon', 'tue', 'wed', 'thu', 'fri'].indexOf(day);
        if (chips[dayIdx]) {
            chips[dayIdx].classList.toggle('active', newVal);
            chips[dayIdx].setAttribute('onclick', `event.stopPropagation(); toggleAttendance('${id}', '${day}', ${newVal})`);
        }
    }

    await updateAttendance(id, day, newVal);
}

async function updateAttendance(id, day, val) {
    const attObj = {};
    attObj[day] = val;
    
    try {
        await fetch(`${API_URL}/students/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attendance: attObj })
        });
        
        // Update local memory
        const s = window.students.find(x => x.id === id);
        if (s) {
            if (!s.attendance) s.attendance = {};
            s.attendance[day] = val;
        }
    } catch (err) {
        console.error("Attendance update error:", err);
    }
}

async function updatePickupTime(id, time) {
    try {
        await fetch(`${API_URL}/students/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pickupTime: time })
        });
        
        // Update local memory and UI instant feedback
        const s = window.students.find(x => x.id === id);
        if (s) {
            s.pickupTime = time;
        }

        // Silent UI update: find the card and toggle active class on buttons
        const container = document.getElementById('admin-student-list');
        const card = Array.from(container.children).find(el => el.innerHTML.includes(id));
        if (card) {
            const btns = card.querySelectorAll('.pickup-btn');
            btns.forEach(btn => {
                const isActive = btn.innerText === time;
                btn.classList.toggle('active', isActive);
                btn.style.color = isActive ? 'white' : 'rgba(255,255,255,0.3)';
                if (isActive) btn.parentElement.querySelector('.active')?.classList.remove('active');
            });
        }
    } catch (err) {
        console.error("Pickup update error:", err);
    }
}

function showStatus(m, t) { console.log(m); }
// System Settings
async function loadSettings() {
    try {
        const response = await fetch(`${API_URL}/settings`, { cache: 'no-store' });
        if (response.ok) {
            const settings = await response.json();
            currentSettings = settings;

            const updateField = (id, value, isCheckbox = false) => {
                const el = document.getElementById(id);
                if (!el) return;
                // Only update if not focused AND (not changed by user OR first time loading)
                const isFocused = document.activeElement === el;
                const hasChangedManually = lastLoadedValues[id] !== undefined && el[isCheckbox ? 'checked' : 'value'] !== lastLoadedValues[id];

                if (!isFocused && !hasChangedManually) {
                    el[isCheckbox ? 'checked' : 'value'] = value;
                    lastLoadedValues[id] = value;
                }
            };

            updateField('setting-community-visible', settings.communityGoalVisible !== false, true);
            updateField('setting-community-title', settings.communityTitle || "Pizza-Party");
            updateField('setting-community-target', settings.communityTarget || 500);
            updateField('setting-tama-ignore-freeze', settings.tamagotchi?.ignoreWeekendFreeze || false, true);

            if (settings.activities) {
                const text = settings.activities.map(a => `${a.emoji} ${a.label}`).join('\n');
                updateField('setting-activities', text);
            }

            if (settings.groupReward) {
                updateField('setting-group-title', settings.groupReward.title || "Filmtag");
                document.getElementById('setting-group-target').value = settings.groupReward?.target || 8;

                // Static displays
                const titleDisp = document.getElementById('group-reward-title-display');
                if (titleDisp) {
                    titleDisp.innerText = `${settings.groupReward.icon || '🎬'} ${settings.groupReward.title}`;
                    document.getElementById('group-reward-status').innerText = `${settings.groupReward.current} / ${settings.groupReward.target} Stempel`;
                    const progress = Math.min(100, (settings.groupReward.current / settings.groupReward.target) * 100);
                    document.getElementById('group-reward-bar').style.width = `${progress}%`;

                    const isGoalReached = settings.groupReward.current >= settings.groupReward.target;
                    const isApproved = settings.groupReward.isApproved;

                    const resetBtn = document.getElementById('group-reward-reset-btn');
                    if (resetBtn) {
                        if (isGoalReached) {
                            resetBtn.classList.remove('hidden');
                        } else {
                            resetBtn.classList.add('hidden');
                        }
                    }
                }
            }

            updateField('setting-vip-duration', settings.vipDurationDays || 3);
            window._vipDuration = settings.vipDurationDays || 3;

            updateField('setting-daily-notes', settings.dailyNotes || "");
            updateField('setting-current-projects', settings.currentProjects || "");
            updateField('setting-upcoming-projects', settings.upcomingProjects || "");
            updateField('setting-today-plan', settings.todayPlan || "");

            renderSotwCurrent();
            updateTamagotchiAdmin(settings.tamagotchi);

            // Sync Visibility Button
            const visBtn = document.getElementById('tama-visibility-btn');
            if (visBtn) {
                const isVisible = settings.tamagotchi?.visible !== false;
                visBtn.innerText = isVisible ? "TAMA EIN" : "TAMA AUS";
                visBtn.style.color = isVisible ? "#60a5fa" : "#ef4444";
                visBtn.style.borderColor = isVisible ? "#60a5fa44" : "#ef444444";
            }
        }
    } catch (err) { }
}

async function saveSettings() {
    const communityVisible = document.getElementById('setting-community-visible').checked;
    const communityTitle = document.getElementById('setting-community-title').value || "Pizza-Party";
    const target = parseInt(document.getElementById('setting-community-target').value);

    const activitiesText = document.getElementById('setting-activities').value;
    const dailyNotes = document.getElementById('setting-daily-notes')?.value || "";
    const currentProjects = document.getElementById('setting-current-projects')?.value || "";
    const upcomingProjects = document.getElementById('setting-upcoming-projects')?.value || "";
    const todayPlan = document.getElementById('setting-today-plan')?.value || "";
    const groupTitle = document.getElementById('setting-group-title').value;
    const groupTarget = parseInt(document.getElementById('setting-group-target').value);
    const vipDuration = parseInt(document.getElementById('setting-vip-duration')?.value) || 3;

    if (isNaN(target) || target <= 0) {
        alert("Bitte ein gültiges Ziel eingeben.");
        return;
    }

    const activities = activitiesText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
            // Use Intl.Segmenter to correctly handle multi-character emojis (like 🏃‍♀️ or 👨‍👩‍👧)
            const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
            const segments = Array.from(segmenter.segment(line));
            const firstSegment = segments[0]?.segment || "";

            // Check if first segment is an emoji (rough check: non-ASCII and not punctuation)
            const isEmoji = /\p{Extended_Pictographic}/u.test(firstSegment);

            if (isEmoji) {
                const label = line.substring(firstSegment.length).trim();
                return { emoji: firstSegment, label: label || "Aktivität" };
            }

            // Fallback to space-based splitting if no emoji at start
            const firstSpace = line.indexOf(' ');
            if (firstSpace === -1) {
                return { emoji: "✨", label: line };
            }

            return {
                emoji: line.substring(0, firstSpace).trim(),
                label: line.substring(firstSpace).trim()
            };
        });

    try {
        // Use our cached currentSettings to preserve server-only values (like reward progress)
        // while updating with the new values from the form.
        const payload = {
            ...(currentSettings || {}),
            communityTarget: target,
            communityTitle: communityTitle,
            communityGoalVisible: communityVisible,
            activities: activities,
            vipDurationDays: vipDuration,
            dailyNotes: dailyNotes,
            currentProjects: currentProjects,
            upcomingProjects: upcomingProjects,
            todayPlan: todayPlan,
            groupReward: {
                ...(currentSettings?.groupReward || { current: 0, icon: "🎬" }),
                title: groupTitle,
                target: groupTarget
            },
            tamagotchi: {
                ...(currentSettings?.tamagotchi || {}),
                ignoreWeekendFreeze: document.getElementById('setting-tama-ignore-freeze').checked
            }
        };

        const response = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            lastLoadedValues = {};
            alert("Einstellungen gespeichert!");
            loadSettings();
        }
    } catch (err) {
        alert("Fehler beim Speichern.");
    }
}


async function resetGroupReward() {
    if (!confirm("Bist du sicher? Dies setzt den Fortschritt auf 0 zurück. Tu dies erst, wenn der Filmtag vorbei ist.")) return;
    try {
        const response = await fetch(`${API_URL}/settings/group-reset`, { method: 'POST' });
        if (response.ok) {
            alert("Fortschritt wurde zurückgesetzt.");
            await loadSettings();
        } else {
            const errBody = await response.text();
            alert(`Fehler: ${response.status} - ${errBody}`);
        }
    } catch (err) {
        alert("Verbindungsfehler beim Zurücksetzen: " + err.message);
    }
}

// =============================================================
// BADGE MANAGEMENT
// =============================================================

let allBadges = [];

async function fetchBadges() {
    try {
        const res = await fetch(`${API_URL}/badges`);
        if (res.ok) {
            allBadges = await res.json();
            renderBadgeList();
        }
    } catch (err) { console.error('Badge load error:', err); }
}

function renderBadgeList() {
    const el = document.getElementById('badge-list');
    if (!el) return;
    if (allBadges.length === 0) {
        el.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem;">Noch keine Abzeichen erstellt.</span>';
        return;
    }
    el.innerHTML = allBadges.map(b => `
        <div style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:${b.color}22;border:1px solid ${b.color};border-radius:20px;font-size:0.8rem;">
            <span>${b.emoji}</span>
            <span style="font-weight:700;color:${b.color};">${b.name}</span>
            <button onclick="deleteBadge('${b.id}')" style="background:transparent;border:none;color:#ef4444;cursor:pointer;padding:0;font-size:0.85rem;line-height:1;">✕</button>
        </div>`).join('');
}

async function createBadge() {
    const emoji = document.getElementById('new-badge-emoji').value.trim() || '🏅';
    const name = document.getElementById('new-badge-name').value.trim();
    const desc = document.getElementById('new-badge-desc').value.trim();
    const color = document.getElementById('new-badge-color').value;
    const msg = document.getElementById('badge-status-msg');

    if (!name) { alert('Bitte einen Namen eingeben!'); return; }
    try {
        const res = await fetch(`${API_URL}/badges`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji, name, description: desc, color })
        });
        if (res.ok) {
            document.getElementById('new-badge-emoji').value = '';
            document.getElementById('new-badge-name').value = '';
            document.getElementById('new-badge-desc').value = '';
            msg.textContent = `✅ "${name}" erstellt!`;
            msg.style.display = 'block';
            msg.style.color = 'var(--success)';
            setTimeout(() => msg.style.display = 'none', 3000);
            await fetchBadges();
        }
    } catch (err) { alert('Fehler: ' + err.message); }
}

async function deleteBadge(id) {
    if (!confirm('Abzeichen wirklich löschen?')) return;
    await fetch(`${API_URL}/badges/${id}`, { method: 'DELETE' });
    await fetchBadges();
}

async function assignBadgesToStudent(studentId, newBadgeIds) {
    await fetch(`${API_URL}/students/${studentId}/badges`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badges: newBadgeIds })
    });
    await fetchStudents();
}

// =============================================================
// STUDENT OF THE WEEK
// =============================================================

function populateSotwDropdown() {
    const sel = document.getElementById('sotw-student-select');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Schüler auswählen --</option>';
    [...students].sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
        sel.innerHTML += `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${s.name}</option>`;
    });
}

function renderSotwCurrent() {
    if (!currentSettings) return;
    const sotw = currentSettings.studentOfWeek;
    const el = document.getElementById('sotw-current');
    if (!el) return;
    if (sotw && sotw.studentId) {
        const student = students.find(s => s.id === sotw.studentId);
        el.style.display = 'block';
        el.innerHTML = `<strong>Aktuell:</strong> ${student ? student.name : sotw.studentId}${sotw.reason ? ' — ' + sotw.reason : ''}`;
        document.getElementById('sotw-student-select').value = sotw.studentId;
        document.getElementById('sotw-reason').value = sotw.reason || '';
    } else {
        el.style.display = 'none';
    }
}

async function saveStudentOfWeek() {
    const studentId = document.getElementById('sotw-student-select').value;
    const reason = document.getElementById('sotw-reason').value.trim();
    if (!studentId) { alert('Bitte einen Schüler auswählen!'); return; }
    const payload = {
        ...(currentSettings || {}),
        studentOfWeek: { studentId, reason, grantedAt: new Date().toISOString() }
    };
    const res = await fetch(`${API_URL}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res.ok) {
        currentSettings = payload;
        renderSotwCurrent();
        alert('⭐ Schüler der Woche gespeichert!');
    }
}

async function clearStudentOfWeek() {
    if (!confirm('Schüler der Woche wirklich löschen?')) return;
    const payload = { ...(currentSettings || {}), studentOfWeek: null };
    await fetch(`${API_URL}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    currentSettings = payload;
    document.getElementById('sotw-student-select').value = '';
    document.getElementById('sotw-reason').value = '';
    document.getElementById('sotw-current').style.display = 'none';
}
