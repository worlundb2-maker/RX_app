import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { AppDb, PharmacyCode, PharmacyConfig, ReviewLabel, UploadRecord, UploadType, UserRecord } from './types';
import { getAppDataDir } from './paths';

export const PHARMACIES: PharmacyConfig[] = [
  { code: 'KONAWA', name: 'Konawa', color: '#eab308', npi: '1003998980', ncpdp: '3723548', aliases: { storeNumbers: ['1'], names: ['konawa', 'the pharmacy @ cofmc 1', 'the pharmacy @ cofmc 1 - konawa'] } },
  { code: 'MONTE_VISTA', name: 'Monte Vista', color: '#2563eb', npi: '1922571009', ncpdp: '3730442', aliases: { storeNumbers: ['2'], names: ['monte vista', 'mv', 'the pharmacy @ cofmc 2', 'the pharmacy @ cofmc 2 - monte vista'] } },
  { code: 'ARLINGTON', name: 'Arlington', color: '#dc2626', npi: '1962509802', ncpdp: '3718535', aliases: { npi: ['1963509802'], storeNumbers: ['3'], names: ['arlington', 'arlington pharmacy', 'cl phcy on arlington phs', 'the pharmacy @ cofmc 3', 'the pharmacy @ cofmc 3 - arlington'] } },
  { code: 'SEMINOLE', name: 'Seminole', color: '#16a34a', npi: '1205540101', ncpdp: '3731937', aliases: { storeNumbers: ['4'], names: ['seminole', 'the pharmacy @ cofmc 4', 'the pharmacy @ cofmc 4 - seminole'] } }
];

const storageRoot = getAppDataDir();
const appDir = path.resolve(storageRoot, 'app_data');
const uploadsDir = path.resolve(storageRoot, 'uploads');
export const ingestInboxDir = path.resolve(storageRoot, 'ingest_inbox');
const sqliteFile = path.join(appDir, 'db.sqlite');
const legacyJsonFile = path.join(appDir, 'db.json');
const APP_STATE_ROW_ID = 1;
const SQLITE_SCHEMA_VERSION = 6;
let sqliteCliAvailable: boolean | null = null;
let pythonSqliteAvailable: boolean | null = null;
const ENTITY_TABLES = [
  { table: 'users', path: 'users' },
  { table: 'uploads', path: 'uploads' },
  { table: 'inventory_rows', path: 'inventoryRows' },
  { table: 'price_rows', path: 'priceRows' },
  { table: 'review_decisions', path: 'reviewDecisions' },
] as const;

function createDefaultDb(): AppDb {
  return {
    schemaVersion: SQLITE_SCHEMA_VERSION,
    users: [
      { id: randomUUID(), username: 'admin', password: 'admin', role: 'admin', displayName: 'Default Admin' }
    ],
    uploads: [],
    pioneerClaims: [],
    mtfClaims: [],
    inventoryRows: [],
    priceRows: [],
    reviewDecisions: []
  };
}

function normalizeDb(input: Partial<AppDb> | null | undefined): AppDb {
  const fallback = createDefaultDb();
  return {
    ...fallback,
    ...(input || {}),
    schemaVersion: SQLITE_SCHEMA_VERSION,
    users: input?.users ?? fallback.users,
    uploads: input?.uploads ?? [],
    pioneerClaims: input?.pioneerClaims ?? [],
    mtfClaims: input?.mtfClaims ?? [],
    inventoryRows: input?.inventoryRows ?? [],
    priceRows: input?.priceRows ?? [],
    reviewDecisions: input?.reviewDecisions ?? [],
  };
}

function quoteSqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function canUseSqliteCli() {
  if (sqliteCliAvailable != null) return sqliteCliAvailable;
  try {
    execFileSync('sqlite3', ['--version'], { stdio: 'ignore' });
    sqliteCliAvailable = true;
  } catch {
    sqliteCliAvailable = false;
  }
  return sqliteCliAvailable;
}

function canUsePythonSqlite() {
  if (pythonSqliteAvailable != null) return pythonSqliteAvailable;
  try {
    execFileSync('python3', ['-c', 'import sqlite3'], { stdio: 'ignore' });
    pythonSqliteAvailable = true;
  } catch {
    pythonSqliteAvailable = false;
  }
  return pythonSqliteAvailable;
}

