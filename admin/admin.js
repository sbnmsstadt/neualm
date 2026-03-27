const API_URL = "https://neualm-infotafel.sb-nmsstadt.workers.dev/api";
const PIN_ADMIN = "8520"; 
let students = [];
let REWARDS = [];
let lastStudentsSnapshot = "";
let currentSettings = null; // Global settings cache
let lastLoadedValues = {};  // Cache to track what was last put into DOM

const adminApp = document.getElementById('admin-app');
const loginOverlay = document.getElementById('login-overlay');

// Simple PIN protection for Admin Dashboard
async function verifyAdminPin() {
    const input = document.getElementById('admin-pin-input');
    const password = input.value;
    
    try {
        const response = await fetch(`${API_URL}/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                // Use a different key to distinguish from old PIN
                sessionStorage.setItem('admin_auth_v2', password);
                checkAuthV2();
            } else {
                alert("Falscher PIN / Passwort!");
                input.value = "";
                input.focus();
            }
        } else {
            alert("Login fehlgeschlagen. Passwort prüfen.");
            input.value = "";
            input.focus();
        }
    } catch (err) {
        alert("Verbindung zum Server fehlgeschlagen.");
    }
}

// Updated auth check for v2
function checkAuthV2() {
    const auth = sessionStorage.getItem('admin_auth_v2');
    if (auth) {
        if (loginOverlay) loginOverlay.style.display = 'none';
        if (adminApp) adminApp.style.display = 'block';
    } else {
        if (loginOverlay) loginOverlay.style.display = 'flex';
        if (adminApp) adminApp.style.display = 'none';
        document.getElementById('admin-pin-input')?.focus();
    }
}

checkAuthV2();

document.addEventListener('DOMContentLoaded', async () => {
    await fetchRewards();
    loadSettings();
    fetchStudents();
    
    // Poll every 5 seconds for new data
    setInterval(fetchStudentsSilent, 5000);
    
    document.getElementById('add-btn')?.addEventListener('click', createNewStudent);
    document.getElementById('add-reward-btn')?.addEventListener('click', createNewReward);
    
    // Search functionality
    document.getElementById('search-students')?.addEventListener('input', (e) => {
        renderAdminList(e.target.value.toLowerCase());
    });
});

async function fetchRewards() {
    try {
        const response = await fetch(`${API_URL}/rewards`);
        if (response.ok) {
            REWARDS = await response.json();
            REWARDS.sort((a,b) => a.threshold - b.threshold);
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
            students = JSON.parse(raw);
            renderAdminList();
            renderBirthdayDashboard();
            renderRedemptionDashboard();
            updateStats();
        } else {
            showStatus("Fehler beim Laden der Schüler.", "error");
        }
    } catch (err) {
        showStatus("Verbindung zum Server fehlgeschlagen.", "error");
    }
}

async function fetchStudentsSilent() {
    if (document.hidden) return;
    try {
        const response = await fetch(`${API_URL}/students`);
        if (response.ok) {
            const raw = await response.text();
            if (raw !== lastStudentsSnapshot) {
                lastStudentsSnapshot = raw;
                students = JSON.parse(raw);
                renderAdminList(document.getElementById('search-students')?.value.toLowerCase());
                renderBirthdayDashboard();
                renderRedemptionDashboard();
                updateStats();
            }
        }
    } catch (err) { }
    loadSettings();
}

function updateStats() {
    const totalStudents = students.length;
    const totalStamps = students.reduce((sum, s) => sum + (s.stamps || 0), 0);
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
    students.forEach(s => {
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
    today.setHours(0,0,0,0);
    const twoWeeksLater = new Date(today);
    twoWeeksLater.setDate(today.getDate() + 14);
    
    let upcoming = [];
    students.forEach(s => {
        if (!s.birthday) return;
        const [y, m, d] = s.birthday.split('-').map(Number);
        let bDate = new Date(today.getFullYear(), m - 1, d);
        if (bDate < today) bDate = new Date(today.getFullYear() + 1, m-1, d);
        
        if (bDate >= today && bDate <= twoWeeksLater) {
            upcoming.push({ name: s.name, date: bDate, original: `${d}.${m}.${y}`, age: bDate.getFullYear() - y });
        }
    });
    
    upcoming.sort((a,b) => a.date - b.date);
    
    if (upcoming.length === 0) {
        db.innerHTML = '<i>Keine in Sicht.</i>';
        return;
    }
    
    upcoming.forEach(u => {
        const diff = Math.ceil((u.date - today) / (1000 * 60 * 60 * 24));
        const relative = diff === 0 ? 'Heute!' : (diff === 1 ? 'Morgen' : `In ${diff} Tagen`);
        const el = document.createElement('div');
        el.style.fontSize = '0.85rem';
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
                        <label>Punkte</label>
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
            alert(`Es gibt bereits eine Belohnung für ${newT} Punkte. Bitte wähle eine andere Anzahl.`);
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
    } catch (err) {}
}

async function createNewReward() {
    const t = parseInt(document.getElementById('new-reward-threshold').value);
    const i = document.getElementById('new-reward-icon').value || "🎁";
    const title = document.getElementById('new-reward-title').value;
    const desc = document.getElementById('new-reward-desc').value;
    
    if (!t || !title) {
        alert("Bitte Punktanzahl und Titel eingeben.");
        return;
    }

    if (REWARDS.some(r => r.threshold === t)) {
        alert(`Es gibt bereits eine Belohnung für ${t} Punkte.`);
        return;
    }

    const updated = [...REWARDS, {threshold:t, icon:i, title, desc, active: true}];
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

    const filtered = filter ? students.filter(s => s.name.toLowerCase().includes(filter)) : students;

    filtered.forEach(student => {
        const item = document.createElement('div');
        item.className = 'glass-card admin-student-item';
        const isVip = student.vip && student.vip.active;
        
        // Calculate VIP/Badge days
        let vipDayText = '';
        if (isVip && student.vip.grantedAt) {
            const grantedDate = new Date(student.vip.grantedAt);
            grantedDate.setHours(0,0,0,0);
            const today = new Date();
            today.setHours(0,0,0,0);
            const daysDiff = Math.floor((today.getTime() - grantedDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            const vipDuration = window._vipDuration || 7;
            const daysLeft = vipDuration - daysDiff + 1;
            vipDayText = daysLeft <= 1 
                ? `🏆 — <span style="color:#ff6b6b">Letzter Tag!</span>` 
                : `🏆 — <span style="color:gold">Tag ${daysDiff}/${vipDuration}</span>`;
        }

        const days = student.attendanceDays || [];
        const dayBadges = ['Mo', 'Di', 'Mi', 'Do', 'Fr'].map(d => 
            `<span style="font-size:0.65rem; padding:2px 4px; border-radius:4px; background:${days.includes(d) ? 'var(--primary-light)' : 'rgba(255,255,255,0.05)'}; opacity:${days.includes(d) ? '1' : '0.3'}; margin-right:2px;">${d}</span>`
        ).join('');

        item.innerHTML = `
            <div class="student-info">
                <div class="avatar" style="${isVip ? 'box-shadow: 0 0 12px gold; border: 2px solid gold;' : ''}">${student.avatar || student.name.charAt(0)}</div>
                <div style="flex:1">
                    <div style="font-weight:700; font-size:1.1rem">${student.name} ${isVip ? `<span style="font-size:0.7rem; font-weight:900; letter-spacing:0.05em; margin-left:8px;">${vipDayText}</span>` : ''}</div>
                    <div style="display:flex; align-items:center; gap:10px; margin-top:4px;">
                        <div class="subtitle" style="font-size:0.75rem">${dayBadges}</div>
                        <div style="font-size:0.75rem; color:var(--accent);">🕒 ${student.departureTime || '--:--'}</div>
                    </div>
                    ${student.birthday ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">🎂 ${formatDate(student.birthday)}</div>` : ''}
                </div>
            </div>
            <div class="admin-row-actions">
                <div class="admin-button-group" style="flex-wrap:wrap; justify-content:flex-end;">
                    <button onclick="toggleVip('${student.id}', ${!isVip})" class="icon-btn-small" style="padding:4px 8px; font-size:0.7rem; font-weight:800; ${isVip ? 'color:gold; border-color:gold;' : 'color:var(--text-muted);'}" title="${isVip ? 'Abzeichen entziehen' : 'Abzeichen vergeben'}">
                        🏆 ${isVip ? 'Wochenschüler' : 'Setzen?'}
                    </button>
                    <button class="icon-btn-small" onclick="promptEditAttendance('${student.id}')" title="Tage/Zeit bearbeiten"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    <button class="icon-btn-small" onclick="copyLink('${student.id}')" title="Link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></button>
                    <button class="icon-btn-small" onclick="deleteStudent('${student.id}')" style="color:#ff6b6b"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

function formatDate(s) { const [y,m,d] = s.split('-'); return `${d}.${m}.${y}`; }

async function toggleVip(id, activate) {
    let reason = '';
    if (activate) {
        reason = prompt('Grund für Abzeichen (Wochenschüler):') || 'Leistung der Woche';
    } else {
        if (!confirm(`Abzeichen entziehen?`)) return;
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
    const name = document.getElementById('new-student-name').value;
    const b = document.getElementById('new-student-birthday').value;
    const departure = document.getElementById('new-student-departure').value;
    
    const dayCheckboxes = document.querySelectorAll('.attendance-day:checked');
    const attendanceDays = Array.from(dayCheckboxes).map(cb => cb.value);

    if (!name) return;
    const response = await fetch(`${API_URL}/students`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            name, 
            birthday: b, 
            attendanceDays, 
            departureTime: departure
        })
    });
    if (response.ok) {
        document.getElementById('new-student-name').value = '';
        document.getElementById('new-student-departure').value = '';
        document.querySelectorAll('.attendance-day').forEach(cb => cb.checked = false);
        fetchStudents();
    }
}

async function promptEditAttendance(id) {
    const s = students.find(x => x.id === id);
    if (!s) return;
    
    const newDaysStr = prompt("Betreuungstage (Mo,Di,Mi,Do,Fr durch Komma getrennt):", s.attendanceDays?.join(',') || "");
    const newTime = prompt("Geht-Zeit (z.B. 16:00):", s.departureTime || "");
    
    if (newDaysStr === null || newTime === null) return;
    
    const attendanceDays = newDaysStr.split(',')
        .map(d => d.trim())
        .filter(d => ['Mo','Di','Mi','Do','Fr'].includes(d));
    
    await fetch(`${API_URL}/students/${id}`, {
        method: 'PATCH',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
            attendanceDays,
            departureTime: newTime
        })
    });
    fetchStudents();
}

