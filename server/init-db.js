const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
require("dotenv").config();

const dbPath =
  process.env.DB_PATH ||
  path.join(__dirname, "db", "klavierhaus_v6.sqlite");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

/**
 * A schema.sql először csak a táblák és nézetek alapstruktúráját hozza létre.
 * A régebbi, már létező Render-adatbázisok hiányzó oszlopait ez a fájl
 * idempotens migrációval adja hozzá.
 */
db.exec(
  fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8")
);

function tableExists(tableName) {
  const result = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
      `
    )
    .get(tableName);

  return Boolean(result);
}

function tableColumns(tableName) {
  if (!tableExists(tableName)) {
    return new Set();
  }

  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((column) => column.name);

  return new Set(columns);
}

function ensureColumn(tableName, columnName, definition) {
  if (!tableExists(tableName)) {
    throw new Error(
      `Cannot add column ${columnName}: table ${tableName} does not exist.`
    );
  }

  const columns = tableColumns(tableName);

  if (!columns.has(columnName)) {
    console.log(
      `Adding missing database column: ${tableName}.${columnName}`
    );

    db.prepare(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
    ).run();
  }
}

function ensureIndex(sql, indexName) {
  try {
    db.exec(sql);
    console.log(`Database index ready: ${indexName}`);
  } catch (error) {
    console.error(
      `Failed to create database index ${indexName}:`,
      error.message
    );
    throw error;
  }
}

/**
 * A korábbi rendszerverzió ugyanazon Excel többszöri elemzésekor
 * több PREVIEW import_batches rekordot is létrehozhatott ugyanazzal
 * az import_source + file_hash párossal.
 *
 * Ezek miatt az egyedi fájlhash-index létrehozása hibára futhatott.
 *
 * Csoportonként egy rekordot tartunk meg az alábbi sorrend szerint:
 * 1. COMPLETED
 * 2. PREVIEW
 * 3. FAILED
 * 4. bármely más állapot
 *
 * Azonos állapot esetén a legutóbbi rekord marad meg.
 */
function removeDuplicateImportBatches() {
  if (!tableExists("import_batches")) {
    return;
  }

  const columns = tableColumns("import_batches");

  if (
    !columns.has("id") ||
    !columns.has("import_source") ||
    !columns.has("file_hash")
  ) {
    return;
  }

  const duplicateGroups = db
    .prepare(
      `
        SELECT
          import_source,
          file_hash,
          COUNT(*) AS duplicate_count
        FROM import_batches
        WHERE import_source IS NOT NULL
          AND TRIM(import_source) <> ''
          AND file_hash IS NOT NULL
          AND TRIM(file_hash) <> ''
        GROUP BY import_source, file_hash
        HAVING COUNT(*) > 1
      `
    )
    .all();

  if (duplicateGroups.length === 0) {
    console.log("No duplicate import batch records found.");
    return;
  }

  const hasStatus = columns.has("status");
  const hasCreatedAt = columns.has("created_at");
  const hasCompletedAt = columns.has("completed_at");

  const getRows = db.prepare(
    `
      SELECT *
      FROM import_batches
      WHERE import_source = ?
        AND file_hash = ?
    `
  );

  const deleteBatch = db.prepare(
    `
      DELETE FROM import_batches
      WHERE id = ?
    `
  );

  function statusPriority(status) {
    const normalized = String(status || "").toUpperCase();

    if (normalized === "COMPLETED") return 4;
    if (normalized === "PREVIEW") return 3;
    if (normalized === "FAILED") return 2;

    return 1;
  }

  function dateValue(row) {
    const completedAt =
      hasCompletedAt && row.completed_at
        ? Date.parse(row.completed_at)
        : 0;

    const createdAt =
      hasCreatedAt && row.created_at
        ? Date.parse(row.created_at)
        : 0;

    if (Number.isFinite(completedAt) && completedAt > 0) {
      return completedAt;
    }

    if (Number.isFinite(createdAt) && createdAt > 0) {
      return createdAt;
    }

    return 0;
  }

  const cleanupTransaction = db.transaction(() => {
    let removedCount = 0;

    for (const group of duplicateGroups) {
      const rows = getRows.all(
        group.import_source,
        group.file_hash
      );

      rows.sort((a, b) => {
        const statusDifference =
          statusPriority(hasStatus ? b.status : "") -
          statusPriority(hasStatus ? a.status : "");

        if (statusDifference !== 0) {
          return statusDifference;
        }

        const dateDifference = dateValue(b) - dateValue(a);

        if (dateDifference !== 0) {
          return dateDifference;
        }

        return String(b.id || "").localeCompare(
          String(a.id || "")
        );
      });

      const recordToKeep = rows[0];

      for (const row of rows.slice(1)) {
        deleteBatch.run(row.id);
        removedCount += 1;
      }

      console.log(
        `Cleaned duplicate import batch group: ` +
          `${group.import_source} / ${group.file_hash}. ` +
          `Kept batch: ${recordToKeep.id}.`
      );
    }

    return removedCount;
  });

  const removedCount = cleanupTransaction();

  console.log(
    `Removed ${removedCount} duplicate import batch record(s).`
  );
}

function runMigrations() {
  const migrateColumns = db.transaction(() => {
    // Korábbi általános migrációk.
    ensureColumn("contacts", "address", "TEXT");

    ensureColumn(
      "jobs",
      "job_type",
      "TEXT DEFAULT 'Standalone'"
    );
    ensureColumn("jobs", "pricing_basis", "TEXT");
    ensureColumn("jobs", "last_reassigned_by", "TEXT");
    ensureColumn("jobs", "reassignment_note", "TEXT");

    // Ügyfélimport és ügyfélállapot mezők.
    ensureColumn("contacts", "billing_address", "TEXT");
    ensureColumn("contacts", "external_reference", "TEXT");
    ensureColumn("contacts", "import_source", "TEXT");
    ensureColumn("contacts", "import_batch_id", "TEXT");

    ensureColumn(
      "contacts",
      "has_piano",
      "INTEGER DEFAULT 0"
    );
    ensureColumn(
      "contacts",
      "interested_buying",
      "INTEGER DEFAULT 0"
    );
    ensureColumn("contacts", "interest_brand", "TEXT");
    ensureColumn("contacts", "interest_model", "TEXT");
    ensureColumn(
      "contacts",
      "interest_budget",
      "REAL DEFAULT 0"
    );
    ensureColumn("contacts", "interest_timeline", "TEXT");
    ensureColumn("contacts", "interest_notes", "TEXT");

    // Zongoraimport-mezők.
    // Ezeknek az indexek létrehozása előtt már létezniük kell.
    ensureColumn(
      "pianos",
      "ownership_type",
      "TEXT DEFAULT 'Customer owned'"
    );
    ensureColumn("pianos", "display_name", "TEXT");
    ensureColumn(
      "pianos",
      "asset_recorded",
      "INTEGER DEFAULT 0"
    );
    ensureColumn("pianos", "external_reference", "TEXT");
    ensureColumn("pianos", "import_source", "TEXT");
    ensureColumn("pianos", "import_batch_id", "TEXT");
    ensureColumn("pianos", "original_description", "TEXT");
    ensureColumn("pianos", "owner_resolution", "TEXT");

    // Régebbi import_batches táblák zongoraimport-számlálói.
    ensureColumn(
      "import_batches",
      "imported_pianos",
      "INTEGER DEFAULT 0"
    );
    ensureColumn(
      "import_batches",
      "updated_clients",
      "INTEGER DEFAULT 0"
    );
    ensureColumn(
      "import_batches",
      "unidentified_owner_pianos",
      "INTEGER DEFAULT 0"
    );
    ensureColumn(
      "import_batches",
      "client_not_found",
      "INTEGER DEFAULT 0"
    );
  });

  migrateColumns();

  /**
   * Az egyedi importbatch-index létrehozása előtt eltávolítjuk
   * a régi rendszerből származó ismétlődő PREVIEW/FAILED rekordokat.
   */
  removeDuplicateImportBatches();

  // Indexek csak a szükséges oszlopok és az ismétlődések rendezése után.
  ensureIndex(
    `
      CREATE UNIQUE INDEX IF NOT EXISTS
      idx_contacts_import_reference
      ON contacts(import_source, external_reference)
      WHERE import_source IS NOT NULL
        AND external_reference IS NOT NULL
    `,
    "idx_contacts_import_reference"
  );

  ensureIndex(
    `
      CREATE INDEX IF NOT EXISTS
      idx_contacts_email
      ON contacts(email)
    `,
    "idx_contacts_email"
  );

  ensureIndex(
    `
      CREATE INDEX IF NOT EXISTS
      idx_contacts_phone
      ON contacts(phone)
    `,
    "idx_contacts_phone"
  );

  ensureIndex(
    `
      CREATE INDEX IF NOT EXISTS
      idx_contacts_import_batch
      ON contacts(import_batch_id)
    `,
    "idx_contacts_import_batch"
  );

  ensureIndex(
    `
      CREATE UNIQUE INDEX IF NOT EXISTS
      idx_import_batches_file_hash_source
      ON import_batches(import_source, file_hash)
      WHERE import_source IS NOT NULL
        AND file_hash IS NOT NULL
    `,
    "idx_import_batches_file_hash_source"
  );

  ensureIndex(
    `
      CREATE UNIQUE INDEX IF NOT EXISTS
      idx_pianos_import_reference
      ON pianos(import_source, external_reference)
      WHERE import_source IS NOT NULL
        AND external_reference IS NOT NULL
    `,
    "idx_pianos_import_reference"
  );

  ensureIndex(
    `
      CREATE INDEX IF NOT EXISTS
      idx_pianos_import_batch
      ON pianos(import_batch_id)
    `,
    "idx_pianos_import_batch"
  );

  ensureIndex(
    `
      CREATE INDEX IF NOT EXISTS
      idx_pianos_owner_resolution
      ON pianos(owner_resolution)
    `,
    "idx_pianos_owner_resolution"
  );

  ensureIndex(
    `
      CREATE INDEX IF NOT EXISTS
      idx_pianos_owner_contact
      ON pianos(owner_contact_id)
    `,
    "idx_pianos_owner_contact"
  );
}

try {
  runMigrations();
  console.log("Database migrations completed successfully.");
} catch (error) {
  console.error("Database initialization failed.");
  console.error(error);

  try {
    db.close();
  } catch (closeError) {
    console.error(
      "Database could not be closed cleanly:",
      closeError.message
    );
  }

  process.exit(1);
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(
    Math.random() * 9999
  )}`;
}