function runSqlWithPython(sql: string): string {
  const script = [
    'import sqlite3, sys',
    'db_file = sys.argv[1]',
    'sql = sys.argv[2]',
    'conn = sqlite3.connect(db_file)',
    'cur = conn.cursor()',
    "parts = [part.strip() for part in sql.split(';') if part.strip()]",
    "for part in parts[:-1]: cur.execute(part)",
    'out = ""',
    'if parts:',
    '    cur.execute(parts[-1])',
    '    rows = cur.fetchall()',
    "    out = '\\n'.join('' if row[0] is None else str(row[0]) for row in rows)",
    'conn.commit()',
    'conn.close()',
    'sys.stdout.write(out)',
  ].join('\n');
  return execFileSync('python3', ['-c', script, sqliteFile, sql], { encoding: 'utf8' });
}

function runSql(sql: string): string {
  if (canUseSqliteCli()) {
    return execFileSync('sqlite3', [sqliteFile, sql], { encoding: 'utf8' });
  }
  if (canUsePythonSqlite()) {
    return runSqlWithPython(sql);
  }
  throw new Error('No local SQLite runtime is available.');
}

function hasLocalSqliteRuntime() {
  return canUseSqliteCli() || canUsePythonSqlite();
}

function readLegacyJsonDb(): AppDb {
  if (!fs.existsSync(legacyJsonFile)) return normalizeDb(null);
  try {
    const parsed = JSON.parse(fs.readFileSync(legacyJsonFile, 'utf8')) as Partial<AppDb>;
    return normalizeDb(parsed);
  } catch {
    return normalizeDb(null);
  }
}

