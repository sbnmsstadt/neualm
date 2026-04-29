const API_URL = "https://stempelkarte.sb-nmsstadt.workers.dev/api";
const PIN_ADMIN = "8520"; 
const PIN_STAMP = "1591"; 
const PIN_SUPERVISOR = "1591"; 

const MAX_STAMPS = 9999;
const STAMPS_PER_LEVEL = 20;

const AVATARS = ["🦁", "🐯", "🦊", "🐭", "🐹", "🐰", "🐻", "🐼", "🐨", "🐸", "🐵", "🦄", "🐙", "🦋", "🦖"];

let selectedActivity = "Stempel";
let selectedActivityEmoji = "🌟";
let ACTIVITIES = [];
let SETTINGS = {};
var syncInterval = null;

let REWARDS = [];
let selectedStampCount = 1;

async function fetchRewards() {
    try {
        const response = await fetch(`${API_URL}/rewards`);
        if (response.ok) {
            const raw = await response.json();
            // Filter inactive rewards (true if undefined or true)
            REWARDS = raw.filter(r => r.active !== false);
            // ensure sorted by threshold
            REWARDS.sort((a,b) => a.threshold - b.threshold);
        }
    } catch (err) {
        console.error("Fehler beim Laden der Belohnungen", err);
    }
}

let students = [];
let currentStudent = null;
let enteredPin = "";
let pinCallback = null;
let isSupervisor = false;
let isDirectLink = false;
let lastActivity = Date.now();
window.addEventListener('mousedown', () => lastActivity = Date.now());
window.addEventListener('touchstart', () => lastActivity = Date.now());
window.addEventListener('keypress', () => lastActivity = Date.now());

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const idParam = urlParams.get('id');
    const savedId = localStorage.getItem('studentId');
    const activeId = idParam || savedId;

    if (idParam) isDirectLink = true;

    // Combined initial load
    await performInitialSync(activeId);
});

async function performInitialSync(id) {
    try {
        const url = id 
            ? `${API_URL}/sync/startup?id=${encodeURIComponent(id)}` 
            : `${API_URL}/sync/startup`;
            
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            
            // 1. Shared Data
            SETTINGS = data.settings || {};
            REWARDS = (data.rewards || []).filter(r => r.active !== false).sort((a,b) => a.threshold - b.threshold);
            
            // 2. Student Data (if logged in)
            if (data.student) {
                currentStudent = data.student;
                localStorage.setItem('studentId', currentStudent.id);
                showDetail(currentStudent);
            } else {
                updateCommunityGoal(null, SETTINGS);
            }
        }
    } catch (err) {
        console.error("Initial sync error:", err);
        // Fallback to legacy if something fails
        await fetchRewards();
        await updateCommunityGoal();
    }
}

function toggleRules() {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-rules').classList.remove('hidden');
}

function startSync() {
    stopSync();
    syncInterval = setInterval(() => {
        const isIdle = (Date.now() - lastActivity > 180000); // 3 minutes idle
        if (document.visibilityState === 'visible' && currentStudent && !isSupervisor && !isIdle) {
            silentSync();
        }
    }, 60000); // Poll every 60s instead of 30s
}