function addUser(name, email, password, role) {
  const hash = bcrypt.hashSync(password, 10);

  db.prepare(
    `
      INSERT OR IGNORE INTO users(
        id,
        name,
        email,
        password_hash,
        role,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(
    id("U"),
    name,
    email,
    hash,
    role,
    "Active"
  );
}

addUser(
  "Károly",
  "karoly@klavierhaus.local",
  "karoly123",
  "ADMIN"
);
addUser(
  "Alex",
  "alex@klavierhaus.local",
  "alex123",
  "ADMIN"
);
addUser(
  "Paul",
  "paul@klavierhaus.local",
  "paul123",
  "MANAGER"
);
addUser(
  "Misi",
  "misi@klavierhaus.local",
  "misi123",
  "MANAGER"
);
addUser(
  "Said",
  "said@klavierhaus.local",
  "said123",
  "WORKER"
);

const accounts = [
  ["1000", "Cash", "Készpénz", "ASSET", "DEBIT"],
  ["1010", "Bank", "Bank", "ASSET", "DEBIT"],
  [
    "1020",
    "Undeposited Checks",
    "Befizetés előtti csekkek",
    "ASSET",
    "DEBIT"
  ],
  [
    "1200",
    "Accounts Receivable",
    "Vevőkövetelés",
    "ASSET",
    "DEBIT"
  ],
  ["1300", "Inventory", "Készlet", "ASSET", "DEBIT"],
  [
    "1500",
    "Fixed Assets",
    "Befektetett eszközök",
    "ASSET",
    "DEBIT"
  ],
  [
    "2000",
    "Accounts Payable",
    "Szállítói tartozás",
    "LIABILITY",
    "CREDIT"
  ],
  [
    "2100",
    "SBA Loan",
    "SBA hitel",
    "LIABILITY",
    "CREDIT"
  ],
  [
    "3000",
    "Owner Equity",
    "Saját tőke",
    "EQUITY",
    "CREDIT"
  ],
  [
    "4000",
    "Sales Revenue",
    "Árbevétel",
    "REVENUE",
    "CREDIT"
  ],
  [
    "4100",
    "Restoration Revenue",
    "Felújítási bevétel",
    "REVENUE",
    "CREDIT"
  ],
  [
    "4200",
    "Tuning Revenue",
    "Hangolási bevétel",
    "REVENUE",
    "CREDIT"
  ],
  [
    "4300",
    "Concert Service Revenue",
    "Koncertszerviz bevétel",
    "REVENUE",
    "CREDIT"
  ],
  [
    "5000",
    "Cost of Goods Sold",
    "Eladott áruk költsége",
    "EXPENSE",
    "DEBIT"
  ],
  [
    "6100",
    "Rent Expense",
    "Bérleti díj",
    "EXPENSE",
    "DEBIT"
  ],
  [
    "6200",
    "Transport Expense",
    "Szállítási költség",
    "EXPENSE",
    "DEBIT"
  ],
  [
    "6300",
    "Payroll Expense",
    "Bérköltség",
    "EXPENSE",
    "DEBIT"
  ],
  [
    "6400",
    "Interest Expense",
    "Kamatköltség",
    "EXPENSE",
    "DEBIT"
  ]
];

const accountStatement = db.prepare(
  `
    INSERT OR IGNORE INTO accounts(
      code,
      name_en,
      name_hu,
      category,
      normal_side
    )
    VALUES (?, ?, ?, ?, ?)
  `
);

accounts.forEach((account) => {
  accountStatement.run(...account);
});

if (
  db.prepare(
    "SELECT COUNT(*) AS count FROM contacts"
  ).get().count === 0
) {
  db.prepare(
    `
      INSERT INTO contacts(
        id,
        name,
        company,
        type,
        email,
        phone,
        address,
        priority,
        status,
        owner,
        relationship_holder,
        loss_risk,
        last_contact,
        next_step,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    "C-001",
    "John Smith",
    "Carnegie-level client",
    "Institution",
    "",
    "+1 555 000 1111",
    "Manhattan, NY",
    "Critical",
    "Active",
    "Károly",
    "Károly",
    "High",
    "2026-06-20",
    "Confirm concert prep",
    "Demo contact."
  );
}

if (
  db.prepare(
    "SELECT COUNT(*) AS count FROM pianos"
  ).get().count === 0
) {
  db.prepare(
    `
      INSERT INTO pianos(
        id,
        brand,
        model,
        serial_no,
        year,
        ownership,
        owner_contact_id,
        location,
        estimated_value,
        status,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    "P-001",
    "Steinway & Sons",
    "D",
    "TBD",
    1890,
    "Customer owned",
    "C-001",
    "Client site",
    120000,
    "In restoration",
    "Demo piano."
  );
}

if (
  db.prepare(
    "SELECT COUNT(*) AS count FROM jobs"
  ).get().count === 0
) {
  db.prepare(
    `
      INSERT INTO jobs(
        id,
        title,
        job_type,
        client_id,
        client_name,
        client_phone,
        piano_id,
        piano_name,
        assigned_to,
        created_by,
        priority,
        status,
        start_time,
        end_time,
        planned_amount,
        pricing_basis,
        planned_hours,
        travel_minutes,
        service_address,
        instructions
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `
  ).run(
    "J-001",
    "Demo Steinway tuning",
    "Standalone",
    "C-001",
    "John Smith",
    "+1 555 000 1111",
    "P-001",
    "Steinway D",
    "Said",
    "Károly",
    "High",
    "Open",
    "2026-07-20T11:00",
    "2026-07-20T14:00",
    500,
    "Phone quote / Telefonos ajánlat",
    3,
    35,
    "Manhattan, NY",
    "Demo calendar job."
  );
}

console.log(
  "Klavierhaus v6 database initialized:",
  dbPath
);

db.close();