function writeLegacyJsonDb(db: AppDb) {
  const normalized = normalizeDb(db);
  const tempFile = `${legacyJsonFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(normalized), 'utf8');
  fs.renameSync(tempFile, legacyJsonFile);
}

function saveDbToSqlite(db: AppDb) {
  const normalized = normalizeDb(db);
  const tempWriteFile = path.join(appDir, 'db.write.json');
  fs.writeFileSync(tempWriteFile, JSON.stringify(normalized), 'utf8');
  try {
    const statements = [
      'BEGIN TRANSACTION',
      `INSERT INTO meta (key, value) VALUES ('schema_version', '${SQLITE_SCHEMA_VERSION}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      'DELETE FROM pioneer_claims',
      `INSERT INTO pioneer_claims (
        id, pharmacy_code, pharmacy_npi, pharmacy_name, rx_number, fill_number, fill_date, claim_date, inventory_group,
        prescriber_category, ndc, drug_name, quantity, days_supply, primary_payer, primary_plan_type, secondary_payer,
        secondary_plan_type, payer_type, claim_status, current_transaction_status, normalized_claim_lifecycle,
        total_price_paid, primary_remit_amount, secondary_remit_amount, patient_pay_amount, acquisition_cost, bin, pcn,
        group_number, third_party_name, brand_generic, sig, seq
      )
      SELECT
        json_extract(value, '$.id'),
        json_extract(value, '$.pharmacyCode'),
        json_extract(value, '$.pharmacyNpi'),
        json_extract(value, '$.pharmacyName'),
        json_extract(value, '$.rxNumber'),
        CAST(json_extract(value, '$.fillNumber') AS INTEGER),
        json_extract(value, '$.fillDate'),
        json_extract(value, '$.claimDate'),
        json_extract(value, '$.inventoryGroup'),
        json_extract(value, '$.prescriberCategory'),
        json_extract(value, '$.ndc'),
        json_extract(value, '$.drugName'),
        CAST(json_extract(value, '$.quantity') AS REAL),
        CAST(json_extract(value, '$.daysSupply') AS REAL),
        json_extract(value, '$.primaryPayer'),
        json_extract(value, '$.primaryPlanType'),
        json_extract(value, '$.secondaryPayer'),
        json_extract(value, '$.secondaryPlanType'),
        json_extract(value, '$.payerType'),
        json_extract(value, '$.claimStatus'),
        json_extract(value, '$.currentTransactionStatus'),
        json_extract(value, '$.normalizedClaimLifecycle'),
        CAST(json_extract(value, '$.totalPricePaid') AS REAL),
        CAST(json_extract(value, '$.primaryRemitAmount') AS REAL),
        CAST(json_extract(value, '$.secondaryRemitAmount') AS REAL),
        CAST(json_extract(value, '$.patientPayAmount') AS REAL),
        CAST(json_extract(value, '$.acquisitionCost') AS REAL),
        json_extract(value, '$.bin'),
        json_extract(value, '$.pcn'),
        json_extract(value, '$.groupNumber'),
        json_extract(value, '$.thirdPartyName'),
        json_extract(value, '$.brandGeneric'),
        json_extract(value, '$.sig'),
        CAST(key AS INTEGER)
      FROM json_each(CAST(readfile(${quoteSqlText(tempWriteFile)}) AS TEXT), '$.pioneerClaims')`,
      'DELETE FROM mtf_claims',
      `INSERT INTO mtf_claims (
        id, pharmacy_code, pharmacy_npi, rx_number, fill_number, service_date, receipt_date, ndc, drug_name,
        quantity, sdra, manufacturer_payment_amount, raw_payment_amount, unexpected_payment, unexpected_reason,
        icn, pricing_method, source_type, seq
      )
      SELECT
        json_extract(value, '$.id'),
        json_extract(value, '$.pharmacyCode'),
        json_extract(value, '$.pharmacyNpi'),
        json_extract(value, '$.rxNumber'),
        CAST(json_extract(value, '$.fillNumber') AS INTEGER),
        json_extract(value, '$.serviceDate'),
        json_extract(value, '$.receiptDate'),
        json_extract(value, '$.ndc'),
        json_extract(value, '$.drugName'),
        CAST(json_extract(value, '$.quantity') AS REAL),
        CAST(json_extract(value, '$.sdra') AS REAL),
        CAST(json_extract(value, '$.manufacturerPaymentAmount') AS REAL),
        CAST(json_extract(value, '$.rawPaymentAmount') AS REAL),
        CAST(json_extract(value, '$.unexpectedPayment') AS INTEGER),
        json_extract(value, '$.unexpectedReason'),
        json_extract(value, '$.icn'),
        json_extract(value, '$.pricingMethod'),
        json_extract(value, '$.sourceType'),
        CAST(key AS INTEGER)
      FROM json_each(CAST(readfile(${quoteSqlText(tempWriteFile)}) AS TEXT), '$.mtfClaims')`,
      ...ENTITY_TABLES.flatMap(({ table, path }) => [
        `DELETE FROM ${table}`,
        `INSERT INTO ${table} (id, payload, seq)
         SELECT json_extract(value, '$.id'), json(value), CAST(key AS INTEGER)
         FROM json_each(CAST(readfile(${quoteSqlText(tempWriteFile)}) AS TEXT), '$.${path}')`
      ]),
      'COMMIT',
    ];
    runSql(`${statements.join(';\n')};`);
  } finally {
    if (fs.existsSync(tempWriteFile)) fs.unlinkSync(tempWriteFile);
  }
}

function readJsonArrayFromTable(table: string) {
  const result = runSql(`
    SELECT COALESCE(json_group_array(json(payload)), '[]')
    FROM (SELECT payload FROM ${table} ORDER BY seq ASC);
  `).trim();
  return result || '[]';
}

