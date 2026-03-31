import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { addUser, clearDataset, ingestInboxDir, PHARMACIES, pharmacyByCode, readDb, saveUpload, setReviewDecision } from './data';
import { ingestUpload } from './parser';
import { getAppState } from './analysis';
import type { PharmacyCode, ReviewLabel, UploadType } from './types';

const upload = multer({ dest: path.resolve(process.cwd(), 'uploads') });
const uploadDir = path.resolve(process.cwd(), 'uploads');
const inboxNamingExamples = [
  'SEMINOLE_pioneer_claims_01012026to03202026.xlsx',
  'SEMINOLE_mtf_payments.csv',
  'SEMINOLE_mtf_adjustments_01012026to03202026.csv',
  'SEMINOLE_inventory_onhands.xlsx',
  'MV_pioneer_claims_01012026to03202026.xlsx',
  'GLOBAL_price_rx_rx_prices.xlsx',
  'GLOBAL_price_340b_340b_prices.xlsx',
  'SEMINOLE__pioneer__claims.xlsx',
];

function resolveInboxPharmacy(scope: string): PharmacyCode | undefined {
  const cleaned = String(scope || '').trim().toUpperCase();
  if (!cleaned) return undefined;
  const normalized = cleaned.replace(/[^A-Z0-9]+/g, '_');
  if (normalized === 'MV' || normalized === 'MONTEVISTA' || normalized === 'MONTE_VISTA') return 'MONTE_VISTA';
  if (normalized === 'ARLINGTON') return 'ARLINGTON';
  if (normalized === 'KONAWA') return 'KONAWA';
  if (normalized === 'SEMINOLE') return 'SEMINOLE';
  return PHARMACIES.find((pharmacy) => pharmacy.code === normalized)?.code;
}

function detectInboxTypeFromTokens(tokens: string[]): UploadType | null {
  const has = (...values: string[]) => values.some((value) => tokens.includes(value));

  if (has('global') && has('price')) {
    if (has('340b')) return 'price_340b';
    if (has('rx')) return 'price_rx';
  }

  if (has('pioneer') && has('claims')) return 'pioneer';
  if (has('inventory') || has('onhand', 'onhands')) return 'inventory';
  if (has('mtf')) {
    if (has('adjustment', 'adjustments')) return 'mtf_adjustment';
    if (has('payment', 'payments')) return 'mtf';
    return 'mtf';
  }

  return null;
}

function parseInboxAssignment(fileName: string): { type: UploadType; pharmacyCode?: PharmacyCode } | null {
  const baseName = path.basename(fileName);
  const legacyMatch = /^(.*?)__(pioneer|mtf_adjustment|mtf|inventory|price_rx|price_340b)__(.+)$/i.exec(baseName);
  if (legacyMatch) {
    const scope = String(legacyMatch[1] || '').trim();
    const type = legacyMatch[2].toLowerCase() as UploadType;
    if (type === 'price_rx' || type === 'price_340b') return { type };
    const pharmacyCode = resolveInboxPharmacy(scope);
    return pharmacyCode ? { type, pharmacyCode } : null;
  }

  const stem = path.parse(baseName).name;
  const tokens = stem
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return null;

  const type = detectInboxTypeFromTokens(tokens);
  if (!type) return null;
  if (type === 'price_rx' || type === 'price_340b') return { type };

  const pharmacyMatches = detectInboxPharmacyMatches(tokens);
  if (pharmacyMatches.length !== 1) return null;
  return { type, pharmacyCode: pharmacyMatches[0] };
}

function detectInboxPharmacyMatches(tokens: string[]): PharmacyCode[] {
  const set = new Set(tokens.map((token) => token.trim().toLowerCase()).filter(Boolean));
  const matches = new Set<PharmacyCode>();

  if (set.has('mv') || set.has('montevista') || (set.has('monte') && set.has('vista'))) matches.add('MONTE_VISTA');
  if (set.has('arlington')) matches.add('ARLINGTON');
  if (set.has('konawa')) matches.add('KONAWA');
  if (set.has('seminole')) matches.add('SEMINOLE');

  return [...matches];
}

