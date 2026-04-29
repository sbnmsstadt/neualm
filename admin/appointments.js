/**
 * Appointments Module for Admin Dashboard
 * Handles student appointments/events (e.g. leaving early).
 */

const Appointments = {
    events: [],
    
    init() {
        console.log("Appointments initialized");
        this.renderBaseLayout();
        this.renderStudentList();
        this.checkApiConnection(); // Diagnostic ping
        this.fetchEvents();
    },

    async checkApiConnection() {
        try {
            const url = (typeof API_URL !== 'undefined') ? API_URL : "https://stempelkarte.sb-nmsstadt.workers.dev/api";
            console.log("Testing Connection to:", `${url}/ping`);
            const res = await fetch(`${url}/ping`);
            if (res.ok) {
                console.log("API Connection OK (Ping: " + await res.text() + ")");
            } else {
                console.warn("API Connection status:", res.status);
            }
        } catch (err) {
            console.error("API Connection Failed:", err);
        }
    },

    renderStudentList() {
        const select = document.getElementById('appointment-student-select');
        if (!select) return;
        const currentVal = select.value;
        const studentsHtml = `<option value="">-- Schüler wählen --</option>` + 
            (window.students ? window.students.map(s => `<option value="${s.id}">${s.name}</option>`).join('') : '');
        select.innerHTML = studentsHtml;
        select.value = currentVal;
    },

    renderBaseLayout() {
        const container = document.getElementById('appointments-view');
        if (!container) return;

        container.innerHTML = `
            <div class="appointments-container">
                <div class="appointments-header">
                    <div>
                        <h2 style="font-size: 1.8rem; margin-bottom: 0.5rem;">📅 Termin-Planer</h2>
                        <p class="subtitle">Besondere Ereignisse & Termine für Schüler</p>
                    </div>
                </div>

                <div class="appointments-grid">
                    <!-- Left: Form -->
                    <div class="glass-card appointments-form-card">
                        <h3>➕ Neuen Termin eintragen</h3>
                        <div class="form-group">
                            <label>Schüler auswählen</label>
                            <select id="appointment-student-select">
                                <option value="">-- Schüler wählen --</option>
                                ${window.students ? window.students.map(s => `<option value="${s.id}">${s.name}</option>`).join('') : ''}
                            </select>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Datum</label>
                                <input type="date" id="appointment-date" value="${new Date().toISOString().split('T')[0]}">
                            </div>
                            <div class="form-group">
                                <label>Uhrzeit</label>
                                <input type="time" id="appointment-time" value="14:00">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Ereignis / Grund</label>
                            <input type="text" id="appointment-text" placeholder="z.B. Früher gehen wegen Zahnarzt">
                        </div>
                        <button onclick="Appointments.saveEntry()" class="add-stamp-btn" id="appointment-save-btn">
                            Hinzufügen
                        </button>
                    </div>

                    <!-- Right: List -->
                    <div class="glass-card appointments-list-card">
                        <h3>📋 Kommende & Heutige Termine</h3>
                        <div id="appointments-list-content" class="appointments-list">
                            <div class="empty-state">Lade Termine...</div>
                        </div>
                    </div>
                </div>
            </div>`;
    },

    async fetchEvents() {
        const url = (typeof API_URL !== 'undefined') ? API_URL : "https://stempelkarte.sb-nmsstadt.workers.dev/api";
        try {
            const res = await fetch(`${url}/appointments`);
            if (res.ok) {
                this.events = await res.json();
                this.renderEvents();
            }
        } catch (err) {
            console.error("Error fetching events:", err);
        }
    },

    renderEvents() {
        const listContainer = document.getElementById('appointments-list-content');
        if (!listContainer) return;

        if (this.events.length === 0) {
            listContainer.innerHTML = `<div class="empty-state">Keine Termine eingetragen.</div>`;
            return;
        }

        // Sort: Date asc, Time asc
        const sorted = [...this.events].sort((a, b) => {
            const da = a.date + ' ' + a.time;
            const db = b.date + ' ' + b.time;
            return da.localeCompare(db);
        });

        listContainer.innerHTML = sorted.map(e => {
            const dateObj = new Date(e.date);
            const isToday = e.date === new Date().toISOString().split('T')[0];
            const dateStr = dateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
            
            return `
                <div class="appointment-item ${isToday ? 'today' : ''}">
                    <div class="appointment-info">
                        <div class="appointment-main">
                            <span class="appointment-student">${e.studentName}</span>
                            <span class="appointment-time">${e.time}</span>
                            ${isToday ? '<span class="today-badge">HEUTE</span>' : `<span class="date-badge">${dateStr}</span>`}
                        </div>
                        <div class="appointment-text">${e.text}</div>
                    </div>
                    <button class="icon-btn-small delete-btn" onclick="Appointments.deleteEntry('${e.id}')" title="Löschen">
                        &times;
                    </button>
                </div>
            `;
        }).join('');
    },

    async saveEntry() {
        const studentId = document.getElementById('appointment-student-select').value;
        const student = window.students.find(s => s.id === studentId);
        const date = document.getElementById('appointment-date').value;
        const time = document.getElementById('appointment-time').value;
        const text = document.getElementById('appointment-text').value;
        const btn = document.getElementById('appointment-save-btn');

        if (!studentId || !text.trim()) {
            alert("Bitte Schüler und Text eingeben.");
            return;
        }

        btn.disabled = true;
        btn.innerText = "Speichere...";

        const url = (typeof API_URL !== 'undefined') ? API_URL : "https://stempelkarte.sb-nmsstadt.workers.dev/api";

        try {
            const res = await fetch(`${url}/appointments`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    studentId,
                    studentName: student.name,
                    date,
                    time,
                    text
                })
            });

            if (res.ok) {
                const newEvent = await res.json();
                this.events.push(newEvent);
                this.renderEvents();
                // Reset text
                document.getElementById('appointment-text').value = '';
                
                // Signal Infotafel to refresh immediately
                try {
                    const bc = new BroadcastChannel('nachmi_updates');
                    bc.postMessage({ type: 'appointments_updated' });
                    bc.close();
                } catch (e) {}

            } else {
                alert("Fehler beim Speichern.");
            }
        } catch (err) {
            console.error("Save Entry Error:", err);
            alert("Fehler: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = "Hinzufügen";
        }
    },

    async deleteEntry(id) {
        if (!confirm("Termin wirklich löschen?")) return;

        const url = (typeof API_URL !== 'undefined') ? API_URL : "https://stempelkarte.sb-nmsstadt.workers.dev/api";

        try {
            const res = await fetch(`${url}/appointments/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                this.events = this.events.filter(e => e.id !== id);
                this.renderEvents();
            } else {
                alert("Fehler beim Löschen.");
            }
        } catch (err) {
            alert("Verbindungsfehler: " + err.message);
        }
    }
};
