-- D1 Initialisierung für MS Neualm
CREATE TABLE IF NOT EXISTS kv_data (
    id TEXT PRIMARY KEY,
    value TEXT
);

-- Hinweis: Die Tabelle für die pädagogischen Logs etc. wird im Code über das 'kv_data' Key-Value-System gehandhabt.
-- Wenn du Daten migrieren willst, nutze den /api/migrate-kv-to-d1 Endpunkt (nachdem KV konfiguriert wurde).