function stopSync() {
    if (typeof syncInterval !== 'undefined' && syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
}

async function silentSync() {
    if (!currentStudent) return;
    try {
        // Optimized: Single request for both student data and global settings
        const response = await fetch(`${API_URL}/sync/student?id=${encodeURIComponent(currentStudent.id)}`);

        if (response.ok) {
            const data = await response.json();
            const { student: freshData, settings: freshSettings } = data;
            
            // Check for changes in student data
            const studentChanged = JSON.stringify(freshData) !== JSON.stringify(currentStudent);
            
            // Check for changes in settings (especially group reward or celebration)
            const settingsChanged = JSON.stringify(freshSettings.groupReward) !== JSON.stringify(SETTINGS.groupReward) ||
                                   JSON.stringify(freshSettings.celebration) !== JSON.stringify(SETTINGS.celebration);

            if (studentChanged || settingsChanged) {
                currentStudent = freshData;
                SETTINGS = freshSettings;
                updateStampDisplay(currentStudent);
                renderRewards(currentStudent);
                renderTamagotchiUI(SETTINGS.tamagotchi, currentStudent);
                // Also update home screen if needed (community goal)
                updateCommunityGoal(null, freshSettings); 
            }

            // Check for group celebration trigger
            if (freshSettings.celebration && freshSettings.celebration.active) {
                const lastId = localStorage.getItem('lastCelebrationId');
                if (lastId !== String(freshSettings.celebration.id)) {
                    showCelebration(freshSettings.celebration);
                }
            }
        }
    } catch (err) {
        console.error("Sync error:", err);
    }
}

async function loginWithId(id = null) {
    const idInput = document.getElementById('student-id-input');
    const studentId = (id || (idInput ? idInput.value.trim() : "")).toLowerCase();
    
    if (!studentId) {
        if (!id) alert("Bitte dein Kürzel eingeben.");
        return;
    }

    try {
        const response = await fetch(`${API_URL}/students/${studentId}`);
        if (response.ok) {
            currentStudent = await response.json();
            localStorage.setItem('studentId', currentStudent.id);
            showDetail(currentStudent);
        } else {
            if (!id && idInput) alert("Kürzel nicht gefunden.");
            localStorage.removeItem('studentId');
        }
    } catch (err) {
        console.error("Fetch error:", err);
    }
}

function logout() {
    localStorage.removeItem('studentId');
    stopSync();
    showHome();
}

function showHome() {
    isSupervisor = false;
    isDirectLink = false;
    stopSync();
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-home').classList.remove('hidden');
    updateCommunityGoal();
}

function showList() {
    if (!isSupervisor) return;
    stopSync();
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-list').classList.remove('hidden');
    fetchStudents();
}

async function fetchStudents() {
    try {
        const response = await fetch(`${API_URL}/students`);
        if (response.ok) {
            students = await response.json();
            renderStudentList();
        }
    } catch (err) {
        console.error("API error:", err);
    }
}

function renderStudentList() {
    const container = document.getElementById('student-container');
    container.innerHTML = '';

    students.forEach((s, index) => {
        const card = document.createElement('div');
        card.className = 'glass-card student-item';
        card.onclick = () => showDetail(s);
        card.innerHTML = `
            <div class="student-info">
                <div class="avatar">${s.avatar || s.name.charAt(0)}</div>
                <div class="student-name">${s.name}</div>
            </div>
            <div class="stamp-count">${s.stamps} / ${MAX_STAMPS}</div>
        `;
        container.appendChild(card);
    });
}

function showDetail(student) {
    currentStudent = student;
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-detail').classList.remove('hidden');
    
    document.getElementById('detail-name').innerText = student.name;
    const avatar = student.avatar || student.name.charAt(0);
    const streak = calculateStreak(student.history || []);
    const streakHTML = streak > 1 ? `<span class="fire-icon">🔥 ${streak} Tage</span>` : '';
    
    const vipBadge = (student.vip && student.vip.active) 
        ? `<span class="vip-badge">⭐ VIP</span>` 
        : '';
    document.getElementById('detail-name').innerHTML = `${student.name} ${streakHTML} ${vipBadge}`;
    document.getElementById('detail-avatar').innerText = avatar;
    
    const addBtn = document.getElementById('add-stamp-button');
    const logoutBtn = document.getElementById('logout-btn');
    const backBtn = document.querySelector('.supervisor-back');

    if (isSupervisor) {
        addBtn.classList.remove('hidden');
        logoutBtn.classList.add('hidden');
        backBtn.classList.remove('hidden');
        stopSync();
    } else {
        addBtn.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
        backBtn.classList.add('hidden');
        startSync();
    }

        updateStampDisplay(student);
        renderRewards(student);
        renderBadges(student);
        renderHistory(student.history || []);
        
        // --- Tamagotchi Sync ---
        // Use existing SETTINGS from sync/initial
        if (SETTINGS && SETTINGS.tamagotchi) {
            renderTamagotchiUI(SETTINGS.tamagotchi, student);
        } else {
            // Fallback just in case
            fetch(`${API_URL}/settings`).then(r => r.json()).then(set => {
                SETTINGS = set;
                renderTamagotchiUI(SETTINGS.tamagotchi, student);
            });
        }
    const aiSection = document.getElementById('ai-section');
    const aiText = document.getElementById('ai-motivation-student');
    if (aiSection && aiText) {
        const cacheKey = `ai_motivation_${student.id}_${new Date().toISOString().split('T')[0]}`;
        const cached = localStorage.getItem(cacheKey);

        // NEW: Ignore cache if it contains the fallback message (fixed the "stuck" error)
        if (cached && !cached.includes("kurze Pause")) {
            console.log("Loading AI message from cache...");
            aiSection.classList.remove('hidden');
            aiText.innerText = cached;
        } else {
            console.log("Fetching new personal AI motivation for:", student.id);
            aiSection.classList.remove('hidden');
            aiText.innerText = "NACHMI überlegt sich gerade was ganz Besonderes für dich... ✨";
            
            // Fetch personal motivation on demand
            fetch(`${API_URL}/ai/student-motivation?id=${encodeURIComponent(student.id)}`)
                .then(r => r.json())
                .then(data => {
                    if (data.text && !data.debugError) {
                        console.log("AI message received!");
                        aiText.innerText = data.text;
                        localStorage.setItem(cacheKey, data.text);
                    } else if (data.debugError) {
                        // NEW: Show debug info if backend failed but returned JSON
                        aiText.innerText = `NACHMI macht gerade eine kurze Pause. ✨ (Fehler: ${data.debugError})`;
                        console.error("AI Debug Error:", data.debugError, data.debugDetails);
                    } else {
                        throw new Error("No text or error in AI response");
                    }
                })
                .catch(err => {
                    console.error("Personal AI error:", err);
                    aiText.innerText = "NACHMI macht gerade eine kurze Pause. ✨ Sammle weiter Stempel!";
                    // Do NOT add 'hidden' back if it already flashed, keep the card visible with fallback text
                });
        }
    }
    // Birthday Surprise
    if (student.birthday) {
        const today = new Date();
        const bday = new Date(student.birthday);
        if (today.getDate() === bday.getDate() && today.getMonth() === bday.getMonth()) {
            const key = `birthday_confetti_${student.id}_${today.getFullYear()}`;
            if (!localStorage.getItem(key)) {
                fireConfetti();
                localStorage.setItem(key, 'true');
                // Optional: show a small message
                setTimeout(() => alert(`🎉 Alles Gute zum Geburtstag, ${student.name}! 🎂`), 500);
            }
        }
    }

    // Tamagotchi Section
    const tamaSection = document.getElementById('tamagotchi-section');
    const tamaName = document.getElementById('tama-ui-name');
    const tamaAvatar = document.getElementById('tama-ui-avatar');

    if (tamaSection && SETTINGS.tamagotchi && SETTINGS.tamagotchi.status === "hatched") {
        tamaSection.classList.remove('hidden');
        if (tamaName) tamaName.innerText = SETTINGS.tamagotchi.name || "Pixelino";
        
        let avatar = "🐣";
        const stage = SETTINGS.tamagotchi.stage;
        if (stage === "baby") avatar = "🐣";
        else if (stage === "child") avatar = "🐥";
        else if (stage === "teen") avatar = "🐦";
        else if (stage === "adult") avatar = "🦉";
        
        if (SETTINGS.tamagotchi.stats.hunger < 20 || SETTINGS.tamagotchi.stats.thirst < 20) avatar = "🤒";
        else if (SETTINGS.tamagotchi.stats.love < 30) avatar = "😢";
        
        if (tamaAvatar) tamaAvatar.innerText = avatar;
    } else if (tamaSection) {
        tamaSection.classList.add('hidden');
    }
}

function renderRewards(student) {
    const list = document.getElementById('reward-list');
    if (!list) return;
    list.innerHTML = '';
    
    const stamps = student.stamps;
    const redemptions = student.redemptions || {};
    
    // Compute total "used" stamps (how many were spent)
    // Preference: student.usedStamps from server, Fallback: sum of all confirmed thresholds
    let usedStamps = student.usedStamps || 0;
    if (usedStamps === 0 && student.redemptions) {
        Object.entries(redemptions).forEach(([t, s]) => {
            if (s === 'completed') usedStamps += parseInt(t);
        });
    }
    const freeStamps = stamps - usedStamps;

    // --- NEW: Group Reward Donation Button (Conditional) ---
    const donateBtn = document.getElementById('group-contribute-btn');
    const isGroupActive = SETTINGS.groupReward && SETTINGS.groupReward.active;
    const isFull = isGroupActive && (SETTINGS.groupReward.current >= SETTINGS.groupReward.target);

    if (donateBtn) {
        if (!isSupervisor && isGroupActive) {
            donateBtn.classList.remove('hidden');
            if (isFull) {
                donateBtn.innerText = "🎬 Ziel erreicht!";
                donateBtn.disabled = true;
                donateBtn.style.opacity = "0.7";
            } else if (freeStamps < 1) {
                donateBtn.innerText = "🎬 1 Stempel spenden";
                donateBtn.disabled = true;
                donateBtn.style.opacity = "0.5";
            } else {
                donateBtn.innerText = "🎬 1 Stempel spenden";
                donateBtn.disabled = false;
                donateBtn.style.opacity = "1";
            }
        } else {
            donateBtn.classList.add('hidden');
        }
    }
        
    // NEW: Live Status Bar in Detail View
    const donateContainer = document.getElementById('group-reward-detail-container');
    if (donateContainer) {
        if (isGroupActive) {
            donateContainer.classList.remove('hidden');
            
            const gTitle = SETTINGS.groupReward.title || 'Filmtag';
            const gCurrent = SETTINGS.groupReward.current || 0;
            const gTarget = SETTINGS.groupReward.target || 8;
            const gPercent = Math.min(100, (gCurrent / gTarget) * 100);

            document.getElementById('group-reward-detail-label').innerText = `🎬 ${gTitle} Stand`;
            document.getElementById('group-reward-detail-numbers').innerText = `${gCurrent} / ${gTarget}`;
            document.getElementById('group-reward-detail-bar').style.width = `${gPercent}%`;
        } else {
            donateContainer.classList.add('hidden');
        }
    }
    // ------------------------------------------

    REWARDS.forEach(reward => {
        const item = document.createElement('div');
        const reqThreshold = parseInt(reward.threshold);
        const isMilestone = reqThreshold >= 60;
        const isReached = isMilestone ? (stamps >= reqThreshold) : (freeStamps >= reqThreshold);
        const progress = Math.min(100, (isMilestone ? (stamps / reqThreshold) : (freeStamps / reqThreshold)) * 100);
        
        const status = redemptions[reward.threshold]; // undefined, 'pending', 'completed'
        
        item.className = `glass-card reward-item ${isReached ? 'unlocked' : ''} ${status === 'completed' ? 'redeemed' : ''}`;
        
        let actionHTML = '';
        if (isReached) {
            if (status === 'pending') {
                actionHTML = '<span class="reward-status warning">Angefragt ⏳</span>';
            } else if (status === 'completed') {
                // Milestone is one-and-done usually, or re-redeemable by total
                if (isMilestone ? (stamps >= reqThreshold) : (freeStamps >= reqThreshold)) {
                    actionHTML = `<button class="redeem-btn" onclick="requestRedemption(${reward.threshold})">Nochmal</button>`;
                } else {
                    actionHTML = '<span class="reward-status success">Eingelöst ✅</span>';
                }
            } else {
                actionHTML = `<button class="redeem-btn" onclick="requestRedemption(${reward.threshold})">Einlösen</button>`;
            }
        } else {
            actionHTML = `<span class="reward-status" style="font-size:0.7rem; opacity:0.5;">Gesperrt 🔒</span>`;
        }

        item.innerHTML = `
            <div class="reward-icon">${reward.icon}</div>
            <div style="flex:1">
                <div class="reward-title">${reward.title}</div>
                <div class="reward-desc">${reward.desc}</div>
                <div class="reward-progress-bg">
                    <div class="reward-progress-bar" style="width: ${progress}%"></div>
                </div>
            </div>
            <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; justify-content:center; min-width:80px;">
                <div style="font-size: 0.65rem; font-weight: 900; color: var(--text-muted); margin-bottom: 4px; letter-spacing: 0.05em;">
                    ${reward.threshold} STEMPEL
                </div>
                ${actionHTML}
            </div>
        `;
        list.appendChild(item);
    });
}

async function requestRedemption(threshold) {
    if (!currentStudent) return;
    try {
        const response = await fetch(`${API_URL}/students/${currentStudent.id}/redeem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ threshold: threshold })
        });
        if (response.ok) {
            currentStudent = await response.json();
            renderRewards(currentStudent);
            alert("Einlösung angefragt! Der Admin wird es bald bestätigen.");
        } else {
            alert("Fehler: Server hat den Befehl nicht erkannt. Hast du die neue worker.js schon auf Cloudflare hochgeladen?");
        }
    } catch (err) {
        alert("Fehler bei der Anfrage. Keine Verbindung zum Server.");
    }
}

function goBack() {
    if (isDirectLink) return;
    if (isSupervisor) {
        showList();
    } else {
        showHome();
    }
}

function updateStampDisplay(student) {
    const mainGrid = document.getElementById('stamp-grid');
    const text = document.getElementById('detail-stamps-text');
    if (!mainGrid) return;
    mainGrid.innerHTML = '';
    text.innerText = `${student.stamps} von ${MAX_STAMPS} Stempel gesammelt`;

    // Checkmarks: based on TOTAL stamps ever spent (used)
    let usedStamps = student.usedStamps || 0;
    
    // If usedStamps is 0 (old data or start), try to reconstruct it from redemptions
    if (usedStamps === 0 && student.redemptions) {
        let sum = 0;
        Object.entries(student.redemptions).forEach(([t, s]) => {
            if (s === 'completed') sum += parseInt(t);
        });
        usedStamps = sum;
    }
    const maxCompletedRedemption = usedStamps;

    // Create levels dynamically
    const dotsContainer = document.getElementById('carousel-dots');
    dotsContainer.innerHTML = '';

    const numLevels = Math.max(3, Math.floor(student.stamps / STAMPS_PER_LEVEL) + 1);

    for (let l = 1; l <= numLevels; l++) {
        const levelContainer = document.createElement('div');
        levelContainer.className = 'level-group';
        levelContainer.dataset.level = l;
        
        const start = (l - 1) * STAMPS_PER_LEVEL + 1;
        const end = l * STAMPS_PER_LEVEL;
        const isUnlocked = student.stamps >= (l - 1) * STAMPS_PER_LEVEL;

        const levelNames = ["Stempel-Lehrling 🌱", "Stempel-Profi ⭐", "Stempel-Legende 👑"];
        const levelName = levelNames[l - 1] || `Karte ${l}`;

        levelContainer.innerHTML = `
            <div class="level-header ${isUnlocked ? 'active' : ''}">
                <span>${levelName}</span>
                <span class="level-range">${start}-${end}</span>
            </div>
            <div class="stamp-grid-20"></div>
        `;

        const grid = levelContainer.querySelector('.stamp-grid-20');
        for (let i = start; i <= end; i++) {
            const slot = document.createElement('div');
            let isFilled = i <= student.stamps;
            let isChecked = i <= maxCompletedRedemption;
            
            slot.className = `stamp-slot ${isFilled ? 'filled' : ''} ${isChecked ? 'checked' : ''}`;
            if (isChecked) {
                slot.innerText = '✔';
            } else if (isFilled) {
                slot.innerText = '★';
            } else {
                slot.innerText = '';
            }
            grid.appendChild(slot);
        }
        mainGrid.appendChild(levelContainer);

        // Add Dot
        const dot = document.createElement('div');
        dot.className = 'dot';
        dot.dataset.target = l;
        dotsContainer.appendChild(dot);
    }

    // Scroll listener for dots
    mainGrid.onscroll = () => {
        const scrollPos = mainGrid.scrollLeft;
        const width = mainGrid.offsetWidth;
        const activeIdx = Math.round(scrollPos / width);
        document.querySelectorAll('.dot').forEach((d, i) => {
            d.classList.toggle('active', i === activeIdx);
        });
    };

    // Auto-scroll to current level
    const currentLevel = Math.floor(student.stamps / STAMPS_PER_LEVEL) + 1;
    
    // Glitter Explosion (Confetti) Logic
    const milestones = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200];
    milestones.forEach(m => {
        if (student.stamps >= m) {
            const key = `confetti_${student.id}_${m}`;
            if (!localStorage.getItem(key)) {
                fireConfetti();
                localStorage.setItem(key, 'true');
            }
        }
    });

    setTimeout(() => {
        const target = mainGrid.querySelector(`.level-group[data-level="${currentLevel}"]`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            // Initial dot update
            document.querySelectorAll('.dot').forEach((d, i) => {
                d.classList.toggle('active', i === (currentLevel - 1));
            });
        }
    }, 100);
}


// PIN Overlay
function openPinOverlay(callback, title = "PIN") {
    document.getElementById('pin-overlay').classList.add('active');
    document.querySelector('#pin-overlay h3').innerText = title;
    enteredPin = "";
    pinCallback = callback;
    updatePinDisplay();
}

function openSupervisorPin() {
    openPinOverlay((pin) => {
        if (pin === PIN_SUPERVISOR) {
            isSupervisor = true;
            showList();
            return true;
        }
        return false;
    }, "Betreuer Login");
}

function openAdminPin() {
    openPinOverlay((pin) => {
        if (pin === PIN_ADMIN) {
            window.location.href = 'admin/index.html';
            return true;
        }
        return false;
    }, "Admin-PIN");
}

function openStampPin(skipOverlay = false) {
    // Always show activity picker first to get the reason
    if (!skipOverlay && document.getElementById('activity-overlay').classList.contains('active') === false) {
        openActivityOverlay();
        return;
    }

    // If already in supervisor mode, we don't need the PIN again
    if (isSupervisor) {
        addStamp(selectedStampCount);
        return;
    }

    openPinOverlay((pin) => {
        if (pin === PIN_STAMP) {
            addStamp(selectedStampCount);
            return true;
        }
        return false;
    }, "Stempel vergeben");
}

function closePinOverlay() {
    document.getElementById('pin-overlay').classList.remove('active');
}

function addPin(num) {
    if (enteredPin.length < 4) {
        enteredPin += num;
        updatePinDisplay();
        if (enteredPin.length === 4) {
            setTimeout(validatePin, 200);
        }
    }
}

function clearPin() {
    enteredPin = "";
    updatePinDisplay();
}

function updatePinDisplay() {
    const display = document.getElementById('pin-display');
    display.innerText = "•".repeat(enteredPin.length);
}

function validatePin() {
    if (typeof pinCallback !== 'function') return;
    const success = pinCallback(enteredPin);
    if (success) {
        closePinOverlay();
    } else {
        alert("Falscher PIN!");
        clearPin();
    }
}

async function addStamp(count = 1) {
    if (!currentStudent) return;
    const newCount = currentStudent.stamps + count;
    try {
        const response = await fetch(`${API_URL}/students/${currentStudent.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                stamps: newCount,
                reason: selectedActivity 
            })
        });
        if (response.ok) {
            currentStudent = await response.json();
            updateStampDisplay(currentStudent);
            renderRewards(currentStudent);
            renderHistory(currentStudent.history || []);
            
            // Reset activity for next time
            selectedActivity = "Stempel";
            selectedActivityEmoji = "🌟";
            
            // Close any remaining overlays (like activity or pin)
            closeActivityOverlay();
            closePinOverlay();
        }
    } catch (err) {
        alert("Fehler beim Speichern.");
    }
}
// Community Goal
async function updateCommunityGoal(providedStudents = null, providedSettings = null) {
    try {
        let allStudents = providedStudents;
        let settings = providedSettings || SETTINGS;

        // Use the optimized total from settings if available
        const hasOptimizedTotal = settings && settings.communityTotal !== undefined;

        if (!hasOptimizedTotal && !allStudents) {
            // Only fallback to full list fetch if we don't have the optimized total
            const [stRes, setRes] = await Promise.all([
                fetch(`${API_URL}/students`),
                fetch(`${API_URL}/settings`)
            ]);
            if (stRes.ok && setRes.ok) {
                allStudents = await stRes.json();
                settings = await setRes.json();
                SETTINGS = settings;
            }
        }
        
        if (settings) {
            // 1. Community Goal
            const cGoalContainer = document.getElementById('community-goal-container');
            if (cGoalContainer) {
                if (settings.communityGoalVisible === false) {
                    cGoalContainer.style.display = 'none';
                } else {
                    cGoalContainer.style.display = 'block';
                    const target = settings.communityTarget || 500;
                    const title = settings.communityTitle || "Pizza-Party";
                    
                    // Use optimized total or calculate from list
                    const total = hasOptimizedTotal 
                        ? settings.communityTotal 
                        : (allStudents ? allStudents.reduce((sum, s) => sum + (s.stamps || 0), 0) : 0);
                        
                    const progress = Math.min(100, (total / target) * 100);
                    
                    document.getElementById('community-title-label').innerText = `🌍 ${title}`;
                    document.getElementById('community-total-text').innerText = `${total} / ${target}`;
                    document.getElementById('community-progress-bar').style.width = `${progress}%`;
                }
            }

            // 2. Group Reward (Filmtag)
            const gHome = document.getElementById('group-reward-home');
            const gTitle = document.getElementById('group-reward-title-home');
            const gStatus = document.getElementById('group-reward-status-home');
            const gBar = document.getElementById('group-reward-bar-home');

            if (settings.groupReward && gHome) {
                gHome.style.display = settings.groupReward.active ? 'block' : 'none';
                if (gTitle) gTitle.innerText = `${settings.groupReward.icon || '🎬'} ${settings.groupReward.title}`;
                if (gStatus) gStatus.innerText = `${settings.groupReward.current} / ${settings.groupReward.target}`;
                const gProgress = Math.min(100, (settings.groupReward.current / settings.groupReward.target) * 100);
                if (gBar) gBar.style.width = `${gProgress}%`;
            }
        }
    } catch (err) {
        console.error("Fehler beim Community-Goal Update", err);
    }
}

