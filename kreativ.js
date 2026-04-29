const API_URL = "https://neualm-infotafel.sb-nmsstadt.workers.dev/api";
const PIN_ADMIN = "5400"; 

// --- Auth & Setup ---
const appContainer = document.getElementById('app-container');
const loginOverlay = document.getElementById('login-overlay');

function checkAuth() {
    if (sessionStorage.getItem('admin_auth') === PIN_ADMIN) {
        if (loginOverlay) loginOverlay.style.display = 'none';
        if (appContainer) appContainer.style.display = 'block';
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

// --- AI Generation Logic ---

const DEFAULT_PROMPT_TEMPLATE = `Du bist ein erfahrener Pädagoge in einer schulischen Nachmittagsbetreuung für Kinder zwischen 10 und 14 Jahren (Mittelschule). 
Generiere 3 kreative, motivierende und gut durchführbare Projekt-Ideen basierend auf folgenden Vorgaben:

Thema: {thema}
Altersgruppe: {alter}
Dauer: {dauer} Minuten
Zusätzliche Vorgaben: {extra}

Deine Antwort MUSS zwingend im folgenden JSON-Format sein, ohne Markdown Code-Blöcke (kein \`\`\`json etc.):
[
  {
    "title": "Titel der Idee (mit einem passenden Emoji am Anfang)",
    "description": "Kurze, spannende Beschreibung der Idee (2-3 Sätze)",
    "materials": "Was wird benötigt? (Kurz in einem Satz)",
    "planText": "Der kurze Text, der auf dem Infoboard angezeigt werden soll (z.B. '🎨 14:00 - 15:00: Osterbasteln')"
  }
]
`;

async function generateIdeas() {
    const thema = document.getElementById('prompt-thema').value.trim();
    const alter = document.getElementById('prompt-alter').value;
    const dauer = document.getElementById('prompt-dauer').value;
    const extra = document.getElementById('prompt-extra').value.trim();

    if (!thema) {
        alert("Bitte ein Thema eingeben!");
        document.getElementById('prompt-thema').focus();
        return;
    }

    // UI Updates
    document.getElementById('generate-btn').style.display = 'none';
    document.getElementById('loading-indicator').style.display = 'block';
    
    // Construct Prompt
    const promptText = DEFAULT_PROMPT_TEMPLATE
        .replace('{thema}', thema)
        .replace('{alter}', alter)
        .replace('{dauer}', dauer)
        .replace('{extra}', extra || "Keine besonderen Vorgaben.");

    try {
        const url = `${API_URL}/ai/generate`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promptText })
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`API Fehler: ${response.status} - ${errBody}`);
        }

        const data = await response.json();
        let jsonText = data.text;
        
        if (jsonText) {
            try {
                // Robust JSON extraction: Find first [ and last ] to isolate the array
                const startIdx = jsonText.indexOf('[');
                const endIdx = jsonText.lastIndexOf(']');
                
                if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                    jsonText = jsonText.substring(startIdx, endIdx + 1);
                }

                // Cleanup common Markdown blocks
                jsonText = jsonText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
                
                // Fix: Replace real newlines inside JSON strings with escaped \n (Gemini sometimes does this)
                jsonText = jsonText.replace(/"([^"]*)"/g, (m, p1) => '"' + p1.replace(/\n/g, '\\n') + '"');
                
                // Fix potential trailing commas before parsing
                jsonText = jsonText.replace(/,\s*([\]}])/g, '$1');
                
                const ideas = JSON.parse(jsonText);
                renderIdeas(ideas);
            } catch (parseError) {
                console.error("JSON Parse Error:", parseError, jsonText);
                // Providing more context (500 chars) in V6 to pinpoint the exact syntax error
                throw new Error(`KI-Antwort (V6) ungültig. Fehler: ${parseError.message}. Erhalten: ` + jsonText.substring(0, 500) + "...");
            }
        } else {
            throw new Error("Antwort-Struktur fehlerhaft (V6): Kein Text im 'data.text' Feld.");
        }

    } catch (err) {
        console.error("Generierungsfehler:", err);
        alert("Fehler bei der Generierung: " + err.message);
        
        // Fallback for demonstration if API fails or key is invalid
        if (err.message.includes('400') || err.message.includes('403')) {
            renderIdeas([
                {
                    title: "🎨 Kreativ-Werkstatt: " + thema,
                    description: "Eine entspannte Bastelrunde zum genannten Thema. Die Schüler können ihrer Kreativität freien Lauf lassen.",
                    materials: "Standard Bastelmaterial (Papier, Stifte, Schere, Kleber)",
                    planText: "\uD83C\uDFA8 " + thema + " (" + dauer + " Min)"
                },
                {
                    title: "🏆 " + thema + " - Challenge",
                    description: "Wir machen aus dem Thema einen kleinen Wettbewerb. Wer hat die kreativste Idee oder ist am schnellsten?",
                    materials: "Nach Bedarf",
                    planText: "🏆 Challenge: " + thema
                }
            ]);
        }
    } finally {
        document.getElementById('generate-btn').style.display = 'flex';
        document.getElementById('loading-indicator').style.display = 'none';
    }
}

let currentGeneratedIdeas = [];

function renderIdeas(ideas) {
    currentGeneratedIdeas = ideas;
    const container = document.getElementById('results-container');
    container.innerHTML = '';

    ideas.forEach((idea, index) => {
        const card = document.createElement('div');
        card.className = 'ai-result-card';
        card.innerHTML = `
            <h4 class="ai-result-title">${idea.title}</h4>
            <p class="ai-result-desc">${idea.description}</p>
            <div class="ai-material-list"><strong>Benötigt:</strong> ${idea.materials}</div>
            <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; font-family: monospace; color: var(--accent); margin-bottom: 15px; font-size: 0.85rem;">
                <strong>Infoboard Vorschau:</strong><br>${idea.planText}
            </div>
            <div class="ai-action-buttons">
                <button id="save-btn-${index}" class="add-stamp-btn" onclick="saveToCalendar(${index})" style="width:100%; display:flex; align-items:center; justify-content:center; gap:8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                    In Content-Kalender speichern
                </button>
            </div>
        `;
        
        // Staggered animation
        card.style.animation = `bounceIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) ${index * 0.1}s backwards`;
        container.appendChild(card);
    });
}

// --- Content Calendar Saving ---

async function saveToCalendar(index) {
    const idea = currentGeneratedIdeas[index];
    if (!idea) return;

    const btn = document.getElementById(`save-btn-${index}`);
    const originalHtml = btn.innerHTML;
    
    try {
        btn.innerHTML = '<div class="loading-spinner" style="width:16px; height:16px; border-width:2px; vertical-align:middle;"></div> Speichere...';
        btn.disabled = true;

        const res = await fetch(`${API_URL}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(idea)
        });

        if (!res.ok) throw new Error("Fehler beim Speichern");

        btn.innerHTML = '✅ Gespeichert!';
        btn.style.background = 'var(--success)';
        btn.style.borderColor = 'var(--success)';
        
    } catch (err) {
        console.error(err);
        showToast("Speichern fehlgeschlagen: " + err.message, true);
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

// Helper utility
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