function scanInbox() {
  fs.mkdirSync(ingestInboxDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const entries = fs.readdirSync(ingestInboxDir, { withFileTypes: true }).filter((entry) => entry.isFile());
  const imported: Array<Record<string, any>> = [];
  const rejected: Array<Record<string, any>> = [];

  for (const entry of entries) {
    const originalName = entry.name;
    const assignment = parseInboxAssignment(originalName);
    if (!assignment) {
      rejected.push({ file: originalName, reason: 'Filename must identify pharmacy and file type, such as SEMINOLE_pioneer_claims.xlsx, MV_mtf_payments.csv, or GLOBAL_price_340b_prices.xlsx' });
      continue;
    }

    const sourcePath = path.join(ingestInboxDir, originalName);
    const ext = path.extname(originalName) || '.bin';
    const storedName = `${randomUUID()}${ext}`;
    const storedPath = path.join(uploadDir, storedName);

    try {
      moveFile(sourcePath, storedPath);
      const result = ingestUpload(storedPath, assignment.type, assignment.pharmacyCode);
      saveUpload(
        { originalname: originalName, filename: storedName } as Express.Multer.File,
        assignment.type,
        assignment.pharmacyCode || 'ALL',
        result.impactedPharmacies,
        result.rows,
        result.sourceRows,
        result.rejectedRows,
        result.sheetName,
      );
      imported.push({
        file: originalName,
        type: assignment.type,
        pharmacyCode: assignment.pharmacyCode || 'ALL',
        rows: result.rows,
        sourceRows: result.sourceRows,
        rejectedRows: result.rejectedRows,
      });
    } catch (error: any) {
      if (fs.existsSync(storedPath) && !fs.existsSync(sourcePath)) {
        moveFile(storedPath, sourcePath);
      }
      rejected.push({ file: originalName, reason: error?.message || 'Inbox import failed' });
    }
  }

  return {
    inboxFolder: ingestInboxDir,
    pendingFiles: entries.length,
    importedCount: imported.length,
    rejectedCount: rejected.length,
    imported,
    rejected,
  };
}

function moveFile(sourcePath: string, destinationPath: string) {
  try {
    fs.renameSync(sourcePath, destinationPath);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    fs.copyFileSync(sourcePath, destinationPath);
    fs.unlinkSync(sourcePath);
  }
}

async function pullInboxFromSftp(input: {
  host: string;
  port: number;
  username: string;
  password: string;
  remoteDir: string;
}) {
  const downloaded: string[] = [];
  fs.mkdirSync(ingestInboxDir, { recursive: true });

  const credentials = `${input.username}:${input.password}`;
  const normalizeRemoteDir = (input.remoteDir || '.').replace(/\\/g, '/').replace(/\/+$/, '');
  const encodeRemotePath = (remotePath: string) => remotePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const basePath = normalizeRemoteDir === '.' ? '' : normalizeRemoteDir;
  const listUrl = `sftp://${input.host}:${input.port}/${encodeRemotePath(basePath)}`;

  const listing = execFileSync('curl', [
    '--silent',
    '--show-error',
    '--fail',
    '--list-only',
    '--user',
    credentials,
    listUrl,
  ], { encoding: 'utf8' });

  const remoteFiles = listing.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
  for (const remoteNameRaw of remoteFiles) {
    const remoteName = path.basename(remoteNameRaw).trim();
    if (!remoteName || remoteName.endsWith('/')) continue;
    const ext = path.extname(remoteName).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) continue;

    let localName = remoteName;
    let index = 1;
    while (fs.existsSync(path.join(ingestInboxDir, localName))) {
      const parsed = path.parse(remoteName);
      localName = `${parsed.name}_${index}${parsed.ext}`;
      index += 1;
    }

    const localPath = path.join(ingestInboxDir, localName);
    const remotePath = [basePath, remoteNameRaw].filter(Boolean).join('/');
    const remoteUrl = `sftp://${input.host}:${input.port}/${encodeRemotePath(remotePath)}`;
    execFileSync('curl', [
      '--silent',
      '--show-error',
      '--fail',
      '--user',
      credentials,
      '--output',
      localPath,
      remoteUrl,
    ], { encoding: 'utf8' });
    downloaded.push(localName);
  }

  const scanResult = scanInbox();
  return {
    downloadedCount: downloaded.length,
    downloaded,
    ...scanResult,
  };
}

