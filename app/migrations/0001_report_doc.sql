-- OwlAccess shared obstacle reports (Cloudflare D1). One row holds the whole reports document.
CREATE TABLE IF NOT EXISTS report_doc (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  body TEXT NOT NULL
);