async function deleteStudent(id) {
    if (!confirm("Löschen?")) return;
    await fetch(`${API_URL}/students/${id}`, {method:'DELETE'});
    fetchStudents();
}

async function updateStamps(id, c) {
    await fetch(`${API_URL}/students/${id}`, {
        method: 'PATCH',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
            stamps: parseInt(c),
            reason: "Admin-Korrektur"
        })
    });
    fetchStudents();
}

function showStatus(m, t) { console.log(m); }
// System Settings
async function loadSettings() {
    try {
        const response = await fetch(`${API_URL}/settings`);
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
            
            if (settings.activities) {
                const text = settings.activities.map(a => `${a.emoji} ${a.label}`).join('\n');
                updateField('setting-activities', text);
            }

            if (settings.groupReward) {
                updateField('setting-group-title', settings.groupReward.title || "Filmtag");
                updateField('setting-group-target', settings.groupReward.target || 8);
                
                // Static displays
                document.getElementById('group-reward-title-display').innerText = `${settings.groupReward.icon || '🎬'} ${settings.groupReward.title}`;
                document.getElementById('group-reward-status').innerText = `${settings.groupReward.current} / ${settings.groupReward.target} Stempel`;
                const progress = Math.min(100, (settings.groupReward.current / settings.groupReward.target) * 100);
                document.getElementById('group-reward-bar').style.width = `${progress}%`;
                
                const isGoalReached = settings.groupReward.current >= settings.groupReward.target;
                const isApproved = settings.groupReward.isApproved;

                if (isGoalReached && !isApproved) {
                    document.getElementById('group-reward-approve-btn').classList.remove('hidden');
                    document.getElementById('group-reward-reset-btn').classList.add('hidden');
                } else if (isApproved) {
                    document.getElementById('group-reward-approve-btn').classList.add('hidden');
                    document.getElementById('group-reward-reset-btn').classList.remove('hidden');
                } else {
                    document.getElementById('group-reward-approve-btn').classList.add('hidden');
                    document.getElementById('group-reward-reset-btn').classList.add('hidden');
                }
            }

            updateField('setting-vip-duration', settings.vipDurationDays || 7);
            window._vipDuration = settings.vipDurationDays || 7;

            updateField('setting-daily-notes', settings.dailyNotes || "");
            updateField('setting-current-projects', settings.currentProjects || "");
            updateField('setting-today-plan', settings.todayPlan || "");
        }
    } catch (err) {}
}