// Celebration (Confetti)
function showCelebration(data) {
    localStorage.setItem('lastCelebrationId', data.id);
    document.getElementById('celebration-text').innerText = `Herzlichen Glückwunsch! Der ${data.title || 'Filmtag'} wurde genehmigt! 🍿🎬`;
    
    // Switch to celebration view
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-celebration').classList.remove('hidden');
    
    fireConfetti();
}

function fireConfetti() {
    const duration = 5 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10001 };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        // since particles fall down, start a bit higher than random
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
}

function closeCelebration() {
    document.getElementById('view-celebration').classList.add('hidden');
    showHome();
}

// Streak Calculation
function calculateStreak(history) {
    if (!history || history.length === 0) return 0;
    
    // Sort and unique dates, handling both strings and objects
    const dateStrings = history.map(h => typeof h === 'string' ? h : h.date);
    const dates = [...new Set(dateStrings)].sort();
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Helper to get date object from string (local time)
    const parse = (s) => new Date(s);
    
    let current = todayStr;
    let streak = 0;
    
    // Check if last stamp was today or yesterday
    const lastDate = dates[dates.length - 1];
    const diffToToday = (parse(todayStr) - parse(lastDate)) / (1000 * 60 * 60 * 24);
    
    if (diffToToday > 1) return 0; // Streak broken

    // Count backwards
    let checkDate = parse(lastDate);
    for (let i = dates.length - 1; i >= 0; i--) {
        const d = parse(dates[i]);
        const diff = (checkDate - d) / (1000 * 60 * 60 * 24);
        
        if (diff === 0) {
            streak++;
        } else if (diff === 1) {
            streak++;
            checkDate = d;
        } else {
            break;
        }
    }
    return streak;
}

