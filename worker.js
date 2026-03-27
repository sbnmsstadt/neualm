export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        if (!env.NEUALM_DB) {
            return new Response("KV Namespace 'NEUALM_DB' is not bound. Please check your Cloudflare settings.", {
                status: 500,
                headers: corsHeaders
            });
        }

        try {
            const DEFAULT_REWARDS = [
                    { threshold: 8, title: "Eis essen", icon: "🍦", desc: "Ein Eis deiner Wahl", active: true },
                    { threshold: 24, title: "Kino Nachmittag", icon: "🎬", desc: "Film schauen mit Popcorn", active: true },
                    { threshold: 40, title: "Große Überraschung", icon: "🎁", desc: "Etwas ganz Besonderes", active: true },
                    { threshold: 60, title: "3 Volle Karten Bonus", icon: "🏆", desc: "Spezial-Belohnung für 3 volle Karten!", active: true },
                    { threshold: 40, icon: "🎮", title: "Level 2: Extra-Spielzeit", desc: "15 Min an der Konsole/Spiel." },
                    { threshold: 60, icon: "👑", title: "Level 3: VIP Woche", desc: "Entscheide über die Spiele!" }
                ];

            // Admin Login Verification
            if (path === "/api/admin/login" && method === "POST") {
                const { password } = await request.json();
                const correctPassword = env.ADMIN_PW || "8520"; // Fallback to old PIN if secret not set
                
                if (password === correctPassword) {
                    return new Response(JSON.stringify({ success: true }), {
                        headers: { ...corsHeaders, "Content-Type": "application/json" }
                    });
                } else {
                    return new Response(JSON.stringify({ success: false, message: "Falsches Passwort" }), {
                        status: 401,
                        headers: { ...corsHeaders, "Content-Type": "application/json" }
                    });
                }
            }

            // DEBUG: Test Telegram
            if (path === "/api/debug/test-telegram") {
                const sendTelegramMessage = async (env, text) => {
                    const token = env.TELEGRAM_TOKEN;
                    const chatId = env.TELEGRAM_CHAT_ID;
                    if (!token || !chatId) return false;
                    const url = `https://api.telegram.org/bot${token}/sendMessage`;
                    const res = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: chatId, text: text })
                    });
                    return res.ok;
                };

                const success = await sendTelegramMessage(env, "Test-Nachricht vom Stempelkarten-System! ✅\n\nDein Bot ist richtig konfiguriert.");
                return new Response(JSON.stringify({ success, message: success ? "Test gesendet!" : "Fehler beim Senden. Prüfe deine Secrets!" }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }
            if (path === "/api/settings" && method === "GET") {
                const settingsRaw = await env.NEUALM_DB.get("settings");
                const defaultActivities = [
                    { label: "Sport-AG", emoji: "🏀" },
                    { label: "Hausaufgaben", emoji: "📝" },
                    { label: "Hilfe", emoji: "🤝" },
                    { label: "Lesen", emoji: "📚" },
                    { label: "Kreativ", emoji: "🎨" },
                    { label: "Spielen", emoji: "🎲" },
                    { label: "Projekt", emoji: "🚀" },
                    { label: "Sonstiges", emoji: "🌟" }
                ];
                const settings = settingsRaw ? JSON.parse(settingsRaw) : { 
                    communityTarget: 500, 
                    communityTitle: "Pizza-Party",
                    communityGoalVisible: true,
                    activities: defaultActivities,
                    groupReward: { title: "Filmtag", target: 8, current: 0, icon: "🎬", active: false },
                    dailyNotes: "",
                    currentProjects: "",
                    todayPlan: ""
                };
                return new Response(JSON.stringify(settings), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (path === "/api/settings" && method === "PUT") {
                const settings = await request.json();
                await env.NEUALM_DB.put("settings", JSON.stringify(settings));
                return new Response(JSON.stringify(settings), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (path === "/api/settings/group-approve" && method === "POST") {
                const settingsRaw = await env.NEUALM_DB.get("settings");
                let settings = JSON.parse(settingsRaw || "{}");
                
                if (settings.groupReward) {
                    settings.groupReward.isApproved = true;
                    
                    // Trigger Celebration
                    settings.celebration = {
                        id: Date.now(),
                        title: settings.groupReward.title || "Filmtag",
                        active: true
                    };

                    await env.NEUALM_DB.put("settings", JSON.stringify(settings));
                }

                // Update all donors (Milestone achieved!)
                const studentsRaw = await env.NEUALM_DB.get("students");
                let students = JSON.parse(studentsRaw || "[]");
                const today = new Date().toISOString().split('T')[0];
                let changed = false;

                students.forEach(s => {
                    if (s.contributedToCurrent) {
                        if (!s.history) s.history = [];
                        s.history.push({ date: today, reason: `${settings.groupReward?.title || 'Filmtag'} genehmigt ✅` });
                        s.contributedToCurrent = false;
                        changed = true;
                    }
                });

                if (changed) {
                    await env.NEUALM_DB.put("students", JSON.stringify(students));
                }

                return new Response(JSON.stringify({ settings }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (path === "/api/settings/group-reset" && method === "POST") {
                const settingsRaw = await env.NEUALM_DB.get("settings");
                let settings = JSON.parse(settingsRaw || "{}");
                
                if (settings.groupReward) {
                    settings.groupReward.current = 0;
                    settings.groupReward.isApproved = false;
                    await env.NEUALM_DB.put("settings", JSON.stringify(settings));
                }
                
                return new Response(JSON.stringify({ settings }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (path === "/api/rewards" && method === "GET") {
                const rewardsRaw = await env.NEUALM_DB.get("rewards");
                const rewards = rewardsRaw ? JSON.parse(rewardsRaw) : DEFAULT_REWARDS;
                return new Response(JSON.stringify(rewards), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (path === "/api/rewards" && method === "PUT") {
                const rewards = await request.json();
                // Sort by threshold automatically
                rewards.sort((a, b) => a.threshold - b.threshold);
                await env.NEUALM_DB.put("rewards", JSON.stringify(rewards));
                return new Response(JSON.stringify(rewards), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (path === "/api/students" && method === "GET") {
                const studentsRaw = await env.NEUALM_DB.get("students");
                const students = studentsRaw ? JSON.parse(studentsRaw) : [];
                return new Response(JSON.stringify(students), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (path.startsWith("/api/students/") && method === "GET") {
                const id = path.split("/").pop();
                const studentsRaw = await env.NEUALM_DB.get("students");
                const students = JSON.parse(studentsRaw || "[]");
                const student = students.find(s => String(s.id) === String(id));

                if (!student) return new Response("Not Found", { status: 404, headers: corsHeaders });
                return new Response(JSON.stringify(student), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (path === "/api/students" && method === "POST") {
                const { name, birthday, attendanceDays, departureTime } = await request.json();
                const studentsRaw = await env.NEUALM_DB.get("students");
                let students = studentsRaw ? JSON.parse(studentsRaw) : [];

                // Generate 3-letter ID from name
                let baseId = name.toLowerCase().replace(/[^a-z]/g, '').substring(0, 3);
                if (baseId.length < 3) baseId = name.toLowerCase().substring(0, 3);

                // Ensure uniqueness (add number if needed)
                let finalId = baseId;
                let counter = 1;
                while (students.some(s => s.id === finalId)) {
                    finalId = baseId + counter;
                    counter++;
                }

                const newStudent = { 
                    id: finalId, 
                    name: name, 
                    stamps: 0, 
                    usedStamps: 0, 
                    birthday: birthday || null, 
                    attendanceDays: attendanceDays || [],
                    departureTime: departureTime || "",
                    avatar: null,
                    badges: [],
                    history: [],
                    redemptions: {} 
                };
                students.push(newStudent);
                await env.NEUALM_DB.put("students", JSON.stringify(students));

                return new Response(JSON.stringify(newStudent), {
                    status: 201,
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (path.startsWith("/api/students/") && method === "PATCH") {
                const pathParts = path.split("/");

                // Handle normal student patch
                if (pathParts.length === 4) {
                    const id = pathParts[3];
                    const body = await request.json();
                    const { stamps, avatar, badges, reason, attendanceDays, departureTime } = body;
                    const studentsRaw = await env.NEUALM_DB.get("students");
                    let students = JSON.parse(studentsRaw || "[]");

                    const index = students.findIndex(s => String(s.id) === String(id));
                    if (index === -1) return new Response("Not Found", { status: 404, headers: corsHeaders });

                    // Migration / Initialization
                    if (students[index].avatar === undefined) students[index].avatar = null;
                    if (students[index].badges === undefined) students[index].badges = [];
                    if (students[index].history === undefined) students[index].history = [];

                    if (stamps !== undefined) {
                        // If stamps increased, track history
                        if (stamps > students[index].stamps) {
                            const today = new Date().toISOString().split('T')[0];
                            students[index].history.push({ 
                                date: today, 
                                reason: reason || "Stempel" 
                            });
                        }
                        students[index].stamps = stamps;
                    }
                    if (avatar !== undefined) students[index].avatar = avatar;
                    if (badges !== undefined) students[index].badges = badges;
                    if (attendanceDays !== undefined) students[index].attendanceDays = attendanceDays;
                    if (departureTime !== undefined) students[index].departureTime = departureTime;

                    await env.NEUALM_DB.put("students", JSON.stringify(students));
                    return new Response(JSON.stringify(students[index]), {
                        headers: { ...corsHeaders, "Content-Type": "application/json" }
                    });
                }
            }

            // Handle Redeem Endpoints
            if (path.includes("/redeem") && (method === "POST" || method === "PATCH")) {
                const pathParts = path.split("/");
                const id = pathParts[3];
                const { threshold, status } = await request.json();
                const studentsRaw = await env.NEUALM_DB.get("students");
                let students = JSON.parse(studentsRaw || "[]");

                const index = students.findIndex(s => String(s.id) === String(id));
                if (index === -1) return new Response("Not Found", { status: 404, headers: corsHeaders });

                if (!students[index].redemptions) students[index].redemptions = {};

                if (method === "POST") {
                    // Request a redemption (student)
                    const stamps = students[index].stamps || 0;
                    const usedStamps = students[index].usedStamps || 0;
                    const freeStamps = stamps - usedStamps;
                    const reqThreshold = parseInt(threshold);

                    if (reqThreshold >= 60) {
                        // Milestone based on total stamps
                        if (stamps < reqThreshold) {
                            return new Response("Noch nicht genug Gesamt-Stempel für diesen Meilenstein.", { status: 400, headers: corsHeaders });
                        }
                    } else {
                        // Normal reward based on free stamps
                        if (freeStamps < reqThreshold) {
                            return new Response("Zu wenig freie Stempel für diese Belohnung.", { status: 400, headers: corsHeaders });
                        }
                    }

                    students[index].redemptions[threshold] = "pending";

                    // TELEGRAM NOTIFICATION
                    const rewardsRaw = await env.NEUALM_DB.get("rewards");
                    const rewards = rewardsRaw ? JSON.parse(rewardsRaw) : DEFAULT_REWARDS;
                    const reward = rewards.find(r => r.threshold === parseInt(threshold));
                    const rewardName = reward ? reward.title : `Belohnung (${threshold} Stempel)`;

                    await sendTelegramMessage(env, `🎁 NEUE ANFRAGE!\n\nSchüler: ${students[index].name}\nBelohnung: ${rewardName}\n\nBitte im Admin-Dashboard bestätigen.`);

                } else if (method === "PATCH") {
                    // Confirm a redemption (admin) — mark as completed so stamp card stays checked
                    students[index].redemptions[threshold] = "completed";

                    const reqThreshold = parseInt(threshold);
                    const isMilestone = reqThreshold >= 60;

                    if (!isMilestone) {
                        // Migration/Initialization for usedStamps (Normal Rewards only)
                        if (students[index].usedStamps === undefined) {
                            let sum = 0;
                            for (const [t, s] of Object.entries(students[index].redemptions)) {
                                if (s === "completed" && parseInt(t) < 60) sum += parseInt(t);
                            }
                            students[index].usedStamps = sum;
                        } else {
                            // Already initialized, just increment for normal rewards
                            students[index].usedStamps = students[index].usedStamps + reqThreshold;
                        }
                    } else if (students[index].usedStamps === undefined) {
                         // Initialize to 0 if not exists (Milestones don't count)
                         students[index].usedStamps = 0;
                    }

                    // --- NEW: If reward title is "Filmtag", activate/increment group progress ---
                    const rewardsRaw = await env.NEUALM_DB.get("rewards");
                    const rewards = rewardsRaw ? JSON.parse(rewardsRaw) : DEFAULT_REWARDS;
                    const reward = rewards.find(r => r.threshold === parseInt(threshold));
                    const rewardName = reward ? reward.title : `Belohnung (${threshold} Stempel)`;

                    if (rewardName.toLowerCase().includes("filmtag")) {
                        const settingsRaw = await env.NEUALM_DB.get("settings");
                        let settings = JSON.parse(settingsRaw || "{}");
                        if (settings.groupReward) {
                            settings.groupReward.current = (settings.groupReward.current || 0) + parseInt(threshold);
                            settings.groupReward.active = true;
                            await env.NEUALM_DB.put("settings", JSON.stringify(settings));
                        }
                    }
                }

                await env.NEUALM_DB.put("students", JSON.stringify(students));
                return new Response(JSON.stringify(students[index]), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            // Handle Group Contribution
            if (path.includes("/group-contribute") && method === "POST") {
                const pathParts = path.split("/");
                const id = pathParts[3];
                const studentsRaw = await env.NEUALM_DB.get("students");
                let students = JSON.parse(studentsRaw || "[]");
                const index = students.findIndex(s => String(s.id) === String(id));

                if (index !== -1) {
                    const student = students[index];
                    // Calculate free stamps
                    let usedStamps = student.usedStamps || 0;
                    if (usedStamps === 0 && student.redemptions) {
                         Object.entries(student.redemptions).forEach(([t, s]) => {
                            if (s === 'completed') usedStamps += parseInt(t);
                         });
                    }
                    const freeStamps = student.stamps - usedStamps;

                    // NEW: Check if group reward is ACTIVE
                    const settingsRaw = await env.NEUALM_DB.get("settings");
                    let settings = JSON.parse(settingsRaw || "{}");
                    
                    if (!settings.groupReward || !settings.groupReward.active) {
                        return new Response("Gruppen-Belohnung ist aktuell nicht aktiv (muss erst gestartet werden)", { status: 400, headers: corsHeaders });
                    }

                    if (settings.groupReward.current >= settings.groupReward.target) {
                        return new Response("Ziel bereits erreicht! Es können keine weiteren Stempel gespendet werden.", { status: 400, headers: corsHeaders });
                    }

                    if (freeStamps >= 1) {
                        // Deduct from student (increase usedStamps)
                        student.usedStamps = usedStamps + 1;
                        student.contributedToCurrent = true; // Mark as donor

                        if (!student.history) student.history = [];
                        student.history.push({ date: new Date().toISOString().split('T')[0], reason: `Spende für ${settings.groupReward.title}` });
                        
                        settings.groupReward.current = (settings.groupReward.current || 0) + 1;
                        
                        await env.NEUALM_DB.put("students", JSON.stringify(students));
                        await env.NEUALM_DB.put("settings", JSON.stringify(settings));
                        
                        return new Response(JSON.stringify(student), {
                            headers: { ...corsHeaders, "Content-Type": "application/json" }
                        });
                    }
                    return new Response("Nicht genügend Stempel", { status: 400, headers: corsHeaders });
                }
                return new Response("Schüler nicht gefunden", { status: 404, headers: corsHeaders });
            }

            if (path.startsWith("/api/students/") && method === "DELETE") {
                const id = path.split("/").pop();
                const studentsRaw = await env.NEUALM_DB.get("students");
                let students = JSON.parse(studentsRaw || "[]");

                students = students.filter(s => String(s.id) !== String(id));
                await env.NEUALM_DB.put("students", JSON.stringify(students));
                return new Response(null, { status: 204, headers: corsHeaders });
            }

            // VIP Status toggle
            if (path.includes("/vip") && method === "PATCH") {
                const id = path.split("/")[3];
                const { active, reason } = await request.json();
                const studentsRaw = await env.NEUALM_DB.get("students");
                let students = JSON.parse(studentsRaw || "[]");
                const index = students.findIndex(s => String(s.id) === String(id));
                if (index === -1) return new Response("Not Found", { status: 404, headers: corsHeaders });

                students[index].vip = {
                    active: !!active,
                    grantedAt: active ? new Date().toISOString().split('T')[0] : null,
                    reason: reason || ""
                };

                if (!students[index].history) students[index].history = [];
                students[index].history.push({
                    date: new Date().toISOString().split('T')[0],
                    reason: active ? `⭐ VIP-Status erhalten${reason ? ': ' + reason : ''}` : "VIP-Status entfernt"
                });

                await env.NEUALM_DB.put("students", JSON.stringify(students));
                return new Response(JSON.stringify(students[index]), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            return new Response(`Not Found: ${method} ${path}`, { status: 404, headers: corsHeaders });
        } catch (err) {
            return new Response(err.message, { status: 500, headers: corsHeaders });
        }
    },

    async scheduled(event, env, ctx) {
        if (!env.NEUALM_DB || !env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) {
            console.error("Missing DB or Telegram credentials");
            return;
        }

        try {
            const studentsRaw = await env.NEUALM_DB.get("students");
            if (!studentsRaw) return;
            let students = JSON.parse(studentsRaw);

            const settingsRaw = await env.NEUALM_DB.get("settings");
            const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
            const vipDuration = settings.vipDurationDays || 3;

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayStr = today.toISOString().split('T')[0];

            let events = [];
            let studentsChanged = false;

            // --- 1. Check VIP expiry ---
            for (let i = 0; i < students.length; i++) {
                const s = students[i];
                if (s.vip && s.vip.active && s.vip.grantedAt) {
                    const grantedDate = new Date(s.vip.grantedAt);
                    grantedDate.setHours(0,0,0,0);
                    const daysDiff = Math.floor((today.getTime() - grantedDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                    const daysLeft = vipDuration - daysDiff + 1;

                    if (daysLeft <= 0) {
                        // VIP expired → auto-deactivate
                        students[i].vip.active = false;
                        if (!students[i].history) students[i].history = [];
                        students[i].history.push({ date: todayStr, reason: "VIP-Status abgelaufen ⏰" });
                        events.push({ type: 'vip_expired', name: s.name });
                        studentsChanged = true;
                    } else if (daysLeft === 1) {
                        // Last VIP day warning
                        events.push({ type: 'vip_last_day', name: s.name, day: daysDiff, total: vipDuration });
                    } else {
                        events.push({ type: 'vip_active', name: s.name, day: daysDiff, total: vipDuration });
                    }
                }
            }

            if (studentsChanged) {
                await env.NEUALM_DB.put("students", JSON.stringify(students));
            }

            // --- 2. Check Birthdays (this week) ---
            const day = today.getDay() || 7;
            const monday = new Date(today);
            monday.setDate(today.getDate() - day + 1);
            monday.setHours(0, 0, 0, 0);
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            sunday.setHours(23, 59, 59, 999);

            for (const s of students) {
                if (!s.birthday) continue;
                const parts = s.birthday.split('-');
                if (parts.length === 3) {
                    const bMonth = parseInt(parts[1], 10) - 1;
                    const bDay = parseInt(parts[2], 10);
                    const thisYearBday = new Date(today.getFullYear(), bMonth, bDay);
                    if (thisYearBday >= monday && thisYearBday <= sunday) {
                        const isToday = thisYearBday.toISOString().split('T')[0] === todayStr;
                        events.push({ type: 'birthday', name: s.name, isToday });
                    }
                }
            }

            // --- 3. Check pending redemptions ---
            let pendingCount = 0;
            students.forEach(s => {
                if (s.redemptions) {
                    Object.values(s.redemptions).forEach(v => {
                        if (v === 'pending') pendingCount++;
                    });
                }
            });
            if (pendingCount > 0) {
                events.push({ type: 'pending_redemptions', count: pendingCount });
            }

            // --- 4. Generate AI summary or send static message ---
            if (events.length > 0) {
                let message;
                if (env.KI_API) {
                    message = await getAISummary(events, env.KI_API);
                } else {
                    message = buildFallbackMessage(events);
                }
                if (message) await sendTelegramMessage(env, message);
            }

        } catch (err) {
            console.error("Scheduled task error:", err);
        }
    }
};

async function getAISummary(events, apiKey) {
    const eventsText = events.map(e => {
        if (e.type === 'birthday') return `- Geburtstag: ${e.name}${e.isToday ? ' (HEUTE!)' : ' (diese Woche)'}`;
        if (e.type === 'vip_last_day') return `- VIP letzter Tag: ${e.name} (Tag ${e.day}/${e.total})`;
        if (e.type === 'vip_expired') return `- VIP abgelaufen: ${e.name}`;
        if (e.type === 'vip_active') return `- VIP aktiv: ${e.name} (Tag ${e.day}/${e.total})`;
        if (e.type === 'pending_redemptions') return `- Offene Einlösungsanfragen: ${e.count} Stück`;
        return '';
    }).join('\n');

    const prompt = `Du bist ein freundlicher Schulassistent für eine Grundschule. 
Erstelle eine kurze, motivierende tägliche Zusammenfassung für den Betreuer auf Deutsch.
Nutze Emojis passend. Maximal 200 Wörter. Sei herzlich und professionell.

Heutige Ereignisse:
${eventsText}

Schreibe die Zusammenfassung jetzt:`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
            })
        });
        if (!res.ok) return buildFallbackMessage(events);
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || buildFallbackMessage(events);
    } catch (err) {
        return buildFallbackMessage(events);
    }
}

function buildFallbackMessage(events) {
    let msg = "📋 Tagesübersicht NACHMI:\n\n";
    events.forEach(e => {
        if (e.type === 'birthday') msg += `🎂 Geburtstag: ${e.name}${e.isToday ? ' — HEUTE! 🎉' : ' (diese Woche)'}\n`;
        if (e.type === 'vip_last_day') msg += `⭐ LETZTER VIP-TAG: ${e.name}!\n`;
        if (e.type === 'vip_expired') msg += `⏰ VIP abgelaufen: ${e.name}\n`;
        if (e.type === 'vip_active') msg += `⭐ VIP aktiv: ${e.name} (Tag ${e.day}/${e.total})\n`;
        if (e.type === 'pending_redemptions') msg += `🎁 ${e.count} offene Einlösungsanfrage(n) ausstehend\n`;
    });
    return msg;
}

async function sendTelegramMessage(env, text) {
    if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
    try {
        const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: env.TELEGRAM_CHAT_ID,
                text: text
            })
        });
        return response.ok;
    } catch (err) {
        console.error("Telegram error:", err);
        return false;
    }
}