function readDbFromSqlite(): AppDb {
  const schemaVersionRaw = runSql(`SELECT value FROM meta WHERE key = 'schema_version' LIMIT 1;`).trim();
  const users = JSON.parse(readJsonArrayFromTable('users'));
  const uploads = JSON.parse(readJsonArrayFromTable('uploads'));
  const pioneerClaims = JSON.parse(runSql(`
    SELECT COALESCE(json_group_array(json_object(
      'id', id, 'pharmacyCode', pharmacy_code, 'pharmacyNpi', pharmacy_npi, 'pharmacyName', pharmacy_name,
      'rxNumber', rx_number, 'fillNumber', fill_number, 'fillDate', fill_date, 'claimDate', claim_date,
      'inventoryGroup', inventory_group, 'prescriberCategory', prescriber_category, 'ndc', ndc, 'drugName', drug_name,
      'quantity', quantity, 'daysSupply', days_supply, 'primaryPayer', primary_payer, 'primaryPlanType', primary_plan_type,
      'secondaryPayer', secondary_payer, 'secondaryPlanType', secondary_plan_type, 'payerType', payer_type,
      'claimStatus', claim_status, 'currentTransactionStatus', current_transaction_status,
      'normalizedClaimLifecycle', normalized_claim_lifecycle, 'totalPricePaid', total_price_paid,
      'primaryRemitAmount', primary_remit_amount, 'secondaryRemitAmount', secondary_remit_amount,
      'patientPayAmount', patient_pay_amount, 'acquisitionCost', acquisition_cost, 'bin', bin, 'pcn', pcn,
      'groupNumber', group_number, 'thirdPartyName', third_party_name, 'brandGeneric', brand_generic, 'sig', sig
    )), '[]')
    FROM (SELECT * FROM pioneer_claims ORDER BY seq ASC);
  `).trim() || '[]');
  const mtfClaims = JSON.parse(runSql(`
    SELECT COALESCE(json_group_array(json_object(
      'id', id, 'pharmacyCode', pharmacy_code, 'pharmacyNpi', pharmacy_npi, 'rxNumber', rx_number, 'fillNumber', fill_number,
      'serviceDate', service_date, 'receiptDate', receipt_date, 'ndc', ndc, 'drugName', drug_name, 'quantity', quantity,
      'sdra', sdra, 'manufacturerPaymentAmount', manufacturer_payment_amount, 'rawPaymentAmount', raw_payment_amount,
      'unexpectedPayment', unexpected_payment, 'unexpectedReason', unexpected_reason, 'icn', icn,
      'pricingMethod', pricing_method, 'sourceType', source_type
    )), '[]')
    FROM (SELECT * FROM mtf_claims ORDER BY seq ASC);
  `).trim() || '[]');
  const inventoryRows = JSON.parse(readJsonArrayFromTable('inventory_rows'));
  const priceRows = JSON.parse(readJsonArrayFromTable('price_rows'));
  const reviewDecisions = JSON.parse(readJsonArrayFromTable('review_decisions'));

  return normalizeDb({
    schemaVersion: Number(schemaVersionRaw) || SQLITE_SCHEMA_VERSION,
    users,
    uploads,
    pioneerClaims,
    mtfClaims,
    inventoryRows,
    priceRows,
    reviewDecisions,
  });
}