// Avatar Picker
function openAvatarPicker() {
    if (isSupervisor) return; // Normally students pick their own
    const overlay = document.getElementById('avatar-overlay');
    const list = document.getElementById('avatar-list');
    list.innerHTML = '';
    
    AVATARS.forEach(emoji => {
        const btn = document.createElement('div');
        btn.className = 'avatar-item';
        btn.innerText = emoji;
        btn.onclick = () => selectAvatar(emoji);
        list.appendChild(btn);
    });
    
    overlay.classList.add('active');
}

function closeAvatarOverlay() {
    document.getElementById('avatar-overlay').classList.remove('active');
}

async function selectAvatar(emoji) {
    if (!currentStudent) return;
    
    // Optimistic UI update
    currentStudent.avatar = emoji;
    document.getElementById('detail-avatar').innerText = emoji;
    closeAvatarOverlay();

    // Persist to server (Will work fully after Phase 2, but PATCH now for stamps)
    try {
        const response = await fetch(`${API_URL}/students/${currentStudent.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatar: emoji })
        });
        if (response.ok) {
            console.log("Avatar saved.");
        }
    } catch (err) {
        console.error("Fehler beim Speichern des Avatars.");
    }
}

async function renderBadges(student) {
    const section = document.getElementById('badge-section');
    const list = document.getElementById('student-badge-list');
    if (!section || !list) return;

    const studentBadgeIds = student.badges || [];
    if (studentBadgeIds.length === 0) {
        section.classList.add('hidden');
        return;
    }

    // Fetch badge definitions
    let allBadges = [];
    try {
        const res = await fetch(`${API_URL}/badges`);
        if (res.ok) allBadges = await res.json();
    } catch (e) { /* silently skip */ }

    const earned = allBadges.filter(b => studentBadgeIds.includes(b.id));
    if (earned.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    list.innerHTML = earned.map(b => `
        <div style="
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 12px 16px;
            background: ${b.color}15;
            border: 1px solid ${b.color}55;
            border-radius: 14px;
            animation: fadeIn 0.4s ease-out both;
        ">
            <div style="
                font-size: 2rem;
                width: 48px;
                height: 48px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: ${b.color}25;
                border-radius: 12px;
                flex-shrink: 0;
            ">${b.emoji}</div>
            <div>
                <div style="font-weight: 900; font-size: 1rem; color: ${b.color};">${b.name}</div>
                ${b.description ? `<div style="font-size: 0.78rem; color: rgba(255,255,255,0.6); margin-top: 2px;">${b.description}</div>` : ''}
            </div>
        </div>
    `).join('');
}

function renderHistory(history) {
    const container = document.getElementById('history-list');
    if (!container) return;
    container.innerHTML = '';
    
    if (history.length === 0) {
        container.innerHTML = '<i style="font-size:0.7rem; color:var(--text-muted)">Noch keine Einträge.</i>';
        return;
    }

    // Show last 5 entries
    const lastEntries = [...history].reverse().slice(0, 5);
    
    lastEntries.forEach(entry => {
        const isObj = typeof entry === 'object';
        const dateStr = isObj ? entry.date : entry;
        const reason = isObj ? entry.reason : "Stempel";
        
        const [y, m, d] = dateStr.split('-');
        const formattedDate = `${d}.${m}.`;

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
            <div style="display:flex; align-items:center;">
                <span class="history-reason">${reason}</span>
            </div>
            <span class="history-date">${formattedDate}</span>
        `;
        container.appendChild(item);
    });
}

