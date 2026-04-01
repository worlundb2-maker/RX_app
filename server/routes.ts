import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { addInitialUser, addUser, clearDataset, ingestInboxDir, listReportingMonths, PHARMACIES, pharmacyByCode, readDb, saveUpload, setReviewDecision } from './data';
import { ingestUpload } from './parser';
import { getAppState } from './analysis';
import { getAppDataDir } from './paths';
import type { PharmacyCode, ReviewLabel, UploadType } from './types';

const upload = multer({ dest: path.resolve(process.cwd(), 'uploads') });
const uploadDir = path.resolve(process.cwd(), 'uploads');
const sessions = new Map<string, string>();
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

export function parseInboxAssignment(fileName: string): { type: UploadType; pharmacyCode?: PharmacyCode } | null {
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

  const pharmacyCode = resolveInboxPharmacy(tokens[0] || '');
  return pharmacyCode ? { type, pharmacyCode } : null;
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
      fs.renameSync(sourcePath, storedPath);
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
        fs.renameSync(storedPath, sourcePath);
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

export function registerRoutes(app: express.Express) {
  function sanitizeCredentialText(value: unknown) {
    return String(value || '').trim();
  }

  function normalizeRole(value: unknown) {
    const role = String(value || '').trim().toLowerCase();
    if (role === 'admin' || role === 'analyst' || role === 'viewer') return role;
    return null;
  }

  function parseCookies(req: express.Request) {
    const raw = String(req.headers.cookie || '');
    return raw.split(';').reduce<Record<string, string>>((acc, pair) => {
      const [key, ...rest] = pair.trim().split('=');
      if (!key) return acc;
      acc[key] = decodeURIComponent(rest.join('=') || '');
      return acc;
    }, {});
  }

  function authenticatedUser(req: express.Request) {
    const token = parseCookies(req).rx_session;
    if (!token) return null;
    const userId = sessions.get(token);
    if (!userId) return null;
    return readDb().users.find((u) => u.id === userId) || null;
  }

  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ message: 'Authentication required' });
    (req as any).user = user;
    next();
  }

  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const user = (req as any).user;
    if (!user || user.role !== 'admin') return res.status(403).json({ message: 'Admin role required' });
    next();
  }

  function parseIsoDate(value: unknown) {
    if (typeof value !== 'string') return undefined;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  }

  app.get('/api/bootstrap', (_req, res) => {
    const hasUsers = readDb().users.length > 0;
    res.json({
      pharmacies: PHARMACIES,
      reportingMonths: listReportingMonths(),
      auth: {
        hasUsers,
        requiresSetup: !hasUsers,
      },
      inbox: {
        folder: ingestInboxDir,
        examples: inboxNamingExamples,
      },
    });
  });

  app.get('/api/state', requireAuth, (req, res) => {
    const pharmacyCode = typeof req.query.pharmacyCode === 'string' && req.query.pharmacyCode !== 'ALL' ? req.query.pharmacyCode as PharmacyCode : undefined;
    const startDate = parseIsoDate(req.query.startDate);
    const endDate = parseIsoDate(req.query.endDate);
    const iraStartDate = parseIsoDate(req.query.iraStartDate);
    const iraEndDate = parseIsoDate(req.query.iraEndDate);
    res.json(getAppState(pharmacyCode, { startDate, endDate, iraStartDate, iraEndDate }));
  });

  app.post('/api/login', (req, res) => {
    const username = sanitizeCredentialText(req.body?.username);
    const password = sanitizeCredentialText(req.body?.password);
    const db = readDb();
    if (!db.users.length) return res.status(403).json({ message: 'No local users exist yet. Create an admin account first.' });
    const user = db.users.find((u) => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ message: 'Invalid username or password' });
    const token = randomUUID();
    sessions.set(token, user.id);
    res.setHeader('Set-Cookie', `rx_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict`);
    res.json({ user: { id: user.id, username: user.username, role: user.role, displayName: user.displayName } });
  });

  app.post('/api/setup-admin', express.json(), (req, res) => {
    const username = sanitizeCredentialText(req.body?.username);
    const password = sanitizeCredentialText(req.body?.password);
    const displayName = sanitizeCredentialText(req.body?.displayName);
    const role = normalizeRole(req.body?.role);
    if (!username || !password || !displayName || !role) return res.status(400).json({ message: 'All user fields are required' });
    if (role !== 'admin') return res.status(400).json({ message: 'Initial user must be an admin' });
    try {
      addInitialUser({ username, password, displayName, role });
    } catch (error: any) {
      return res.status(409).json({ message: error?.message || 'Initial user already exists' });
    }
    const created = readDb().users.find((u) => u.username === username && u.password === password);
    if (!created) return res.status(500).json({ message: 'Failed to create initial user' });
    const token = randomUUID();
    sessions.set(token, created.id);
    res.setHeader('Set-Cookie', `rx_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict`);
    res.json({ user: { id: created.id, username: created.username, role: created.role, displayName: created.displayName } });
  });

  app.post('/api/logout', (req, res) => {
    const token = parseCookies(req).rx_session;
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', 'rx_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict');
    res.json({ ok: true });
  });

  app.post('/api/users', requireAuth, requireAdmin, express.json(), (req, res) => {
    const username = sanitizeCredentialText(req.body?.username);
    const password = sanitizeCredentialText(req.body?.password);
    const displayName = sanitizeCredentialText(req.body?.displayName);
    const role = normalizeRole(req.body?.role);
    if (!username || !password || !role || !displayName) return res.status(400).json({ message: 'All user fields are required' });
    try {
      addUser({ username, password, role, displayName });
    } catch (error: any) {
      return res.status(409).json({ message: error?.message || 'User add failed' });
    }
    res.json({ ok: true });
  });

  app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
    try {
      const type = req.body.type as UploadType;
      const pharmacyCode = (req.body.pharmacyCode || undefined) as PharmacyCode | undefined;
      if (!req.file || !type) return res.status(400).json({ message: 'file and type are required' });
      if (type === 'inventory' && !pharmacyByCode(pharmacyCode)) return res.status(400).json({ message: 'Inventory uploads require a pharmacy selection' });
      const result = ingestUpload(req.file.path, type, pharmacyCode);
      saveUpload(req.file, type, pharmacyCode || 'ALL', result.impactedPharmacies, result.rows, result.sourceRows, result.rejectedRows, result.sheetName);
      res.json({ ok: true, ...result });
    } catch (error: any) {
      res.status(400).json({ message: error?.message || 'Upload failed' });
    }
  });

  app.post('/api/inbox/scan', requireAuth, (_req, res) => {
    try {
      res.json({ ok: true, ...scanInbox() });
    } catch (error: any) {
      res.status(400).json({ message: error?.message || 'Inbox scan failed' });
    }
  });

  app.post('/api/review-decision', requireAuth, express.json(), (req, res) => {
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

  app.post('/api/clear', requireAuth, express.json(), (req, res) => {
    clearDataset((req.body?.dataset || 'all') as any);
    res.json({ ok: true });
  });
}
