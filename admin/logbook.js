/**
 * Logbook Module for Admin Dashboard
 * Handles pedagogical logs and AI summaries.
 */

const Logbook = {
    currentDate: new Date().toISOString().split('T')[0],
    selectedTypes: {}, // studentId -> type ('pos', 'neg', 'neu')

    init() {
        console.log("Logbook initialized");
        this.currentDate = new Date().toISOString().split('T')[0];
        this.renderBaseLayout();
        this.updateDateDisplay();
    },

    renderBaseLayout() {
        const container = document.getElementById('logbook-view');
        const modalContainer = document.getElementById('global-modals-container');
        if (!container) return;

        // Main View
        container.innerHTML = `
            <div class="logbook-container">
                <div class="logbook-header">
                    <div>
                        <h2 style="font-size: 1.8rem; margin-bottom: 0.5rem;">📖 Pädagogisches Logbuch</h2>
                        <p class="subtitle">Tägliche Beobachtungen und Dokumentation</p>
                    </div>
                    <div class="logbook-controls">
                        <div style="display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.05); padding: 8px 15px; border-radius: 12px; border: 1px solid var(--glass-border);">
                            <label style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">DATUM:</label>
                            <input type="date" id="logbook-date-picker" value="${this.currentDate}" onchange="Logbook.setDate(this.value)" style="background:transparent; border:none; color:white; font-weight:700; cursor:pointer;">
                        </div>
                        <button onclick="Logbook.showArchiveList()" class="icon-btn-small" title="Archivierte Berichte" style="background:rgba(18, 180, 255, 0.1); border-color: #0ea5e9;">
                            📂 Berichts-Archiv
                        </button>
                        <button onclick="Logbook.generateAISummary()" class="add-stamp-btn" style="background: linear-gradient(135deg, #f59e0b, #d97706); border: none; box-shadow: 0 4px 15px rgba(245,158,11,0.3);">
                            ✨ KI Zusammenfassung
                        </button>
                    </div>
                </div>

                <div id="logbook-student-grid" class="logbook-student-grid">
                    <div class="glass-card" style="text-align:center; grid-column: 1/-1;">Lade Schüler...</div>
                </div>
            </div>`;

        // Modals (outside the hidden view)
        if (modalContainer) {
            modalContainer.innerHTML = `
                <!-- Summary Overlay -->
                <div id="summary-overlay" class="summary-overlay hidden">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:1rem;">
                        <h3 style="color:var(--accent); margin:0;">✨ KI Tages-Bericht</h3>
                        <button onclick="Logbook.closeSummary()" style="background:transparent; border:none; color:white; cursor:pointer; font-size:1.5rem;">&times;</button>
                    </div>
                    <div id="summary-content" class="summary-content">
                        <div style="text-align:center; padding:2rem;">
                            <div class="spinner-small" style="margin:0 auto 10px;"></div>
                            <p>KI analysiert den Tag...</p>
                        </div>
                    </div>
                    <button onclick="Logbook.closeSummary()" class="log-save-btn" style="width:100%; margin-top:1.5rem; background:rgba(255,255,255,0.1);">Schließen</button>
                    <button id="archive-summary-btn" onclick="Logbook.archiveSummary()" class="log-save-btn hidden" style="width:100%; margin-top:0.8rem; background:var(--success);">✅ Dieses Archiv speichern</button>
                    <button id="regenerate-summary-btn" onclick="Logbook.generateAISummary(true)" class="log-save-btn hidden" style="width:100%; margin-top:0.8rem; background:rgba(139, 92, 246, 0.4);">🔄 Neu generieren</button>
                    <div id="archived-notice" class="hidden" style="margin-top:1rem; text-align:center; font-size:0.8rem; color:var(--success); font-weight:700;">
                        ✓ Dieser Bericht ist archiviert
                    </div>
                </div>

                <!-- History Modal -->
                <div id="history-modal" class="history-modal-overlay hidden">
                    <div class="history-card">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h2 id="history-student-name">Schüler-Archiv</h2>
                            <button onclick="Logbook.closeHistory()" style="background:transparent; border:none; color:white; cursor:pointer; font-size:1.8rem;">&times;</button>
                        </div>
                        <div id="history-list" class="history-list">
                            <!-- History items go here -->
                        </div>
                    </div>
                </div>
                <!-- Archive List Modal -->
                <div id="archive-list-modal" class="history-modal-overlay hidden">
                    <div class="history-card" style="max-width: 400px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                            <h2 style="margin:0;">📂 Berichts-Archiv</h2>
                            <button onclick="Logbook.closeArchiveList()" style="background:transparent; border:none; color:white; cursor:pointer; font-size:1.8rem;">&times;</button>
                        </div>
                        <div id="archive-list-content" class="history-list">
                            <p class="subtitle" style="text-align:center;">Lade Archiv...</p>
                        </div>
                    </div>
                </div>
            `;
        }
    },

    async renderStudents() {
        const grid = document.getElementById('logbook-student-grid');
        if (!grid) return;

        if (!window.students || window.students.length === 0) {
            grid.innerHTML = '<div class="glass-card" style="text-align:center; grid-column: 1/-1;">Keine Schüler gefunden.</div>';
            return;
        }

        grid.innerHTML = '';
        window.students.forEach(student => {
            const hasLogsToday = student.pedagogical_logs && student.pedagogical_logs.some(l => l.date === this.currentDate);
            const card = document.createElement('div');
            card.className = `logbook-card ${hasLogsToday ? 'has-logs' : ''}`;
            card.dataset.id = student.id;

            const currentType = this.selectedTypes[student.id] || 'neu';

            card.innerHTML = `
                <div class="logbook-card-header">
                    <div class="avatar" style="width:40px; height:40px; font-size:1rem;">${student.avatar || student.name.charAt(0)}</div>
                    <div style="flex:1">
                        <div class="logbook-student-name">${student.name}</div>
                        <div class="subtitle" style="font-size:0.7rem">${hasLogsToday ? '✅ Eintrag vorhanden' : 'Kein Eintrag für heute'}</div>
                    </div>
                    <button class="icon-btn-small" onclick="Logbook.showHistory('${student.id}')" title="Archiv öffnen">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    </button>
                </div>

                <div class="log-input-area">
                    <textarea id="note-${student.id}" class="log-textarea" placeholder="Beobachtung eingeben..."></textarea>
                    
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div class="log-type-buttons" style="flex:1">
                            <button onclick="Logbook.setType('${student.id}', 'pos')" id="btn-pos-${student.id}" class="type-btn btn-pos ${currentType === 'pos' ? 'active' : ''}" title="Positiv">👍</button>
                            <button onclick="Logbook.setType('${student.id}', 'neu')" id="btn-neu-${student.id}" class="type-btn btn-neu ${currentType === 'neu' ? 'active' : ''}" title="Neutral">💬</button>
                            <button onclick="Logbook.setType('${student.id}', 'neg')" id="btn-neg-${student.id}" class="type-btn btn-neg ${currentType === 'neg' ? 'active' : ''}" title="Negativ">👎</button>
                        </div>
                        <button id="save-btn-${student.id}" onclick="Logbook.saveEntry('${student.id}')" class="log-save-btn">
                            Speichern
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    },

    setDate(date) {
        this.currentDate = date;
        this.renderStudents();
    },

    updateDateDisplay() {
        const picker = document.getElementById('logbook-date-picker');
        if (picker) picker.value = this.currentDate;
    },

    setType(studentId, type) {
        this.selectedTypes[studentId] = type;
        // Update UI
        ['pos', 'neg', 'neu'].forEach(t => {
            const btn = document.getElementById(`btn-${t}-${studentId}`);
            if (btn) btn.classList.toggle('active', t === type);
        });
    },

    async saveEntry(studentId) {
        const text = document.getElementById(`note-${studentId}`).value;
        const type = this.selectedTypes[studentId] || 'neu';
        const btn = document.getElementById(`save-btn-${studentId}`);
        
        if (!text.trim()) {
            alert("Bitte einen Text eingeben.");
            return;
        }

        btn.disabled = true;
        btn.innerHTML = `<div class="spinner-small"></div>`;

        try {
            const response = await fetch(`${API_URL}/students/${studentId}/logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    text,
                    date: this.currentDate
                })
            });

            if (response.ok) {
                // Update local student data
                const updatedStudent = await response.json();
                const idx = window.students.findIndex(s => s.id === studentId);
                if (idx !== -1) window.students[idx] = updatedStudent;
                
                // Reset UI for this card
                document.getElementById(`note-${studentId}`).value = '';
                this.renderStudents(); // Re-render to show "✅"
            } else {
                alert("Fehler beim Speichern.");
                btn.disabled = false;
                btn.innerText = "Speichern";
            }
        } catch (err) {
            alert("Verbindungsfehler.");
            btn.disabled = false;
            btn.innerText = "Speichern";
        }
    },

    async generateAISummary(force = false) {
        const modal = document.getElementById('summary-overlay');
        const content = document.getElementById('summary-content');
        
        // Reset buttons
        document.getElementById('archive-summary-btn')?.classList.add('hidden');
        document.getElementById('regenerate-summary-btn')?.classList.add('hidden');
        document.getElementById('archived-notice')?.classList.add('hidden');

        modal.classList.remove('hidden');
        content.innerHTML = `
            <div style="text-align:center; padding:2rem;">
                <div class="spinner-small" style="margin:0 auto 10px; width:40px; height:40px; border-width:4px;"></div>
                <p style="font-weight:700;">KI analysiert den Tag...</p>
                <p class="subtitle">Das kann einige Sekunden dauern.</p>
            </div>
        `;

        try {
            const response = await fetch(`${API_URL}/ai/day-summary?date=${this.currentDate}${force ? '&force=true' : ''}`);
            let data;
            
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                data = await response.json();
            } else {
                data = { text: await response.text() };
            }
            
            if (response.ok) {
                content.innerHTML = data.text;
                
                const archiveBtn = document.getElementById('archive-summary-btn');
                const regenBtn = document.getElementById('regenerate-summary-btn');
                const notice = document.getElementById('archived-notice');
                
                const isEmpty = data.text.includes("Keine Einträge für diesen Tag gefunden.");

                if (data.isArchived) {
                    archiveBtn?.classList.add('hidden');
                    regenBtn?.classList.remove('hidden');
                    notice?.classList.remove('hidden');
                } else {
                    // This is a fresh generation (or regeneration)
                    archiveBtn?.classList.remove('hidden');
                    regenBtn?.classList.add('hidden');
                    notice?.classList.add('hidden');
                    
                    // Reset archive button state in case it was stuck on "Speichere..."
                    if (archiveBtn) {
                        archiveBtn.disabled = false;
                        archiveBtn.innerText = "✅ Dieses Archiv speichern";
                    }
                }
                
                // Always allow regeneration if it's not empty, even if just archived
                if (!isEmpty && data.isArchived) {
                    regenBtn?.classList.remove('hidden');
                }
            } else {
                content.innerHTML = `<p style='color:#ff6b6b'><b>Fehler bei der KI-Generierung:</b><br>${data.text || response.statusText}</p>`;
            }
        } catch (err) {
            content.innerHTML = `<p style='color:#ff6b6b'>Verbindungsfehler zur KI: ${err.message}</p>`;
        }
    },

    async archiveSummary() {
        const content = document.getElementById('summary-content').innerHTML;
        const btn = document.getElementById('archive-summary-btn');
        const notice = document.getElementById('archived-notice');

        btn.disabled = true;
        btn.innerText = "Speichere...";

        try {
            const res = await fetch(`${API_URL}/ai/day-summary/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: this.currentDate,
                    text: content
                })
            });

            if (res.ok) {
                btn.classList.add('hidden');
                notice.classList.remove('hidden');
                // Show regeneration button again so they can overwrite if needed
                document.getElementById('regenerate-summary-btn')?.classList.remove('hidden');
            } else {
                const errData = await res.json().catch(() => ({}));
                alert(`Fehler beim Archivieren: ${errData.message || res.statusText}`);
                btn.disabled = false;
                btn.innerText = "✅ Dieses Archiv speichern";
            }
        } catch (err) {
            console.error("Archive error:", err);
            alert("Verbindungsfehler bei der Übertragun zum Server.");
            btn.disabled = false;
            btn.innerText = "✅ Dieses Archiv speichern";
        }
    },

    closeSummary() {
        document.getElementById('summary-overlay').classList.add('hidden');
    },

    showHistory(studentId) {
        const student = window.students.find(s => s.id === studentId);
        if (!student) return;

        const modal = document.getElementById('history-modal');
        const nameEl = document.getElementById('history-student-name');
        const listEl = document.getElementById('history-list');

        nameEl.innerText = `Archiv: ${student.name}`;
        modal.classList.remove('hidden');

        const logs = student.pedagogical_logs || [];
        if (logs.length === 0) {
            listEl.innerHTML = '<p class="subtitle" style="text-align:center; padding:2rem;">Noch keine Beobachtungen dokumentiert.</p>';
            return;
        }

        // Sort logs by date descending
        const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));

        listEl.innerHTML = sortedLogs.map(log => {
            const dateStr = new Date(log.timestamp || log.date).toLocaleDateString('de-DE', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            const typeLabel = log.type === 'pos' ? 'Positiv' : (log.type === 'neg' ? 'Negativ' : 'Neutral');
            const typeClass = log.type || 'neu';
            
            return `
                <div class="history-item ${typeClass}" id="log-item-${log.id}">
                    <div class="history-date">
                        <span>${dateStr}</span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <span class="badge-log badge-${typeClass}">${typeLabel}</span>
                            <div class="log-item-controls">
                                <button onclick="Logbook.editEntry('${studentId}', '${log.id}')" class="icon-btn-history" title="Bearbeiten">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                </button>
                                <button onclick="Logbook.deleteEntry(this, '${studentId}', '${log.id}')" class="icon-btn-history" title="Löschen" style="color:#ff6b6b;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div id="log-content-${log.id}" style="font-size:0.95rem; line-height:1.4;">${log.text}</div>
                </div>
            `;
        }).join('');
    },

    editEntry(studentId, logId) {
        const student = window.students.find(s => s.id === studentId);
        const log = student.pedagogical_logs.find(l => l.id === logId);
        if (!log) return;

        const contentEl = document.getElementById(`log-content-${logId}`);
        const itemEl = document.getElementById(`log-item-${logId}`);
        
        // Hide standard controls
        const controls = itemEl.querySelector('.log-item-controls');
        if (controls) controls.style.display = 'none';

        const currentType = log.type || 'neu';

        contentEl.innerHTML = `
            <textarea id="edit-text-${logId}" class="log-textarea" style="height:80px; margin-top:10px;">${log.text}</textarea>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
                <div class="log-type-buttons" style="flex:1; max-width:180px;">
                    <button onclick="Logbook.setEditType('${logId}', 'pos')" id="edit-btn-pos-${logId}" class="type-btn btn-pos ${currentType === 'pos' ? 'active' : ''}">👍</button>
                    <button onclick="Logbook.setEditType('${logId}', 'neu')" id="edit-btn-neu-${logId}" class="type-btn btn-neu ${currentType === 'neu' ? 'active' : ''}">💬</button>
                    <button onclick="Logbook.setEditType('${logId}', 'neg')" id="edit-btn-neg-${logId}" class="type-btn btn-neg ${currentType === 'neg' ? 'active' : ''}">👎</button>
                </div>
                <div style="display:flex; gap:8px;">
                    <button onclick="Logbook.saveEdit(this, '${studentId}', '${logId}')" class="log-save-btn" style="padding:6px 12px; font-size:0.8rem; background:var(--success);">Speichern</button>
                    <button onclick="Logbook.showHistory('${studentId}')" class="log-save-btn" style="padding:6px 12px; font-size:0.8rem; background:rgba(255,255,255,0.1);">Abbrechen</button>
                </div>
            </div>
            <input type="hidden" id="edit-type-${logId}" value="${currentType}">
        `;
    },

    setEditType(logId, type) {
        document.getElementById(`edit-type-${logId}`).value = type;
        ['pos', 'neg', 'neu'].forEach(t => {
            const btn = document.getElementById(`edit-btn-${t}-${logId}`);
            if (btn) btn.classList.toggle('active', t === type);
        });
    },

    async saveEdit(btn, studentId, logId) {
        const text = document.getElementById(`edit-text-${logId}`).value;
        const type = document.getElementById(`edit-type-${logId}`).value;
        
        if (!text.trim()) {
            alert("Bitte Text eingeben.");
            return;
        }

        btn.disabled = true;
        const originalText = btn.innerText;
        btn.innerHTML = `<div class="spinner-small"></div>`;

        try {
            const response = await fetch(`${API_URL}/students/${studentId}/logs/${logId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, text })
            });

            if (response.ok) {
                const updatedStudent = await response.json();
                const idx = window.students.findIndex(s => s.id === studentId);
                if (idx !== -1) window.students[idx] = updatedStudent;
                this.showHistory(studentId); // Refresh view
            } else {
                alert("Fehler beim Speichern.");
                btn.disabled = false;
                btn.innerText = originalText;
            }
        } catch (err) {
            alert("Verbindungsfehler.");
            btn.disabled = false;
            btn.innerText = originalText;
        }
    },

    async deleteEntry(btn, studentId, logId) {
        if (!confirm("Diesen Eintrag wirklich löschen?")) return;
        const originalContent = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner-small" style="border-top-color:#ff6b6b"></div>`;

        try {
            const response = await fetch(`${API_URL}/students/${studentId}/logs/${logId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                const updatedStudent = await response.json();
                const idx = window.students.findIndex(s => s.id === studentId);
                if (idx !== -1) window.students[idx] = updatedStudent;
                this.showHistory(studentId); // Refresh view
            } else {
                alert("Fehler beim Löschen.");
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        } catch (err) {
            alert("Verbindungsfehler.");
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    },

    closeHistory() {
        document.getElementById('history-modal').classList.add('hidden');
    },

    async showArchiveList() {
        const modal = document.getElementById('archive-list-modal');
        const content = document.getElementById('archive-list-content');
        modal.classList.remove('hidden');

        try {
            const res = await fetch(`${API_URL}/ai/day-summary/list`);
            const data = await res.json();
            
            if (data.dates && data.dates.length > 0) {
                // Sort dates descending
                const sorted = data.dates.sort().reverse();
                content.innerHTML = sorted.map(date => {
                    const d = new Date(date).toLocaleDateString('de-DE', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                    });
                    return `
                        <div class="history-item pos" onclick="Logbook.loadArchivedReport('${date}')" style="cursor:pointer; padding: 12px 18px;">
                            <div style="font-weight:700;">📅 Bericht vom ${d}</div>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
                        </div>
                    `;
                }).join('');
            } else {
                content.innerHTML = '<p class="subtitle" style="text-align:center; padding:2rem;">Noch keine Berichte archiviert.</p>';
            }
        } catch (err) {
            content.innerHTML = '<p style="color:#ff6b6b; text-align:center; padding:1rem;">Fehler beim Laden.</p>';
        }
    },

    closeArchiveList() {
        document.getElementById('archive-list-modal').classList.add('hidden');
    },

    loadArchivedReport(date) {
        this.currentDate = date;
        this.updateDateDisplay();
        this.closeArchiveList();
        this.renderStudents();
        this.generateAISummary(); // This will now fetch the archived version
    }
};

// Hook into the global student list update
const originalFetchStudents = window.fetchStudents;
window.fetchStudents = async function() {
    if (originalFetchStudents) await originalFetchStudents();
    if (document.getElementById('logbook-view') && !document.getElementById('logbook-view').classList.contains('hidden')) {
        Logbook.renderStudents();
    }
};