// Activity Picker
async function openActivityOverlay() {
    document.getElementById('activity-overlay').classList.add('active');
    document.getElementById('custom-activity').value = '';
    setStampCount(1); // Reset to 1 by default
    
    // Load from server settings
    try {
        const res = await fetch(`${API_URL}/settings`);
        if (res.ok) {
            const settings = await res.json();
            ACTIVITIES = settings.activities || [];
            renderActivityPicker();
        }
    } catch (err) {
        console.error("Fehler beim Laden der Aktivitäten");
    }
}

function renderActivityPicker() {
    const list = document.getElementById('activity-list');
    if (!list) return;
    list.innerHTML = '';
    
    ACTIVITIES.forEach(act => {
        const item = document.createElement('div');
        item.className = 'activity-btn';
        if (selectedActivity === act.label) item.classList.add('active');
        
        item.onclick = (e) => selectActivity(act.label, act.emoji, e);
        item.innerHTML = `
            <span class="activity-emoji">${act.emoji}</span>
            <span class="activity-label">${act.label}</span>
        `;
        list.appendChild(item);
    });
}

function closeActivityOverlay() {
    document.getElementById('activity-overlay').classList.remove('active');
}

function selectActivity(reason, emoji, event) {
    selectedActivity = reason;
    selectedActivityEmoji = emoji;
    
    // Visual feedback
    document.querySelectorAll('#activity-list .activity-btn').forEach(el => el.classList.remove('active'));
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
}

