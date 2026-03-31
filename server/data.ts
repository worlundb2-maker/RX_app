import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppDb, PharmacyCode, PharmacyConfig, ReviewLabel, UploadRecord, UploadType, UserRecord } from './types';

export const PHARMACIES: PharmacyConfig[] = [
  { code: 'KONAWA', name: 'Konawa', color: '#eab308', npi: '1003998980', ncpdp: '3723548', aliases: { storeNumbers: ['1'], names: ['konawa', 'the pharmacy @ cofmc 1', 'the pharmacy @ cofmc 1 - konawa'] } },
  { code: 'MONTE_VISTA', name: 'Monte Vista', color: '#2563eb', npi: '1922571009', ncpdp: '3730442', aliases: { storeNumbers: ['2'], names: ['monte vista', 'mv', 'the pharmacy @ cofmc 2', 'the pharmacy @ cofmc 2 - monte vista'] } },
  { code: 'ARLINGTON', name: 'Arlington', color: '#dc2626', npi: '1962509802', ncpdp: '3718535', aliases: { npi: ['1963509802'], storeNumbers: ['3'], names: ['arlington', 'arlington pharmacy', 'cl phcy on arlington phs', 'the pharmacy @ cofmc 3', 'the pharmacy @ cofmc 3 - arlington'] } },
  { code: 'SEMINOLE', name: 'Seminole', color: '#16a34a', npi: '1205540101', ncpdp: '3731937', aliases: { storeNumbers: ['4'], names: ['seminole', 'the pharmacy @ cofmc 4', 'the pharmacy @ cofmc 4 - seminole'] } }
];

const appDir = path.resolve(process.cwd(), 'app_data');
const uploadsDir = path.resolve(process.cwd(), 'uploads');
export const ingestInboxDir = path.resolve(process.cwd(), 'ingest_inbox');
const dbFile = path.join(appDir, 'db.json');
const BACKUP_FORMAT_VERSION = 1;

type BackupUploadFile = {
  storedName: string;
  originalName: string;
  base64: string;
};

type LocalBackupPayload = {
  type: 'pharmacy_analytics_backup';
  formatVersion: number;
  createdAt: string;
  db: AppDb;
  uploadFiles: BackupUploadFile[];
};

function assertSafeStoredName(storedName: string) {
  if (!storedName || path.basename(storedName) !== storedName || storedName.includes('..')) {
    throw new Error(`Invalid upload file name in backup data: ${storedName}`);
  }
}

function createDefaultDb(): AppDb {
  return {
    schemaVersion: 4,
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

function ensure() {
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(ingestInboxDir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify(createDefaultDb(), null, 2), 'utf8');
  }
}

export function readDb(): AppDb {
  ensure();
  const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8')) as Partial<AppDb>;
  return {
    ...createDefaultDb(),
    ...parsed,
    schemaVersion: 4,
    users: parsed.users ?? createDefaultDb().users,
    uploads: parsed.uploads ?? [],
    pioneerClaims: parsed.pioneerClaims ?? [],
    mtfClaims: parsed.mtfClaims ?? [],
    inventoryRows: parsed.inventoryRows ?? [],
    priceRows: parsed.priceRows ?? [],
    reviewDecisions: parsed.reviewDecisions ?? []
  };
}

export function writeDb(db: AppDb) {
  ensure();
  const tempFile = `${dbFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db), 'utf8');
  fs.renameSync(tempFile, dbFile);
}

export function buildLocalBackup(): LocalBackupPayload {
  const db = readDb();
  const missingFiles: string[] = [];
  const uploadFiles = db.uploads
    .map((upload) => {
      assertSafeStoredName(upload.storedName);
      const full = path.join(uploadsDir, upload.storedName);
      if (!fs.existsSync(full)) {
        missingFiles.push(upload.originalName || upload.storedName);
        return null;
      }
      const content = fs.readFileSync(full);
      return {
        storedName: upload.storedName,
        originalName: upload.originalName,
        base64: content.toString('base64'),
      };
    })
    .filter(Boolean) as BackupUploadFile[];

  if (missingFiles.length) {
    throw new Error(`Backup export blocked: ${missingFiles.length} uploaded file(s) are missing locally`);
  }

  return {
    type: 'pharmacy_analytics_backup',
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    db,
    uploadFiles,
  };
}

function normalizeDb(input: Partial<AppDb>): AppDb {
  const fallback = createDefaultDb();
  return {
    ...fallback,
    ...input,
    schemaVersion: 4,
    users: input.users ?? fallback.users,
    uploads: input.uploads ?? [],
    pioneerClaims: input.pioneerClaims ?? [],
    mtfClaims: input.mtfClaims ?? [],
    inventoryRows: input.inventoryRows ?? [],
    priceRows: input.priceRows ?? [],
    reviewDecisions: input.reviewDecisions ?? [],
  };
}

export function restoreLocalBackup(raw: unknown) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Backup file is not valid JSON');
  }
  const backup = raw as Partial<LocalBackupPayload>;
  if (backup.type !== 'pharmacy_analytics_backup') {
    throw new Error('Unsupported backup format');
  }
  if (backup.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error('Unsupported backup version');
  }
  if (!backup.db || !Array.isArray(backup.uploadFiles)) {
    throw new Error('Backup payload is missing required fields');
  }

  const restoredDb = normalizeDb(backup.db as Partial<AppDb>);
  const filesByStoredName = new Map(
    backup.uploadFiles.map((file) => [file.storedName, file]),
  );

  for (const upload of restoredDb.uploads) {
    if (!filesByStoredName.has(upload.storedName)) {
      throw new Error(`Backup is missing file content for ${upload.originalName}`);
    }
  }

  ensure();
  for (const entry of fs.readdirSync(uploadsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    fs.unlinkSync(path.join(uploadsDir, entry.name));
  }

  for (const uploadFile of backup.uploadFiles) {
    assertSafeStoredName(uploadFile.storedName);
    const fileBuffer = Buffer.from(uploadFile.base64 || '', 'base64');
    fs.writeFileSync(path.join(uploadsDir, uploadFile.storedName), fileBuffer);
  }

  writeDb(restoredDb);
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
