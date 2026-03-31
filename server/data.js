import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const PHARMACIES = [
    { code: 'KONAWA', name: 'Konawa', color: '#eab308', npi: '1003998980', ncpdp: '3723548', aliases: { storeNumbers: ['1'], names: ['konawa', 'the pharmacy @ cofmc 1', 'the pharmacy @ cofmc 1 - konawa'] } },
    { code: 'MONTE_VISTA', name: 'Monte Vista', color: '#2563eb', npi: '1922571009', ncpdp: '3730442', aliases: { storeNumbers: ['2'], names: ['monte vista', 'mv', 'the pharmacy @ cofmc 2', 'the pharmacy @ cofmc 2 - monte vista'] } },
    { code: 'ARLINGTON', name: 'Arlington', color: '#dc2626', npi: '1962509802', ncpdp: '3718535', aliases: { npi: ['1963509802'], storeNumbers: ['3'], names: ['arlington', 'arlington pharmacy', 'cl phcy on arlington phs', 'the pharmacy @ cofmc 3', 'the pharmacy @ cofmc 3 - arlington'] } },
    { code: 'SEMINOLE', name: 'Seminole', color: '#16a34a', npi: '1205540101', ncpdp: '3731937', aliases: { storeNumbers: ['4'], names: ['seminole', 'the pharmacy @ cofmc 4', 'the pharmacy @ cofmc 4 - seminole'] } }
];
const appDir = path.resolve(process.cwd(), 'app_data');
const uploadsDir = path.resolve(process.cwd(), 'uploads');
export const ingestInboxDir = path.resolve(process.cwd(), 'ingest_inbox');
const dbFile = path.join(appDir, 'db.json');
function createDefaultDb() {
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
export function readDb() {
    ensure();
    const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
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
export function writeDb(db) {
    ensure();
    fs.writeFileSync(dbFile, JSON.stringify(db), 'utf8');
}
function norm(value) {
    return String(value || '').toLowerCase().trim();
}
export function pharmacyByNpi(npi) {
    if (!npi)
        return undefined;
    const cleaned = String(npi).replace(/\D/g, '').slice(0, 10);
    return PHARMACIES.find((p) => p.npi === cleaned || p.aliases?.npi?.includes(cleaned));
}
export function pharmacyByStoreNumber(store) {
    const cleaned = String(store || '').trim();
    return PHARMACIES.find((p) => p.aliases?.storeNumbers?.includes(cleaned));
}
export function pharmacyByName(name) {
    const cleaned = norm(name);
    if (!cleaned)
        return undefined;
    return PHARMACIES.find((p) => cleaned.includes(norm(p.name)) || p.aliases?.names?.some((x) => cleaned.includes(norm(x))));
}
export function pharmacyByCode(code) {
    return PHARMACIES.find((p) => p.code === code);
}
export function resolvePharmacy(input) {
    return pharmacyByNpi(input.npi) || pharmacyByStoreNumber(input.store) || pharmacyByName(input.pharmacyName) || pharmacyByCode(input.pharmacyCode);
}
export function saveUpload(file, type, pharmacyCode, impactedPharmacies, rows = 0, sourceRows = rows, rejectedRows = Math.max(sourceRows - rows, 0), sheetName) {
    const db = readDb();
    const record = {
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
export function deleteFile(storedName) {
    const full = path.join(uploadsDir, storedName);
    if (fs.existsSync(full))
        fs.unlinkSync(full);
}
export function clearDataset(dataset) {
    const db = readDb();
    const shouldClear = (type) => dataset === 'all' || dataset === type;
    if (shouldClear('pioneer'))
        db.pioneerClaims = [];
    if (shouldClear('mtf') || shouldClear('mtf_adjustment')) {
        db.mtfClaims = dataset === 'all'
            ? []
            : db.mtfClaims.filter((x) => x.sourceType !== dataset);
    }
    if (shouldClear('inventory'))
        db.inventoryRows = [];
    if (shouldClear('price_rx') || shouldClear('price_340b')) {
        db.priceRows = dataset === 'all'
            ? []
            : db.priceRows.filter((x) => x.inventoryGroup !== (dataset === 'price_rx' ? 'RX' : '340B'));
    }
    if (dataset === 'all')
        db.reviewDecisions = [];
    const remainingUploads = [];
    for (const upload of db.uploads) {
        if (dataset === 'all' || upload.type === dataset) {
            deleteFile(upload.storedName);
        }
        else {
            remainingUploads.push(upload);
        }
    }
    db.uploads = remainingUploads;
    writeDb(db);
}
export function addUser(user) {
    const db = readDb();
    db.users.push({ ...user, id: randomUUID() });
    writeDb(db);
}
export function setReviewDecision(targetKey, label) {
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
