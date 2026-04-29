const API_URL = "https://neualm-infotafel.sb-nmsstadt.workers.dev/api";
const PIN_ADMIN = "5400"; 

// --- Auth & Setup ---
const appContainer = document.getElementById('app-container');
const loginOverlay = document.getElementById('login-overlay');

function checkAuth() {
    if (sessionStorage.getItem('admin_auth') === PIN_ADMIN) {
        if (loginOverlay) loginOverlay.style.display = 'none';
        if (appContainer) appContainer.style.display = 'block';
        loadProjects();
    } else {
        if (loginOverlay) loginOverlay.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
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

function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.style.background = isError ? '#ff6b6b' : 'var(--success)';
    toast.style.bottom = '20px';
    setTimeout(() => {
        toast.style.bottom = '-100px';
    }, 3000);
}

// Helper utility
function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// --- Project Loading & UI ---

async function loadProjects() {
    try {
        const res = await fetch(`${API_URL}/projects`);
        if (!res.ok) throw new Error("Fehler beim Laden der Projekte");
        const projects = await res.json();
        renderProjects(projects);
    } catch (err) {
        console.error(err);
        showToast("Fehler beim Laden: " + err.message, true);
    }
}

function renderProjects(projects) {
    const sections = {
        current: document.getElementById('projects-current'),
        upcoming: document.getElementById('projects-upcoming'),
        library: document.getElementById('projects-library'),
        archived: document.getElementById('projects-archived')
    };

    // Reset all containers
    Object.values(sections).forEach(s => s.innerHTML = '');

    if (projects.length === 0) {
        sections.library.innerHTML = `
            <div class="empty-state">
                <h3 style="margin-bottom: 10px; color: white;">Noch keine Projekte gespeichert</h3>
                <p>Gehe ins "AI Content Lab" und generiere neue, magische Ideen!</p>
                <button class="add-stamp-btn" style="margin-top: 20px;" onclick="window.location.href='kreativ.html'">Jetzt Ideen finden ✨</button>
            </div>
        `;
        return;
    }

    // Process projects
    projects.forEach((project, index) => {
        const status = project.status || 'library';
        const container = sections[status] || sections.library;

        const card = document.createElement('div');
        card.className = `ai-result-card glass-card card-${status}`;
        
        const dateStr = new Date(project.createdAt).toLocaleDateString();

        let buttons = '';
        if (status === 'library') {
            buttons = `
                <button class="btn-outline btn-outline-accent" onclick="addToPlan('${escapeHtml(project.planText)}', 'setting-today-plan')" style="width: 100%;">
                    📅 Heute umsetzen (Tagesplan)
                </button>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-outline" onclick="updateProjectStatus('${project.id}', 'current')" style="flex: 1; border-color: #10b981; color: #10b981;">🚀 Aktivieren</button>
                    <button class="btn-outline" onclick="updateProjectStatus('${project.id}', 'upcoming')" style="flex: 1; border-color: #f59e0b; color: #f59e0b;">🔜 Einplanen</button>
                </div>
            `;
        } else if (status === 'upcoming') {
            buttons = `
                <button class="btn-outline" onclick="updateProjectStatus('${project.id}', 'current')" style="width: 100%; border-color: #10b981; color: #10b981;">🚀 Jetzt Starten</button>
                <button class="btn-outline" onclick="updateProjectStatus('${project.id}', 'library')" style="width: 100%;">💡 Zurück in Ideen-Kiste</button>
            `;
        } else if (status === 'current') {
            buttons = `
                <button class="btn-outline" onclick="updateProjectStatus('${project.id}', 'archived')" style="width: 100%; border-color: #64748b; color: #64748b;">📦 Projekt abschließen & Archivieren</button>
                <button class="btn-outline" onclick="updateProjectStatus('${project.id}', 'upcoming')" style="width: 100%;">🔜 Zurück zu Geplant</button>
            `;
        } else if (status === 'archived') {
            buttons = `
                <button class="btn-outline" onclick="updateProjectStatus('${project.id}', 'library')" style="width: 100%;">💡 Reaktivieren (Ideen-Kiste)</button>
            `;
        }

        card.innerHTML = `
            <h4 class="ai-result-title">
                ${escapeHtml(project.title)}
                <button class="delete-btn" onclick="deleteProject('${project.id}')" title="Projekt löschen">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </h4>
            <div class="ai-result-date">Gespeichert am ${dateStr}</div>
            <p class="ai-result-desc">${escapeHtml(project.description)}</p>
            <div class="ai-material-list">
                <strong>Benötigt:</strong> ${escapeHtml(project.materials)}
            </div>
            <div class="ai-action-buttons" style="flex-direction: column;">
                ${buttons}
            </div>
        `;
        
        container.appendChild(card);
    });

    // Handle empty sections
    Object.entries(sections).forEach(([key, el]) => {
        if (el.innerHTML === '') {
            el.innerHTML = `<div class="empty-state" style="padding: 1rem; border-style: solid; font-size: 0.8rem;">Keine Projekte in dieser Kategorie.</div>`;
        }
    });
}

// --- Status Management & Auto-Sync ---

async function updateProjectStatus(id, newStatus) {
    if (!id) {
        showToast("Fehler: Keine Projekt-ID gefunden.", true);
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/projects/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        
        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Server-Fehler (${res.status}): ${errBody}`);
        }
        
        showToast(`Verschoben nach: ${newStatus === 'current' ? 'Aktiv' : (newStatus === 'upcoming' ? 'Geplant' : 'Archiv')}... sync läuft...`);
        
        // After status change, sync the board!
        await syncBoardFromProjects();
        await loadProjects(); 
    } catch (err) {
        console.error("Status Update Error:", err);
        alert("Status-Update fehlgeschlagen: " + err.message);
    }
}

async function syncBoardFromProjects() {
    try {
        // 1. Get all projects
        const pRes = await fetch(`${API_URL}/projects`);
        const projects = await pRes.json();
        
        // 2. Get current settings
        const sRes = await fetch(`${API_URL}/settings`);
        const settings = await sRes.json();
        
        // 3. Filter and build strings
        const currentProjectsStr = projects
            .filter(p => p.status === 'current')
            .map(p => `• ${p.title}`)
            .join('\n');
            
        const upcomingProjectsStr = projects
            .filter(p => p.status === 'upcoming')
            .map(p => `• ${p.title}`)
            .join('\n');
            
        // 4. Update settings
        const payload = { 
            ...settings,
            currentProjects: currentProjectsStr,
            upcomingProjects: upcomingProjectsStr
        };
        
        await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
    } catch (err) {
        console.error("Board sync failed:", err);
    }
}

// --- Delete Project ---

async function deleteProject(id) {
    if (!confirm("Möchtest du dieses Projekt wirklich löschen?")) return;

    try {
        const res = await fetch(`${API_URL}/projects/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Fehler beim Löschen");
        showToast("Projekt gelöscht.");
        loadProjects(); // Reload list
    } catch (err) {
        console.error(err);
        showToast("Löschen fehlgeschlagen.", true);
    }
}

// --- Modal & Apply Logic (re-used from old kreativ.js) ---

let pendingSaveData = null;

async function addToPlan(textToAdd, targetField) {
    try {
        const getRes = await fetch(`${API_URL}/settings`, { cache: 'no-store' });
        if (!getRes.ok) throw new Error("Konnte Einstellungen nicht laden");
        
        const settings = await getRes.json();
        
        let propertyName = "";
        let modalTitle = "";
        
        if (targetField === 'setting-today-plan') {
            propertyName = 'todayPlan';
            modalTitle = 'Heutigen Plan bearbeiten';
        } else if (targetField === 'setting-current-projects') {
            propertyName = 'currentProjects';
            modalTitle = 'Aktuelle Projekte bearbeiten';
        } else if (targetField === 'setting-upcoming-projects') {
            propertyName = 'upcomingProjects';
            modalTitle = 'Kommende Projekte bearbeiten';
        } else {
            throw new Error("Unknown target field");
        }

        const currentText = settings[propertyName] || "";
        const combinedText = currentText ? currentText + "\n\n" + textToAdd : textToAdd;
        
        pendingSaveData = {
            settings: settings,
            propertyName: propertyName,
            targetField: targetField
        };
        
        document.getElementById('edit-plan-title').innerHTML = `<span>✏️</span> ${modalTitle}`;
        document.getElementById('edit-plan-textarea').value = combinedText;
        document.getElementById('edit-plan-modal').style.display = 'flex';
        
    } catch (err) {
        console.error("Speicherfehler:", err);
        showToast("Fehler beim Vorbereiten: " + err.message, true);
    }
}

function closePlanModal() {
    document.getElementById('edit-plan-modal').style.display = 'none';
    pendingSaveData = null;
}

async function savePlanEdit() {
    if (!pendingSaveData) return;
    
    const newText = document.getElementById('edit-plan-textarea').value.trim();
    const btn = document.getElementById('save-plan-btn');
    const originalBtnHtml = btn.innerHTML;
    
    try {
        btn.innerHTML = '<div class="loading-spinner" style="width:16px; height:16px; border-width:2px; vertical-align: middle;"></div> Speichere...';
        btn.disabled = true;
        
        const payload = { ...pendingSaveData.settings };
        payload[pendingSaveData.propertyName] = newText;
        
        const putRes = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (putRes.ok) {
            let successMsg = "Gespeichert!";
            if (pendingSaveData.targetField === 'setting-today-plan') successMsg = "Zum heutigen Plan hinzugefügt!";
            else if (pendingSaveData.targetField === 'setting-current-projects') successMsg = "Zu aktuellen Projekten hinzugefügt!";
            else if (pendingSaveData.targetField === 'setting-upcoming-projects') successMsg = "Zu kommenden Projekten hinzugefügt!";
            
            closePlanModal();
            showToast(successMsg);
        } else {
            throw new Error("HTTP Fehler " + putRes.status);
        }
    } catch (err) {
        console.error("Speichern fehlgeschlagen:", err);
        alert("Speichern fehlgeschlagen: " + err.message);
    } finally {
        if (btn) {
            btn.innerHTML = originalBtnHtml;
            btn.disabled = false;
        }
    }
}