function migrateSchemaToV6() {
  const pioneerHasPayload = Number(runSql(`SELECT COUNT(*) FROM pragma_table_info('pioneer_claims') WHERE name = 'payload';`).trim() || '0') > 0;
  const mtfHasPayload = Number(runSql(`SELECT COUNT(*) FROM pragma_table_info('mtf_claims') WHERE name = 'payload';`).trim() || '0') > 0;
  const statements: string[] = ['BEGIN TRANSACTION'];
  if (pioneerHasPayload) {
    statements.push(`
        ALTER TABLE pioneer_claims RENAME TO pioneer_claims_legacy;
        CREATE TABLE pioneer_claims (
          id TEXT PRIMARY KEY,
          pharmacy_code TEXT NOT NULL,
          pharmacy_npi TEXT NOT NULL,
          pharmacy_name TEXT NOT NULL,
          rx_number TEXT NOT NULL,
          fill_number INTEGER NOT NULL,
          fill_date TEXT,
          claim_date TEXT,
          inventory_group TEXT NOT NULL,
          prescriber_category TEXT NOT NULL,
          ndc TEXT NOT NULL,
          drug_name TEXT NOT NULL,
          quantity REAL NOT NULL,
          days_supply REAL,
          primary_payer TEXT NOT NULL,
          primary_plan_type TEXT,
          secondary_payer TEXT,
          secondary_plan_type TEXT,
          payer_type TEXT NOT NULL,
          claim_status TEXT NOT NULL,
          current_transaction_status TEXT,
          normalized_claim_lifecycle TEXT NOT NULL,
          total_price_paid REAL,
          primary_remit_amount REAL,
          secondary_remit_amount REAL,
          patient_pay_amount REAL,
          acquisition_cost REAL,
          bin TEXT,
          pcn TEXT,
          group_number TEXT,
          third_party_name TEXT,
          brand_generic TEXT,
          sig TEXT,
          seq INTEGER NOT NULL
        );
        INSERT INTO pioneer_claims (
          id, pharmacy_code, pharmacy_npi, pharmacy_name, rx_number, fill_number, fill_date, claim_date, inventory_group,
          prescriber_category, ndc, drug_name, quantity, days_supply, primary_payer, primary_plan_type, secondary_payer,
          secondary_plan_type, payer_type, claim_status, current_transaction_status, normalized_claim_lifecycle,
          total_price_paid, primary_remit_amount, secondary_remit_amount, patient_pay_amount, acquisition_cost, bin, pcn,
          group_number, third_party_name, brand_generic, sig, seq
        )
        SELECT
          json_extract(payload, '$.id'),
          json_extract(payload, '$.pharmacyCode'),
          json_extract(payload, '$.pharmacyNpi'),
          json_extract(payload, '$.pharmacyName'),
          json_extract(payload, '$.rxNumber'),
          CAST(json_extract(payload, '$.fillNumber') AS INTEGER),
          json_extract(payload, '$.fillDate'),
          json_extract(payload, '$.claimDate'),
          json_extract(payload, '$.inventoryGroup'),
          json_extract(payload, '$.prescriberCategory'),
          json_extract(payload, '$.ndc'),
          json_extract(payload, '$.drugName'),
          CAST(json_extract(payload, '$.quantity') AS REAL),
          CAST(json_extract(payload, '$.daysSupply') AS REAL),
          json_extract(payload, '$.primaryPayer'),
          json_extract(payload, '$.primaryPlanType'),
          json_extract(payload, '$.secondaryPayer'),
          json_extract(payload, '$.secondaryPlanType'),
          json_extract(payload, '$.payerType'),
          json_extract(payload, '$.claimStatus'),
          json_extract(payload, '$.currentTransactionStatus'),
          json_extract(payload, '$.normalizedClaimLifecycle'),
          CAST(json_extract(payload, '$.totalPricePaid') AS REAL),
          CAST(json_extract(payload, '$.primaryRemitAmount') AS REAL),
          CAST(json_extract(payload, '$.secondaryRemitAmount') AS REAL),
          CAST(json_extract(payload, '$.patientPayAmount') AS REAL),
          CAST(json_extract(payload, '$.acquisitionCost') AS REAL),
          json_extract(payload, '$.bin'),
          json_extract(payload, '$.pcn'),
          json_extract(payload, '$.groupNumber'),
          json_extract(payload, '$.thirdPartyName'),
          json_extract(payload, '$.brandGeneric'),
          json_extract(payload, '$.sig'),
          seq
        FROM pioneer_claims_legacy;
        DROP TABLE pioneer_claims_legacy;
      `);
  }

  if (mtfHasPayload) {
    statements.push(`
        ALTER TABLE mtf_claims RENAME TO mtf_claims_legacy;
        CREATE TABLE mtf_claims (
          id TEXT PRIMARY KEY,
          pharmacy_code TEXT NOT NULL,
          pharmacy_npi TEXT NOT NULL,
          rx_number TEXT NOT NULL,
          fill_number INTEGER NOT NULL,
          service_date TEXT,
          receipt_date TEXT,
          ndc TEXT NOT NULL,
          drug_name TEXT NOT NULL,
          quantity REAL,
          sdra REAL,
          manufacturer_payment_amount REAL NOT NULL,
          raw_payment_amount REAL,
          unexpected_payment INTEGER,
          unexpected_reason TEXT,
          icn TEXT,
          pricing_method TEXT NOT NULL,
          source_type TEXT NOT NULL,
          seq INTEGER NOT NULL
        );
        INSERT INTO mtf_claims (
          id, pharmacy_code, pharmacy_npi, rx_number, fill_number, service_date, receipt_date, ndc, drug_name,
          quantity, sdra, manufacturer_payment_amount, raw_payment_amount, unexpected_payment, unexpected_reason,
          icn, pricing_method, source_type, seq
        )
        SELECT
          json_extract(payload, '$.id'),
          json_extract(payload, '$.pharmacyCode'),
          json_extract(payload, '$.pharmacyNpi'),
          json_extract(payload, '$.rxNumber'),
          CAST(json_extract(payload, '$.fillNumber') AS INTEGER),
          json_extract(payload, '$.serviceDate'),
          json_extract(payload, '$.receiptDate'),
          json_extract(payload, '$.ndc'),
          json_extract(payload, '$.drugName'),
          CAST(json_extract(payload, '$.quantity') AS REAL),
          CAST(json_extract(payload, '$.sdra') AS REAL),
          CAST(json_extract(payload, '$.manufacturerPaymentAmount') AS REAL),
          CAST(json_extract(payload, '$.rawPaymentAmount') AS REAL),
          CAST(json_extract(payload, '$.unexpectedPayment') AS INTEGER),
          json_extract(payload, '$.unexpectedReason'),
          json_extract(payload, '$.icn'),
          json_extract(payload, '$.pricingMethod'),
          json_extract(payload, '$.sourceType'),
          seq
        FROM mtf_claims_legacy;
        DROP TABLE mtf_claims_legacy;
      `);
  }
  statements.push(`INSERT INTO meta (key, value) VALUES ('schema_version', '${SQLITE_SCHEMA_VERSION}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
  statements.push('COMMIT');
  runSql(`${statements.join('\n')};`);
}

function ensureSqlite(): boolean {
  ensure();
  if (!hasLocalSqliteRuntime()) return false;
  const createSchemaSql = `
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pioneer_claims (
      id TEXT PRIMARY KEY,
      pharmacy_code TEXT NOT NULL,
      pharmacy_npi TEXT NOT NULL,
      pharmacy_name TEXT NOT NULL,
      rx_number TEXT NOT NULL,
      fill_number INTEGER NOT NULL,
      fill_date TEXT,
      claim_date TEXT,
      inventory_group TEXT NOT NULL,
      prescriber_category TEXT NOT NULL,
      ndc TEXT NOT NULL,
      drug_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      days_supply REAL,
      primary_payer TEXT NOT NULL,
      primary_plan_type TEXT,
      secondary_payer TEXT,
      secondary_plan_type TEXT,
      payer_type TEXT NOT NULL,
      claim_status TEXT NOT NULL,
      current_transaction_status TEXT,
      normalized_claim_lifecycle TEXT NOT NULL,
      total_price_paid REAL,
      primary_remit_amount REAL,
      secondary_remit_amount REAL,
      patient_pay_amount REAL,
      acquisition_cost REAL,
      bin TEXT,
      pcn TEXT,
      group_number TEXT,
      third_party_name TEXT,
      brand_generic TEXT,
      sig TEXT,
      seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mtf_claims (
      id TEXT PRIMARY KEY,
      pharmacy_code TEXT NOT NULL,
      pharmacy_npi TEXT NOT NULL,
      rx_number TEXT NOT NULL,
      fill_number INTEGER NOT NULL,
      service_date TEXT,
      receipt_date TEXT,
      ndc TEXT NOT NULL,
      drug_name TEXT NOT NULL,
      quantity REAL,
      sdra REAL,
      manufacturer_payment_amount REAL NOT NULL,
      raw_payment_amount REAL,
      unexpected_payment INTEGER,
      unexpected_reason TEXT,
      icn TEXT,
      pricing_method TEXT NOT NULL,
      source_type TEXT NOT NULL,
      seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_rows (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS price_rows (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_decisions (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = ${APP_STATE_ROW_ID}),
      schema_version INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `;
  runSql(createSchemaSql);

  const schemaVersion = runSql(`SELECT value FROM meta WHERE key = 'schema_version' LIMIT 1;`).trim();
  if (!schemaVersion) {
    let seed = createDefaultDb();
    const legacySqliteBlob = runSql(`SELECT data FROM app_state WHERE id = ${APP_STATE_ROW_ID} LIMIT 1;`).trim();
    if (legacySqliteBlob) {
      try {
        seed = normalizeDb(JSON.parse(legacySqliteBlob) as Partial<AppDb>);
      } catch {
        seed = normalizeDb(null);
      }
    } else if (fs.existsSync(legacyJsonFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(legacyJsonFile, 'utf8')) as Partial<AppDb>;
        seed = normalizeDb(parsed);
      } catch {
        seed = normalizeDb(null);
      }
    } else {
      seed = normalizeDb(seed);
    }
    saveDbToSqlite(seed);
  } else if (Number(schemaVersion) !== SQLITE_SCHEMA_VERSION) {
    migrateSchemaToV6();
  }
  return true;
}

function ensure() {
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(ingestInboxDir, { recursive: true });
}

export function readDb(): AppDb {
  const sqliteReady = ensureSqlite();
  if (!sqliteReady) return readLegacyJsonDb();
  try {
    return readDbFromSqlite();
  } catch {
    return normalizeDb(null);
  }
}

export function writeDb(db: AppDb) {
  const sqliteReady = ensureSqlite();
  if (!sqliteReady) {
    writeLegacyJsonDb(db);
    return;
  }
  saveDbToSqlite(db);
}

function norm(value: string | null | undefined) {
  return String(value || '').toLowerCase().trim();
}

export function pharmacyByNpi(npi: string | null | undefined): PharmacyConfig | undefined {
  if (!npi) return undefined;
  const cleaned = String(npi).replace(/\D/g, '').slice(0, 10);
  return PHARMACIES.find((p) => p.npi === cleaned || p.aliases?.npi?.includes(cleaned));
}

export function pharmacyByStoreNumber(store: string | null | undefined): PharmacyConfig | undefined {
  const cleaned = String(store || '').trim();
  return PHARMACIES.find((p) => p.aliases?.storeNumbers?.includes(cleaned));
}

export function pharmacyByName(name: string | null | undefined): PharmacyConfig | undefined {
  const cleaned = norm(name);
  if (!cleaned) return undefined;
  return PHARMACIES.find((p) => cleaned.includes(norm(p.name)) || p.aliases?.names?.some((x) => cleaned.includes(norm(x))));
}

export function pharmacyByCode(code: PharmacyCode | string | undefined): PharmacyConfig | undefined {
  return PHARMACIES.find((p) => p.code === code);
}

export function resolvePharmacy(input: {
  pharmacyCode?: PharmacyCode | string | undefined;
  npi?: string | null | undefined;
  store?: string | null | undefined;
  pharmacyName?: string | null | undefined;
}): PharmacyConfig | undefined {
  return pharmacyByNpi(input.npi) || pharmacyByStoreNumber(input.store) || pharmacyByName(input.pharmacyName) || pharmacyByCode(input.pharmacyCode);
}

export function saveUpload(
  file: Express.Multer.File,
  type: UploadType,
  pharmacyCode: PharmacyCode | 'ALL' | undefined,
  impactedPharmacies: PharmacyCode[],
  rows = 0,
  sourceRows = rows,
  rejectedRows = Math.max(sourceRows - rows, 0),
  sheetName?: string,
): UploadRecord {
  const db = readDb();
  const record: UploadRecord = {
    id: randomUUID(),
    type,
    pharmacyCode,
    impactedPharmacies,
    originalName: file.originalname,
    storedName: file.filename,
    uploadedAt: new Date().toISOString(),
    rows,
    sourceRows,
    rejectedRows,
    sheetName,
  };
  db.uploads.unshift(record);
  writeDb(db);
  return record;
}

export function deleteFile(storedName: string) {
  const full = path.join(uploadsDir, storedName);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

export function clearDataset(dataset: UploadType | 'all') {
  const db = readDb();
  const shouldClear = (type: UploadType) => dataset === 'all' || dataset === type;

  if (shouldClear('pioneer')) db.pioneerClaims = [];
  if (shouldClear('mtf') || shouldClear('mtf_adjustment')) {
    db.mtfClaims = dataset === 'all'
      ? []
      : db.mtfClaims.filter((x) => x.sourceType !== dataset);
  }
  if (shouldClear('inventory')) db.inventoryRows = [];
  if (shouldClear('price_rx') || shouldClear('price_340b')) {
    db.priceRows = dataset === 'all'
      ? []
      : db.priceRows.filter((x) => x.inventoryGroup !== (dataset === 'price_rx' ? 'RX' : '340B'));
  }
  if (dataset === 'all') db.reviewDecisions = [];

  const remainingUploads = [] as typeof db.uploads;
  for (const upload of db.uploads) {
    if (dataset === 'all' || upload.type === dataset) {
      deleteFile(upload.storedName);
    } else {
      remainingUploads.push(upload);
    }
  }
  db.uploads = remainingUploads;
  writeDb(db);
}

export function addUser(user: Omit<UserRecord, 'id'>) {
  const db = readDb();
  db.users.push({ ...user, id: randomUUID() });
  writeDb(db);
}

export function setReviewDecision(targetKey: string, label: ReviewLabel | null) {
  const db = readDb();
  db.reviewDecisions = db.reviewDecisions.filter((item) => item.targetKey !== targetKey);
  if (label) {
    db.reviewDecisions.unshift({
      id: randomUUID(),
      targetKey,
      label,
      updatedAt: new Date().toISOString(),
    });
  }
  writeDb(db);
}
