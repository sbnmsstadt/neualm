
async function verify() {
    const API_URL = "https://neualm-infotafel.sb-nmsstadt.workers.dev/api";
    try {
        const res = await fetch(`${API_URL}/ai/day-summary/list`);
        const data = await res.json();
        console.log("Archive List:", data.dates);
        
        const today = new Date().toISOString().split('T')[0];
        const res2 = await fetch(`${API_URL}/ai/day-summary?date=${today}`);
        const data2 = await res2.json();
        console.log("Today's Summary Response:", JSON.stringify(data2, null, 2));
        
    } catch (e) {
        console.error("Error:", e);
    }
}
verify();