async function saveSettings() {
    const communityVisible = document.getElementById('setting-community-visible').checked;
    const communityTitle = document.getElementById('setting-community-title').value || "Pizza-Party";
    const target = parseInt(document.getElementById('setting-community-target').value);
    
    const activitiesText = document.getElementById('setting-activities').value;
    const dailyNotes = document.getElementById('setting-daily-notes')?.value || "";
    const currentProjects = document.getElementById('setting-current-projects')?.value || "";
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
            const firstSpace = line.indexOf(' ');
            if (firstSpace === -1) return { emoji: "🌟", label: line };
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
            todayPlan: todayPlan,
            groupReward: {
                ...(currentSettings?.groupReward || { current: 0, active: false, icon: "🎬" }),
                title: groupTitle,
                target: groupTarget
            }
        };

        const response = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            // After successful save, update our local cache and clear lastLoaded tracking
            // so the next poll can update the inputs if needed.
            lastLoadedValues = {}; 
            alert("Einstellungen gespeichert!");
            loadSettings();
        }
    } catch (err) {
        alert("Fehler beim Speichern.");
    }
}

async function approveGroupReward() {
    if (!confirm("Gruppen-Belohnung (z.B. Filmtag) jetzt genehmigen? Ein Konfetti-Regen wird auf der Infotafel ausgelöst.")) return;
    try {
        const response = await fetch(`${API_URL}/settings/group-approve`, { method: 'POST' });
        if (response.ok) {
            alert("Belohnung genehmigt! 🎉");
            await loadSettings();
        } else {
            const errBody = await response.text();
            alert(`Fehler: ${response.status} - ${errBody}`);
        }
    } catch (err) {
        alert("Verbindungsfehler bei der Genehmigung: " + err.message);
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