function confirmActivity() {
    const custom = document.getElementById('custom-activity').value.trim();
    if (custom) {
        selectedActivity = custom;
        selectedActivityEmoji = "📝"; // Neutral icon instead of star
    }
    // Don't close overlay here, let openStampPin with skipOverlay handle the flow
    openStampPin(true);
}

function setStampCount(n) {
    selectedStampCount = n;
    const btn1 = document.getElementById('count-1');
    const btn2 = document.getElementById('count-2');
    if (btn1) btn1.classList.toggle('active', n === 1);
    if (btn2) btn2.classList.toggle('active', n === 2);
}

async function contributeGroupReward() {
    if (!currentStudent) return;
    if (!confirm("Möchtest du 1 Stempel für das Gruppen-Ziel spenden?")) return;
    
    try {
        const res = await fetch(`${API_URL}/students/${currentStudent.id}/group-contribute`, {
            method: 'POST'
        });
        
        if (res.ok) {
             const updated = await res.json();
             currentStudent = updated;
             
             // IMPORTANT: Force refresh global settings BEFORE showing detail
             await updateCommunityGoal();
             
             alert("Danke für deine Spende! 🎬✨");
             showDetail(currentStudent);
        } else {
             const msg = await res.text();
             alert(msg || "Fehler bei der Spende.");
        }
    } catch (err) {
        alert("Fehler bei der Verbindung.");
    }
}