export function registerRoutes(app: express.Express) {
  app.get('/api/bootstrap', (_req, res) => {
    res.json({
      pharmacies: PHARMACIES,
      hasDefaultAdmin: true,
      defaultLogin: { username: 'admin', password: 'admin' },
      inbox: {
        folder: ingestInboxDir,
        examples: inboxNamingExamples,
      },
    });
  });

  app.get('/api/state', (req, res) => {
    const pharmacyCode = typeof req.query.pharmacyCode === 'string' && req.query.pharmacyCode !== 'ALL' ? req.query.pharmacyCode as PharmacyCode : undefined;
    res.json(getAppState(pharmacyCode));
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    const db = readDb();
    const user = db.users.find((u) => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ message: 'Invalid username or password' });
    res.json({ user: { id: user.id, username: user.username, role: user.role, displayName: user.displayName } });
  });

  app.post('/api/users', express.json(), (req, res) => {
    const { username, password, role, displayName } = req.body ?? {};
    if (!username || !password || !role || !displayName) return res.status(400).json({ message: 'All user fields are required' });
    addUser({ username, password, role, displayName });
    res.json({ ok: true });
  });

  app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
      const type = req.body.type as UploadType;
      const pharmacyCode = (req.body.pharmacyCode || undefined) as PharmacyCode | undefined;
      if (!req.file || !type) return res.status(400).json({ message: 'file and type are required' });
      if (type === 'inventory' && !pharmacyByCode(pharmacyCode)) return res.status(400).json({ message: 'Inventory uploads require a pharmacy selection' });
      const result = ingestUpload(req.file.path, type, pharmacyCode);
      saveUpload(req.file, type, pharmacyCode || 'ALL', result.impactedPharmacies, result.rows, result.sourceRows, result.rejectedRows, result.sheetName);
      res.json({ ok: true, ...result });
    } catch (error: any) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(400).json({ message: error?.message || 'Upload failed' });
    }
  });

  app.post('/api/inbox/scan', (_req, res) => {
    try {
      res.json({ ok: true, ...scanInbox() });
    } catch (error: any) {
      res.status(400).json({ message: error?.message || 'Inbox scan failed' });
    }
  });

  app.post('/api/inbox/sftp-import', express.json(), async (req, res) => {
    try {
      const host = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const remoteDir = typeof req.body?.remoteDir === 'string' && req.body.remoteDir.trim() ? req.body.remoteDir.trim() : '.';
      const requestedPort = Number(req.body?.port);
      const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 22;
      if (!host || !username || !password) {
        return res.status(400).json({ message: 'host, username, and password are required for SFTP import' });
      }
      const result = await pullInboxFromSftp({ host, port, username, password, remoteDir });
      res.json({ ok: true, ...result });
    } catch (error: any) {
      res.status(400).json({ message: error?.message || 'SFTP import failed' });
    }
  });

  app.post('/api/review-decision', express.json(), (req, res) => {
    const targetKey = typeof req.body?.targetKey === 'string' ? req.body.targetKey.trim() : '';
    const label = req.body?.label as ReviewLabel | null;
    const pharmacyCode = typeof req.body?.pharmacyCode === 'string' && req.body.pharmacyCode !== 'ALL'
      ? req.body.pharmacyCode as PharmacyCode
      : undefined;
    if (!targetKey) return res.status(400).json({ message: 'targetKey is required' });
    if (label != null && !['flag', 'do_not_flag', 'resolved'].includes(label)) {
      return res.status(400).json({ message: 'Invalid label' });
    }
    setReviewDecision(targetKey, label);
    res.json({ ok: true, state: getAppState(pharmacyCode) });
  });

  app.post('/api/clear', express.json(), (req, res) => {
    clearDataset((req.body?.dataset || 'all') as any);
    res.json({ ok: true });
  });
}