// Badge Info Modal
async function openBadgeInfo() {
    const overlay = document.getElementById('badge-info-overlay');
    const grid = document.getElementById('all-badges-grid');
    if (!overlay || !grid) return;

    grid.innerHTML = '<div style="text-align:center; padding: 20px; opacity:0.6;">Suche Abzeichen... ✨</div>';
    overlay.classList.add('active');

    try {
        const res = await fetch(`${API_URL}/badges`);
        if (!res.ok) throw new Error("Fetch failed");
        const allBadges = await res.json();
        
        const studentBadgeIds = currentStudent ? (currentStudent.badges || []) : [];
        
        grid.innerHTML = allBadges.map(b => {
            const isEarned = studentBadgeIds.includes(b.id);
            return `
                <div class="badge-info-item ${isEarned ? 'earned' : 'locked'}">
                    <div class="badge-info-icon" style="background: ${b.color}${isEarned ? '20' : '05'}">
                        ${b.emoji}
                    </div>
                    <div class="badge-info-content">
                        <h4 style="color: ${isEarned ? (b.color || 'white') : 'rgba(255,255,255,0.7)'}">${b.name}</h4>
                        <p>${b.description || 'Sammle weiter Stempel!'}</p>
                    </div>
                    <div class="badge-status-tag ${isEarned ? 'earned' : 'locked'}">
                        ${isEarned ? '✅ Erreicht' : '🔒 Noch offen'}
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error("Badge Load Error:", e);
        grid.innerHTML = '<div style="text-align:center; padding: 20px; color: #ef4444;">Abzeichen konnten nicht geladen werden.</div>';
    }
}

function closeBadgeInfoOverlay() {
    document.getElementById('badge-info-overlay').classList.remove('active');
}
function renderTamagotchiUI(tama, student) {
    const section = document.getElementById('tamagotchi-section');
    if (!section) return;
    
    if (!tama || (tama.status !== "hatched" && tama.status !== "dead") || tama.visible === false) {
        section.classList.add('hidden');
        return;
    }
    
    section.classList.remove('hidden');
    
    const isDead = tama.status === "dead";
    const careGrid = document.querySelector('.tama-care-grid');
    if (careGrid) {
        if (isDead) careGrid.style.display = 'none';
        else careGrid.style.display = 'grid';
    }
    
    const nameEl = document.getElementById('tama-ui-name');
    const avatarEl = document.getElementById('tama-ui-avatar');
    const levelEl = document.getElementById('tama-ui-level');
    const xpBarEl = document.getElementById('tama-ui-xp-bar');
    const limitText = document.getElementById('tama-limit-text');
    
    if (nameEl) nameEl.textContent = tama.name || "Pixelino";
    if (avatarEl) {
        if (isDead) {
            avatarEl.textContent = "👻";
        } else {
            let base = (tama.stats.level >= 10) ? "🦖" : "🐣";
            if (tama.isSleeping) base = "😴";
            else if (tama.stats.love < 20) base = "😭";
            else if (tama.stats.hunger < 30 || tama.stats.thirst < 30) base = "😵‍💫";
            else if (tama.stats.hunger > 80 && tama.stats.love > 80) base = (tama.stats.level >= 10) ? "🐲" : "🐥";
            avatarEl.textContent = base;
        }
    }
    if (levelEl) {
        if (isDead) levelEl.textContent = "VERSTORBEN 👻";
        else levelEl.textContent = `LVL ${tama.stats.level || 1}`;
    }
    
    if (xpBarEl) {
        const nextLevelXp = (tama.stats.level || 1) * 100;
        const xpPercent = Math.min(100, ((tama.stats.xp || 0) / nextLevelXp) * 100);
        xpBarEl.style.width = `${xpPercent}%`;
    }
    
    if (limitText && student.tamaActions) {
        const today = new Date().toISOString().split('T')[0];
        const count = student.tamaActions.date === today ? student.tamaActions.count : 0;
        limitText.textContent = `Limit: ${count}/5 heute genutzt`;
        if (count >= 5) limitText.style.color = "#ef4444";
        else limitText.style.color = "rgba(255,255,255,0.3)";
    }

    // --- Educational Action Butler ---
    const btnBrush = document.getElementById('btn-brush');
    const btnRecycle = document.getElementById('btn-recycle');
    
    if (btnBrush) {
        if (tama.needsBrushing) btnBrush.classList.remove('hidden');
        else btnBrush.classList.add('hidden');
    }
    
    if (btnRecycle) {
        if (tama.trashCount > 0) btnRecycle.classList.remove('hidden');
        else btnRecycle.classList.add('hidden');
    }
}

async function careForTama(action, subAction = null) {
    if (!currentStudent) return;
    
    // Store subAction temporarily for the request
    if (action === 'feed' && subAction) {
        currentStudent.lastSubAction = subAction;
    }
    
    try {
        const response = await fetch(`${API_URL}/tamagotchi/care`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                studentId: currentStudent.id, 
                action: action,
                subAction: subAction // Pass subAction to worker
            })
        });

        if (response.ok) {
            const data = await response.json();
            currentStudent = data.student;
            SETTINGS.tamagotchi = data.tamagotchi;
            
            const avatar = document.getElementById('tama-ui-avatar');
            if (avatar) {
                const originalText = avatar.innerText;
                avatar.innerText = (action === "handwash") ? "🧼✨" : "✨✔️"; 
                avatar.style.transform = "scale(1.5) translateY(-5px)";
                avatar.classList.add('tama-interact-pulse'); 
                setTimeout(() => {
                    avatar.innerText = originalText;
                    avatar.style.transform = "scale(1)";
                    avatar.classList.remove('tama-interact-pulse');
                }, 1500);
            }

            // --- Show a toast notification ---
            const toast = document.createElement('div');
            toast.className = 'tama-toast';
            if (action === "style") {
                toast.textContent = "Neues Outfit am Start! 🔥 (24h)";
            } else if (action === "love") {
                toast.textContent = "Tamagotchi liebt dich! ❤️";
            } else if (action === "brush") {
                toast.textContent = "Alles wieder blitzblank geputzt! 🪥✨";
            } else if (action === "recycle") {
                toast.textContent = "Super! Du bist ein Umwelt-Profi! 🌍♻️";
            } else if (action === "feed") {
                toast.textContent = (subAction === 'donut') ? "Yummy! Aber denk an deine Zähne! 🍩" : "Gesund und lecker! 🍎✨";
            } else if (action === "clean") {
                toast.textContent = "Alles wieder blitzblank! 🚿";
            } else if (action === "handwash") {
                toast.textContent = "Hände sind sauber! Jetzt darfst du essen! 🧼✨";
                startHandwashTimer();
            } else {
                toast.textContent = "Tamagotchi freut sich! ✨";
            }
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);

            updateStampDisplay(currentStudent);
            renderRewards(currentStudent);
            renderHistory(currentStudent.history || []);
            renderTamagotchiUI(SETTINGS.tamagotchi, currentStudent);
            
            // Optional: silent sync to update UI
            silentSync();
        } else {
            const msg = await response.text();
            if (response.status === 403 && msg.includes("Hände Waschen")) {
                showTamaReminder(msg);
            } else {
                alert(msg); // Show the specific "limit reached" or other error message
            }
        }
    } catch (err) {
        console.error("Care error:", err);
        alert("Netzwerkfehler beim Pflegen des Klassentiers.");
    }
}

// Custom function for the Tamagotchi "Reminder" Popup
function showTamaReminder(message) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay active';
    overlay.style.zIndex = "10000";
    overlay.innerHTML = `
        <div class="glass-card" style="max-width:320px; text-align:center; padding:2rem; animation: bounceIn 0.5s;">
            <div style="font-size:3rem; margin-bottom:1rem;">🧼🤔</div>
            <h3 style="color:#fbbf24; margin-bottom:1rem;">Halt Stopp!</h3>
            <p style="font-size:1.1rem; line-height:1.4; color:white; font-weight:700;">${message}</p>
            <button onclick="this.closest('.overlay').remove()" class="add-stamp-btn" style="margin-top:1.5rem; width:100%;">Okay, ich wasche sie! 🧼</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

let handwashInterval = null;
function startHandwashTimer() {
    const timerEl = document.getElementById('handwash-timer');
    if (!timerEl) return;
    
    clearInterval(handwashInterval);
    let timeLeft = 60;
    timerEl.innerText = `${timeLeft}s`;
    timerEl.style.display = 'block';
    
    handwashInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(handwashInterval);
            timerEl.style.display = 'none';
        } else {
            timerEl.innerText = `${timeLeft}s`;
        }
    }, 1000);
}
