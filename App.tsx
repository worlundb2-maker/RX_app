import { Fragment, useEffect, useMemo, useState } from 'react';

type Pharmacy = { code:string; name:string; color:string; npi:string; ncpdp:string };
type User = { id:string; username:string; role:string; displayName:string };
type AppState = {
  kpi: Record<string, number>;
  pharmacyCards: Array<Pharmacy & {
    claimCount:number;
    medDClaims:number;
    inventoryValue:number;
    unexpectedMtfRows?: number;
    revenue?: number;
    modeledAcquisition?: number;
    grossProfit?: number;
    grossMargin?: number;
    sdraCollectibleGap?: number;
    improper340BExposure?: number;
    weightedNdcSavings?: number;
    flaggedActions?: number;
    staffing?: any;
  }>;
  financeSummary: any;
  staffing: any;
  sdraDashboardByPharmacy: any[];
  sdraResults: any[];
  sdraSummary: any;
  unmatchedMtf: any[];
  claimsAnalysis: any[];
  claimsSummary: any;
  thirdParty: any[];
  thirdPartySummary: any;
  inventoryManagement: any[];
  inventorySummary: any;
  ndcOptimization: any[];
  ndcSummary: any;
  compliance: any[];
  complianceSummary: any;
  uploads: any[];
  users: any[];
};

type UploadType = 'pioneer' | 'mtf' | 'mtf_adjustment' | 'inventory' | 'price_rx' | 'price_340b';
type UploadQueueItem = { id:string; file: File; type: UploadType; pharmacyCode: string };
type ManualStaffEntry = {
  id: string;
  pharmacyCode: string;
  roleLabel: string;
  allocated: number;
  covered: number;
  names: string;
  notes: string;
};

type ColumnDef = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'currency' | 'percent';
  width?: string;
  render?: (row: any) => any;
};

type OverviewMetric = {
  label: string;
  value: any;
  type?: ColumnDef['type'];
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  onClick?: () => void;
};

type OverviewAction = {
  label: string;
  onClick: () => void;
  kind?: 'primary' | 'secondary';
};

const sections = ['Dashboard', 'Uploads', 'SDRA', 'Claims', 'Third Party', 'Inventory', 'NDC', '340B', 'Staffing', 'Users'] as const;
type Section = (typeof sections)[number];
const pharmacyOrder = ['KONAWA', 'MONTE_VISTA', 'ARLINGTON', 'SEMINOLE'];
const pharmacyColorMap: Record<string, string> = {
  KONAWA: '#eab308',
  MONTE_VISTA: '#2563eb',
  ARLINGTON: '#dc2626',
  SEMINOLE: '#16a34a',
};

const uploadTypeLabels: Record<UploadType, string> = {
  pioneer: 'Pioneer claims',
  mtf: 'MTF payment file',
  mtf_adjustment: 'MTF adjustment file',
  inventory: 'On-hands inventory',
  price_rx: 'RX pricing',
  price_340b: '340B pricing',
};

const sectionColorMap: Record<Section, string> = {
  Dashboard: '#1f2937',
  Uploads: '#334155',
  SDRA: '#6b7280',
  Claims: '#0f766e',
  'Third Party': '#0b3b66',
  Inventory: '#1d4d4f',
  NDC: '#1f5f4a',
  '340B': '#7f1d1d',
  Staffing: '#1e40af',
  Users: '#4b5563',
};

export default function App() {
  const [bootstrap, setBootstrap] = useState<{pharmacies: Pharmacy[]; inbox?: { folder?: string; examples?: string[] }} | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [section, setSection] = useState<Section>('Dashboard');
  const [user, setUser] = useState<User | null>(null);
  const [selectedPharmacy, setSelectedPharmacy] = useState('ALL');
  const [message, setMessage] = useState('');
  const [uploadForm, setUploadForm] = useState<{ type: UploadType; pharmacyCode: string }>({ type: 'pioneer', pharmacyCode: 'SEMINOLE' });
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [userForm, setUserForm] = useState({ username: '', password: '', displayName: '', role: 'viewer' });
  const [manualStaffEntries, setManualStaffEntries] = useState<ManualStaffEntry[]>([]);
  const [manualStaffForm, setManualStaffForm] = useState({ pharmacyCode: 'SEMINOLE', roleLabel: '', allocated: '1', covered: '0', names: '', notes: '' });
  const [reportContext, setReportContext] = useState<{ section?: Section; filterText?: string; flaggedOnly?: boolean }>({});
  const isGlobalPriceUpload = uploadForm.type === 'price_rx' || uploadForm.type === 'price_340b';

  function isGlobalUpload(type: UploadType) {
    return type === 'price_rx' || type === 'price_340b';
  }

  async function loadState(pharmacyCode = selectedPharmacy) {
    const query = pharmacyCode && pharmacyCode !== 'ALL' ? `?pharmacyCode=${pharmacyCode}` : '';
    const res = await fetch(`/api/state${query}`);
    if (res.status === 401) {
      setUser(null);
      setState(null);
      return;
    }
    setState(await res.json());
  }

  useEffect(() => {
    fetch('/api/bootstrap').then((r) => r.json()).then(setBootstrap);
    try {
      const stored = localStorage.getItem('manual_staff_entries_v1');
      if (stored) setManualStaffEntries(JSON.parse(stored));
    } catch {
      // ignore malformed local staffing entries
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('manual_staff_entries_v1', JSON.stringify(manualStaffEntries));
  }, [manualStaffEntries]);

  useEffect(() => {
    if (!user) return;
    loadState(selectedPharmacy);
  }, [selectedPharmacy, user]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const res = await fetch('/api/login', { method: 'POST', body: new URLSearchParams(fd as any) });
    const data = await res.json();
    if (!res.ok) return setMessage(data.message || 'Login failed');
    setUser(data.user);
    loadState(selectedPharmacy);
    setMessage('Logged in');
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fileInput = form.querySelector('input[type=file]') as HTMLInputElement;
    if (!fileInput.files?.length) return setMessage('Choose at least one file first');
    const queued = Array.from(fileInput.files).map((file, index) => ({
      id: `${file.name}-${file.size}-${index}-${Date.now()}`,
      file,
      type: uploadForm.type,
      pharmacyCode: uploadForm.pharmacyCode,
    }));
    setUploadQueue((prev) => [...prev, ...queued]);
    form.reset();
    setMessage(`${queued.length} file${queued.length === 1 ? '' : 's'} added to upload queue`);
  }

  async function uploadQueuedFiles() {
    if (!uploadQueue.length) return setMessage('No queued files to upload');
    let successCount = 0;
    const notes: string[] = [];
    for (const item of uploadQueue) {
      const fd = new FormData();
      fd.append('file', item.file);
      fd.append('type', item.type);
      if (!isGlobalUpload(item.type)) fd.append('pharmacyCode', item.pharmacyCode);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) {
        successCount += 1;
        notes.push(`${item.file.name}: ${data.rows}/${data.sourceRows}`);
      } else {
        notes.push(`${item.file.name}: ${data.message || 'Upload failed'}`);
      }
    }
    setUploadQueue([]);
    setMessage(`${successCount} of ${notes.length} queued files uploaded · ${notes.join(' | ')}`);
    loadState();
  }

  async function saveReviewDecision(targetKey: string, label: 'flag' | 'do_not_flag' | 'resolved' | null) {
    const res = await fetch('/api/review-decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKey, label, pharmacyCode: selectedPharmacy }),
    });
    const data = await res.json();
    setMessage(res.ok ? (label ? `Saved label: ${label.replace(/_/g, ' ')}` : 'Cleared manual label') : data.message || 'Unable to save label');
    if (res.ok && data.state) setState(data.state);
  }

  async function clearDataset(dataset: string) {
    await fetch('/api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset }) });
    setMessage(`Cleared ${dataset}`);
    loadState();
  }

  async function scanInbox() {
    const res = await fetch('/api/inbox/scan', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return setMessage(data.message || 'Inbox scan failed');
    const note = `${data.importedCount || 0} imported`;
    const rejected = data.rejectedCount ? ` · ${data.rejectedCount} rejected` : '';
    setMessage(`Inbox scan complete: ${note}${rejected}`);
    loadState();
  }

  function updateQueuedFile(id: string, patch: Partial<UploadQueueItem>) {
    setUploadQueue((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function removeQueuedFile(id: string) {
    setUploadQueue((prev) => prev.filter((item) => item.id !== id));
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userForm) });
    const data = await res.json();
    setMessage(res.ok ? 'User added' : data.message || 'User add failed');
    if (res.ok) {
      setUserForm({ username:'', password:'', displayName:'', role:'viewer' });
      loadState();
    }
  }

  function openReport(targetSection: Section, options?: { filterText?: string; flaggedOnly?: boolean }) {
    setSection(targetSection);
    setReportContext({ section: targetSection, filterText: options?.filterText ?? '', flaggedOnly: options?.flaggedOnly ?? false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function logout() {
    fetch('/api/logout', { method: 'POST' }).catch(() => null);
    setUser(null);
    setState(null);
    setSection('Dashboard');
    setMessage('Logged out');
  }

  function addManualStaffEntry(e: React.FormEvent) {
    e.preventDefault();
    const roleLabel = manualStaffForm.roleLabel.trim();
    const allocated = Number(manualStaffForm.allocated || 0);
    const covered = Number(manualStaffForm.covered || 0);
    if (!roleLabel) return setMessage('Role/position is required');
    if (!Number.isFinite(allocated) || allocated < 0) return setMessage('Allocated spots must be 0 or greater');
    if (!Number.isFinite(covered) || covered < 0) return setMessage('Covered spots must be 0 or greater');
    const entry: ManualStaffEntry = {
      id: `${manualStaffForm.pharmacyCode}-${roleLabel}-${Date.now()}`,
      pharmacyCode: manualStaffForm.pharmacyCode,
      roleLabel,
      allocated,
      covered,
      names: manualStaffForm.names.trim(),
      notes: manualStaffForm.notes.trim(),
    };
    setManualStaffEntries((prev) => [...prev, entry]);
    setManualStaffForm((prev) => ({ ...prev, roleLabel: '', allocated: '1', covered: '0', names: '', notes: '' }));
    setMessage('Manual staffing entry added');
  }

  function removeManualStaffEntry(id: string) {
    setManualStaffEntries((prev) => prev.filter((item) => item.id !== id));
    setMessage('Manual staffing entry removed');
  }

  const visibleReportContext = reportContext.section === section ? reportContext : undefined;

  const topFindings = useMemo(() => {
    if (!state) return [];
    const finance = state.financeSummary || {};
    const staffingSummary = state.staffing?.summary || {};
    return [
      `${formatCell(finance.sdraCollectibleGap || 0, 'currency')} in RX SDRA collectible variance is sitting in queue.`,
      `${state.sdraSummary?.improper340BPayments || 0} 340B SDRA rows still show payment exposure.`,
      `${state.complianceSummary?.findings || 0} 340B compliance exceptions require review.`,
      `${formatCell(finance.weightedNdcSavings || 0, 'currency')} of weighted NDC savings is currently modeled.`,
      `${staffingSummary.pharmaciesWithPressure || 0} pharmacies show staffing pressure or temporary coverage.`,
    ].filter(Boolean).slice(0, 5);
  }, [state]);

  const staffingRows = useMemo(() => {
    if (!state?.staffing?.byPharmacy) return [];
    return state.staffing.byPharmacy.flatMap((site: any) =>
      site.roles.map((role: any) => ({
        id: `${site.pharmacyCode}|${role.key}`,
        pharmacyCode: site.pharmacyCode,
        pharmacyName: site.pharmacyName,
        pharmacyColor: site.pharmacyColor,
        avgRxPerWeightedDay: site.avgRxPerWeightedDay,
        weightedOperatingDays: site.weightedOperatingDays,
        siteStatus: site.staffingStatus,
        dashboardNote: site.dashboardNote,
        actionItems: site.actionItems,
        roleLabel: role.label,
        rxRange: role.rxRange || '',
        allocated: role.allocated,
        currentFilled: role.currentFilled,
        temporary: role.temporary,
        transitioningIn: role.transitioningIn,
        transitioningOut: role.transitioningOut,
        shared: role.shared,
        availableCoverage: role.availableCoverage,
        openPositions: role.openPositions,
        stretchNeed: role.stretchNeed,
        preferredNeed: role.preferredNeed,
        status: role.status,
        pressureLevel: role.pressureLevel,
        flagged: role.pressureLevel !== 'low' || role.openPositions > 0 || role.temporary > 0 || role.transitioningOut > 0,
        severity: role.pressureLevel === 'high' ? 'high' : (role.pressureLevel === 'medium' || role.temporary > 0 || role.transitioningOut > 0 ? 'medium' : 'low'),
        flagReason: role.notes?.join('; ') || role.status,
        names: role.names,
        notes: role.notes,
        details: {
          columns: ['Named coverage', 'Notes'],
          rows: (role.names.length ? role.names : ['No named coverage']).map((name: string, index: number) => [name, index === 0 ? (role.notes?.join(' | ') || site.dashboardNote || '') : ''])
        }
      }))
    );
  }, [state]);

  const manualStaffRows = useMemo(() => {
    if (!bootstrap) return [];
    return manualStaffEntries.map((entry) => {
      const pharmacy = bootstrap.pharmacies.find((item) => item.code === entry.pharmacyCode);
      const openPositions = Math.max(Number(entry.allocated) - Number(entry.covered), 0);
      return {
        id: `manual-${entry.id}`,
        pharmacyCode: entry.pharmacyCode,
        pharmacyName: pharmacy?.name || entry.pharmacyCode,
        pharmacyColor: pharmacy?.color || '#64748b',
        roleLabel: entry.roleLabel,
        rxRange: 'Manual',
        avgRxPerWeightedDay: null,
        weightedOperatingDays: null,
        allocated: Number(entry.allocated),
        availableCoverage: Number(entry.covered),
        openPositions,
        stretchNeed: null,
        preferredNeed: null,
        status: openPositions > 0 ? 'Open coverage needed' : 'Fully covered',
        pressureLevel: openPositions > 0 ? 'medium' : 'low',
        flagged: openPositions > 0,
        severity: openPositions > 0 ? 'medium' : 'low',
        flagReason: openPositions > 0 ? 'Manual entry shows open coverage' : null,
        details: {
          columns: ['Named coverage', 'Notes'],
          rows: [[entry.names || 'No names entered', entry.notes || 'Manual staffing entry']],
        },
      };
    });
  }, [manualStaffEntries, bootstrap]);

  const staffingRowsWithManual = useMemo(() => [...staffingRows, ...manualStaffRows], [staffingRows, manualStaffRows]);

  if (!bootstrap) return <div className="app"><div className="loading-state">Loading…</div></div>;
  if (!user) {
    return (
      <div className="app-shell">
        <div className="app-bg" />
        <div className="app">
          <header className="topbar card glass-card">
            <div>
              <div className="eyebrow">Foundation-aligned local build</div>
              <h1>Pharmacy Analytics</h1>
              <div className="subtitle">Finance-forward pharmacy intelligence with row-level drilldown, manual clear controls, and store-level color identity across Konawa, Monte Vista, Arlington, and Seminole.</div>
            </div>
            <div className="header-actions">
              <div className="status-chip">Not logged in</div>
            </div>
          </header>
          {message && <div className="message-banner card">{message}</div>}
          <div className="card section-card" style={{ maxWidth: 460, margin: '20px auto' }}>
            <div className="eyebrow">Authentication required</div>
            <h3>Log in to continue</h3>
            <p className="section-copy">Enter your assigned local credentials to access the dashboard.</p>
            <form onSubmit={login} className="form-grid" style={{ marginTop: 14 }}>
              <input name="username" placeholder="Username" autoComplete="username" />
              <input name="password" type="password" placeholder="Password" autoComplete="current-password" />
              <button className="primary" type="submit">Log in</button>
            </form>
          </div>
        </div>
      </div>
    );
  }
  if (!state) return <div className="app"><div className="loading-state">Loading…</div></div>;

  const pharmacyLookup = bootstrap.pharmacies.reduce<Record<string, Pharmacy>>((acc, pharmacy) => {
    acc[pharmacy.code] = pharmacy;
    return acc;
  }, {});

  const filteredFinanceByPharmacy = (state.financeSummary?.byPharmacy || []).filter((row: any) => row.claimCount > 0 || selectedPharmacy === row.pharmacyCode || selectedPharmacy === 'ALL');

  const sdraDashboardColumns: ColumnDef[] = [
    { key: 'pharmacyName', label: 'Pharmacy' },
    { key: 'eligibleClaims', label: 'Eligible RX', type: 'number' },
    { key: 'rxPaidCorrectly', label: 'RX Paid', type: 'number' },
    { key: 'rxNotPaid', label: 'RX Unpaid', type: 'number' },
    { key: 'rxIncorrect', label: 'RX Incorrect', type: 'number' },
    { key: 'pending', label: 'Pending', type: 'number' },
    { key: 'b340ImproperPayment', label: '340B Paid', type: 'number' },
    { key: 'unexpectedPaymentRows', label: 'Unexpected', type: 'number' },
    { key: 'totalExpected', label: 'Expected', type: 'currency' },
    { key: 'totalActual', label: 'Actual', type: 'currency' },
    { key: 'totalVariance', label: 'Variance', type: 'currency' },
  ];

  const sdraColumns: ColumnDef[] = [
    { key: 'pharmacyName', label: 'Pharmacy' },
    { key: 'claim.rxNumber', label: 'Rx', render: (row) => row.claim.rxNumber },
    { key: 'claim.drugName', label: 'Drug', render: (row) => row.claim.drugName },
    { key: 'claim.inventoryGroup', label: 'Group', render: (row) => row.claim.inventoryGroup },
    { key: 'expected', label: 'Expected', type: 'currency' },
    { key: 'actual', label: 'Actual Used', type: 'currency' },
    { key: 'variance', label: 'Variance', type: 'currency' },
    { key: 'status', label: 'Status' },
    { key: 'matchLevel', label: 'Match' },
  ];

  const claimsColumns: ColumnDef[] = [
    { key: 'pharmacyName', label: 'Pharmacy' },
    { key: 'ndc', label: 'NDC' },
    { key: 'drugName', label: 'Drug' },
    { key: 'inventoryGroup', label: 'Group' },
    { key: 'totalClaims', label: 'Claims', type: 'number' },
    { key: 'medDClaims', label: 'Med D', type: 'number' },
    { key: 'avgRecordedRevenuePerRx', label: 'Avg Remit/RX', type: 'currency' },
    { key: 'estimatedAcquisition', label: 'Estimated Acquisition', type: 'currency' },
    { key: 'avgGrossProfitPerRx', label: 'Gross Profit/RX', type: 'currency' },
    { key: 'opportunity', label: 'Opportunity' },
    { key: 'severity', label: 'Severity' },
  ];

  const thirdPartyColumns: ColumnDef[] = [
    { key: 'pharmacyName', label: 'Pharmacy' },
    { key: 'payer', label: 'Payer' },
    { key: 'payerType', label: 'Type' },
    { key: 'totalClaims', label: 'Claims', type: 'number' },
    { key: 'medDClaims', label: 'Med D', type: 'number' },
    { key: 'avgRemitPerRx', label: 'Avg Remit/RX', type: 'currency' },
    { key: 'avgAcquisitionCostPerRx', label: 'Avg Acquisition/RX', type: 'currency' },
    { key: 'grossProfitPerRx', label: 'Gross Profit/RX', type: 'currency' },
    { key: 'b340Rate', label: '340B Rate', type: 'percent' },
    { key: 'performanceFlag', label: 'Flag' },
    { key: 'severity', label: 'Severity' },
  ];

  const inventoryColumns: ColumnDef[] = [
    { key: 'pharmacyName', label: 'Pharmacy' },
    { key: 'ndc', label: 'NDC' },
    { key: 'drugName', label: 'Drug' },
    { key: 'totalOnHand', label: 'On Hand', type: 'number' },
    { key: 'daysOnHand', label: 'Days On Hand', type: 'number' },
    { key: 'inventoryValue', label: 'Value', type: 'currency' },
    { key: 'status', label: 'Status' },
    { key: 'severity', label: 'Severity' },
    { key: 'inventoryGroupMix', label: 'Group Mix' },
  ];

  const ndcColumns: ColumnDef[] = [
    { key: 'pharmacyName', label: 'Pharmacy' },
    { key: 'ndc', label: 'NDC' },
    { key: 'drugName', label: 'Drug' },
    { key: 'strengthMatched', label: 'Strength' },
    { key: 'inventoryGroup', label: 'Group' },
    { key: 'equivalenceBasis', label: 'Equiv Match' },
    { key: 'claims', label: 'Claims', type: 'number' },
    { key: 'weightedCurrentCost', label: 'Weighted Current Cost', type: 'currency' },
    { key: 'bestEquivalentDrug', label: 'Best equivalent' },
    { key: 'sameGroupSavingsTotal', label: 'Same-Group Savings', type: 'currency' },
    { key: 'weightedSavingsTotal', label: 'Weighted Savings', type: 'currency' },
    { key: 'recommendation', label: 'Recommendation' },
    { key: 'severity', label: 'Severity' },
  ];

  const complianceColumns: ColumnDef[] = [
    { key: 'pharmacyName', label: 'Pharmacy' },
    { key: 'claim.rxNumber', label: 'Rx', render: (row) => row.claim.rxNumber },
    { key: 'claim.drugName', label: 'Drug', render: (row) => row.claim.drugName },
    { key: 'claim.inventoryGroup', label: 'Group', render: (row) => row.claim.inventoryGroup },
    { key: 'claim.primaryPayer', label: 'Payer', render: (row) => row.claim.primaryPayer },
    { key: 'claim.prescriberCategory', label: 'Prescriber Category', render: (row) => row.claim.prescriberCategory },
    { key: 'finding', label: 'Finding' },
    { key: 'severity', label: 'Severity' },
  ];

  const staffingColumns: ColumnDef[] = [
    { key: 'pharmacyName', label: 'Pharmacy' },
    { key: 'roleLabel', label: 'Role' },
    { key: 'rxRange', label: 'RX Range' },
    { key: 'avgRxPerWeightedDay', label: 'RX / Day', type: 'number' },
    { key: 'weightedOperatingDays', label: 'Weighted Days', type: 'number' },
    { key: 'allocated', label: 'Allocated', type: 'number' },
    { key: 'availableCoverage', label: 'Covered', type: 'number' },
    { key: 'openPositions', label: 'Open', type: 'number' },
    { key: 'stretchNeed', label: 'Minimum Need', type: 'number' },
    { key: 'preferredNeed', label: 'Preferred Need', type: 'number' },
    { key: 'status', label: 'Status' },
  ];

  const uploadColumns: ColumnDef[] = [
    { key: 'type', label: 'Type' },
    { key: 'pharmacyCode', label: 'Pharmacy', render: (row) => (row.type === 'price_rx' || row.type === 'price_340b') ? 'GLOBAL' : (pharmacyLookup[row.pharmacyCode || '']?.name || row.pharmacyCode || 'ALL') },
    { key: 'rows', label: 'Accepted', type: 'number' },
    { key: 'sourceRows', label: 'Source', type: 'number' },
    { key: 'rejectedRows', label: 'Rejected', type: 'number' },
    { key: 'sheetName', label: 'Sheet' },
    { key: 'uploadedAt', label: 'Uploaded At', render: (row) => new Date(row.uploadedAt).toLocaleString() },
    { key: 'originalName', label: 'File' },
  ];

  const userColumns: ColumnDef[] = [
    { key: 'displayName', label: 'Display name' },
    { key: 'username', label: 'Username' },
    { key: 'role', label: 'Role' },
  ];

  const uploadCounts = countBy(state.uploads, (row) => row.type);
  const staffingSummary = state.staffing?.summary || {};

  return (
    <div className="app-shell">
      <div className="app-bg" />
      <div className="app">
        <header className="topbar card glass-card">
          <div>
            <div className="eyebrow">Foundation-aligned local build</div>
            <h1>Pharmacy Analytics</h1>
            <div className="subtitle">Finance-forward pharmacy intelligence with row-level drilldown, manual clear controls, and store-level color identity across Konawa, Monte Vista, Arlington, and Seminole.</div>
          </div>
          <div className="header-actions">
            {user && (
              <select value={selectedPharmacy} onChange={(e) => setSelectedPharmacy(e.target.value)}>
                <option value="ALL">All pharmacies</option>
                {bootstrap.pharmacies.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            )}
            <div className="status-chip">{user ? `${user.displayName} (${user.role})` : 'Not logged in'}</div>
            {user && <button className="secondary" type="button" onClick={logout}>Log out</button>}
          </div>
        </header>

        {message && <div className="message-banner card">{message}</div>}

        <>
        <div className="tabs card">
          {sections.map((s) => (
            <button key={s} className={`tab ${section === s ? 'active' : ''}`} style={section === s ? { borderColor: sectionColorMap[s], background: `${sectionColorMap[s]}14`, color: sectionColorMap[s] } : undefined} onClick={() => setSection(s)}>
              {s}
            </button>
          ))}
        </div>

        {section === 'Dashboard' && (
          <>
            <div className="dashboard-hero card hero-card">
              <div>
                <div className="eyebrow">Executive overview</div>
                <h2>Financial control, compliance exposure, staffing pressure, and store action queues</h2>
                <p>The dashboard is centered on modeled revenue, estimated acquisition, SDRA collectible gap, improper 340B payment exposure, inventory capital, and staffing capacity normalized to a 4.5-day operating week.</p>
              </div>
              <div className="hero-points">
                {topFindings.map((item) => <div key={item} className="hero-point">{item}</div>)}
              </div>
            </div>

            <div className="grid executive-kpi-grid">
              <ExecutiveKpi title="Recorded revenue" value={state.financeSummary?.recordedRevenue} type="currency" tone="neutral" onClick={() => openReport('Claims')} />
              <ExecutiveKpi title="Modeled acquisition" value={state.financeSummary?.modeledAcquisition} type="currency" tone="neutral" onClick={() => openReport('Claims')} />
              <ExecutiveKpi title="Gross profit" value={state.financeSummary?.grossProfit} type="currency" tone={(state.financeSummary?.grossProfit || 0) >= 0 ? 'good' : 'bad'} onClick={() => openReport('Third Party')} />
              <ExecutiveKpi title="Gross margin" value={state.financeSummary?.grossMargin} type="percent" tone={(state.financeSummary?.grossMargin || 0) >= 0 ? 'good' : 'bad'} onClick={() => openReport('Third Party')} />
              <ExecutiveKpi title="SDRA collectible gap" value={state.financeSummary?.sdraCollectibleGap} type="currency" tone={(state.financeSummary?.sdraCollectibleGap || 0) > 0 ? 'warn' : 'good'} onClick={() => openReport('SDRA', { flaggedOnly: true })} />
              <ExecutiveKpi title="340B payment exposure" value={state.financeSummary?.improper340BExposure} type="currency" tone={(state.financeSummary?.improper340BExposure || 0) > 0 ? 'bad' : 'good'} onClick={() => openReport('340B', { flaggedOnly: true })} />
              <ExecutiveKpi title="Weighted NDC savings" value={state.financeSummary?.weightedNdcSavings} type="currency" tone={(state.financeSummary?.weightedNdcSavings || 0) > 0 ? 'good' : 'neutral'} onClick={() => openReport('NDC', { flaggedOnly: true })} />
              <ExecutiveKpi title="Inventory value" value={state.financeSummary?.totalInventoryValue} type="currency" tone="neutral" onClick={() => openReport('Inventory')} />
            </div>

            <div className="grid two-col" style={{ marginTop: 18 }}>
              <div className="card section-card">
                <div className="section-head">
                  <div>
                    <div className="eyebrow">Immediate work queue</div>
                    <h3>Actionable exceptions</h3>
                  </div>
                </div>
                <div className="action-grid">
                  <ActionQueueCard title="SDRA unpaid / incorrect RX" value={state.sdraSummary?.unpaidRx + state.sdraSummary?.incorrectRx} hint={formatCell(state.financeSummary?.sdraCollectibleGap || 0, 'currency')} tone="warn" onClick={() => openReport('SDRA', { flaggedOnly: true })} />
                  <ActionQueueCard title="Improper 340B SDRA payments" value={state.sdraSummary?.improper340BPayments} hint={formatCell(state.financeSummary?.improper340BExposure || 0, 'currency')} tone="bad" onClick={() => openReport('SDRA', { filterText: '340B', flaggedOnly: true })} />
                  <ActionQueueCard title="Claims margin opportunities" value={state.claimsSummary?.flaggedClaims} hint="Open negative margin / audit patterns" tone="warn" onClick={() => openReport('Claims', { flaggedOnly: true })} />
                  <ActionQueueCard title="Payer groups under pressure" value={state.thirdParty.filter((row) => row.flagged).length} hint="Open low or negative gross profit payers" tone="warn" onClick={() => openReport('Third Party', { flaggedOnly: true })} />
                  <ActionQueueCard title="Inventory action items" value={(state.inventorySummary?.returnCandidates || 0) + (state.inventorySummary?.reorderRx || 0) + (state.inventorySummary?.replenish340B || 0)} hint="Return, reorder, and replenish queue" tone="warn" onClick={() => openReport('Inventory', { flaggedOnly: true })} />
                  <ActionQueueCard title="340B compliance exceptions" value={state.complianceSummary?.findings} hint="Prescriber, Medicaid, and referral verification" tone="bad" onClick={() => openReport('340B', { flaggedOnly: true })} />
                  <ActionQueueCard title="Staffing pressure pharmacies" value={staffingSummary.pharmaciesWithPressure} hint={`${formatCell(staffingSummary.totalOpenFte || 0, 'number')} open or exposed FTE`} tone={staffingSummary.pharmaciesWithPressure ? 'warn' : 'good'} onClick={() => openReport('Staffing', { flaggedOnly: true })} />
                  <ActionQueueCard title="Upload integrity" value={state.uploads.length} hint="Manual clear remains available on every dataset" tone="neutral" onClick={() => openReport('Uploads')} />
                </div>
              </div>
              <div className="card section-card">
                <div className="eyebrow">Staffing operating note</div>
                <h3>4.5-day productivity normalization</h3>
                <p>Monday through Thursday count as 1.0 operating day and Friday counts as 0.5. RX/day is calculated from total observed claims divided by those weighted operating days, and staffing pressure is derived from that RX/day rate.</p>
                <div className="micro-metrics">
                  <MiniMetric label="Weighted operating days in data" value={staffingSummary.totalWeightedOperatingDays} />
                  <MiniMetric label="RX / day" value={staffingSummary.overallAvgRxPerWeightedDay} />
                  <MiniMetric label="Open / exposed FTE" value={staffingSummary.totalOpenFte} />
                </div>
              </div>
            </div>

            <div className="grid pharmacy-card-grid" style={{ marginTop: 18 }}>
              {filteredFinanceByPharmacy.map((item: any) => (
                <PharmacyFinanceCard key={item.pharmacyCode} item={item} staffing={state.staffing?.byPharmacy?.find((site: any) => site.pharmacyCode === item.pharmacyCode)} onClickSdra={() => openReport('SDRA', { flaggedOnly: true, filterText: item.pharmacyName })} onClickStaffing={() => openReport('Staffing', { filterText: item.pharmacyName, flaggedOnly: true })} />
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <ReportTable
                title="SDRA totals by pharmacy"
                description="Drill from store-level SDRA performance into exact claims driving collectible gap, unexpected payments, and improper 340B payment exposure."
                rows={state.sdraDashboardByPharmacy}
                columns={sdraDashboardColumns}
                exportName="sdra_dashboard" onApplyLabel={saveReviewDecision}
                renderDetails={(row) => <DetailTable details={row.details} />}
                externalFilterText={visibleReportContext?.section === 'Dashboard' ? visibleReportContext?.filterText : ''}
                externalFlaggedOnly={visibleReportContext?.section === 'Dashboard' ? visibleReportContext?.flaggedOnly : false}
              />
            </div>
          </>
        )}

        {section === 'Uploads' && (
          <>
            <SectionOverview
              title="Uploads control center"
              subtitle="Every dataset is locally stored, manually clearable, and isolated to its intended analytic purpose so reconciliation logic stays clean."
              color={sectionColorMap.Uploads}
              metrics={[
                { label: 'Upload records', value: state.uploads.length, type: 'number' },
                { label: 'Pioneer files', value: uploadCounts.pioneer || 0, type: 'number' },
                { label: 'MTF files', value: (uploadCounts.mtf || 0) + (uploadCounts.mtf_adjustment || 0), type: 'number' },
                { label: 'Inventory files', value: uploadCounts.inventory || 0, type: 'number' },
                { label: 'Global price files', value: (uploadCounts.price_rx || 0) + (uploadCounts.price_340b || 0), type: 'number' },
              ]}
              actions={[
                { label: 'Clear MTF', onClick: () => clearDataset('mtf'), kind: 'secondary' },
                { label: 'Clear adjustments', onClick: () => clearDataset('mtf_adjustment'), kind: 'secondary' },
                { label: 'Clear all', onClick: () => clearDataset('all'), kind: 'primary' },
              ]}
            />
            <div className="grid two-col">
              <div className="card section-card">
                <div className="section-head">
                  <div>
                    <div className="eyebrow">Upload data</div>
                    <h3>Queue and ingest source files</h3>
                  </div>
                </div>
                <p className="section-copy">Select one or many files at once, then manually assign the correct file type and pharmacy to each queued file before uploading them together. For faster local intake, the app also supports an SFTP-compatible inbox folder scan.</p>
                <form onSubmit={handleUpload} style={{ marginTop: 16 }}>
                  <div className="form-grid">
                    <select value={uploadForm.type} onChange={(e) => setUploadForm({ ...uploadForm, type: e.target.value as UploadType })}>
                      <option value="pioneer">Pioneer claims</option>
                      <option value="mtf">MTF payment file</option>
                      <option value="mtf_adjustment">MTF adjustment file</option>
                      <option value="inventory">On-hands inventory</option>
                      <option value="price_rx">RX pricing</option>
                      <option value="price_340b">340B pricing</option>
                    </select>
                    {isGlobalPriceUpload ? (
                      <div className="global-upload">Applies to all stores</div>
                    ) : (
                      <select value={uploadForm.pharmacyCode} onChange={(e) => setUploadForm({ ...uploadForm, pharmacyCode: e.target.value })}>
                        {bootstrap.pharmacies.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                      </select>
                    )}
                    <input type="file" accept=".xlsx,.xls,.csv" multiple />
                    <button className="primary" type="submit">Add to queue</button>
                  </div>
                </form>
                <div className="queue-toolbar">
                  <div className="small muted">{uploadQueue.length} file{uploadQueue.length === 1 ? '' : 's'} queued</div>
                  <div className="row">
                    <button className="secondary" type="button" onClick={() => setUploadQueue([])}>Clear queue</button>
                    <button className="primary" type="button" onClick={uploadQueuedFiles}>Upload queued files</button>
                  </div>
                </div>
                <div className="queue-table-wrap">
                  <table className="queue-table">
                    <thead>
                      <tr><th>File</th><th>Type</th><th>Pharmacy</th><th></th></tr>
                    </thead>
                    <tbody>
                      {uploadQueue.length ? uploadQueue.map((item) => (
                        <tr key={item.id}>
                          <td>{item.file.name}</td>
                          <td>
                            <select value={item.type} onChange={(e) => updateQueuedFile(item.id, { type: e.target.value as UploadType })}>
                              {Object.entries(uploadTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </td>
                          <td>
                            {isGlobalUpload(item.type) ? (
                              <div className="global-upload compact">Global</div>
                            ) : (
                              <select value={item.pharmacyCode} onChange={(e) => updateQueuedFile(item.id, { pharmacyCode: e.target.value })}>
                                {bootstrap.pharmacies.map((pharmacy) => <option key={pharmacy.code} value={pharmacy.code}>{pharmacy.name}</option>)}
                              </select>
                            )}
                          </td>
                          <td><button className="secondary" type="button" onClick={() => removeQueuedFile(item.id)}>Remove</button></td>
                        </tr>
                      )) : <tr><td colSpan={4}>No files queued yet</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="clear-grid">
                  {['pioneer','mtf','mtf_adjustment','inventory','price_rx','price_340b','all'].map((d) => (
                    <button key={d} className="secondary" onClick={() => clearDataset(d)}>{d === 'all' ? 'Clear everything' : `Clear ${uploadTypeLabels[d as UploadType] || d}`}</button>
                  ))}
                </div>
              </div>
              <div className="card section-card">
                <div className="eyebrow">SFTP-compatible inbox</div>
                <h3>Scan a local drop folder</h3>
                <p className="section-copy">Any SFTP client or manual file copy can drop files into the inbox folder below. The scanner accepts the current operational naming style such as SEMINOLE_pioneer_claims..., MV_mtf_payments..., and the older double-underscore format. Click scan to import them into the normal local workflow without replacing manual upload.</p>
                <div className="support-list">
                  <div><strong>Inbox folder:</strong> {bootstrap.inbox?.folder || 'ingest_inbox'}</div>
                  <div><strong>Examples:</strong> {(bootstrap.inbox?.examples || []).join(' · ') || 'SEMINOLE_pioneer_claims.xlsx'}</div>
                </div>
                <div className="row" style={{ marginTop: 14 }}>
                  <button className="primary" type="button" onClick={scanInbox}>Scan inbox now</button>
                </div>
              </div>
              <div className="card section-card">
                <div className="eyebrow">Guardrails</div>
                <h3>Data separation rules</h3>
                <ul className="plain-list">
                  <li>Pioneer claims drive analytics and reconciliation matching.</li>
                  <li>MTF and MTF adjustments change SDRA status only.</li>
                  <li>The inbox scan uses the same file-type and pharmacy validation rules as manual upload.</li>
                  <li>On-hand files drive inventory valuation and stock status.</li>
                  <li>Global RX and 340B price files drive NDC and margin modeling.</li>
                  <li>Pioneer claims plus MTF payments and adjustments build a running history; inventory and price files overwrite their prior dataset by design, and every dataset remains manually clearable.</li>
                </ul>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <ReportTable title="Upload history" description="Track what is currently loaded and clear only the dataset you want to reset." rows={state.uploads} columns={uploadColumns} exportName="upload_history" groupByPharmacy={false} externalFilterText={visibleReportContext?.filterText} externalFlaggedOnly={visibleReportContext?.flaggedOnly} />
            </div>
          </>
        )}

        {section === 'SDRA' && (
          <>
            <SectionOverview
              title="SDRA reconciliation"
              subtitle="Monitor RX collectible gap, improper 340B payment exposure, pending items, and unexpected payment rows from MTF plus adjustment uploads."
              color={sectionColorMap.SDRA}
              metrics={[
                { label: 'Should have been paid and was paid', value: state.sdraSummary?.shouldHaveBeenPaidAndWasPaid || 0, type: 'currency', tone: 'good' },
                { label: 'Should not have been paid and was paid', value: state.sdraSummary?.shouldNotHaveBeenPaidAndWasPaid || 0, type: 'currency', tone: 'bad', onClick: () => setReportContext({ section: 'SDRA', filterText: '340B', flaggedOnly: true }) },
                { label: 'Correctly paid', value: state.sdraSummary?.correctlyPaidAmount || 0, type: 'currency', tone: 'good' },
                { label: 'Correctly not paid', value: state.sdraSummary?.correctlyNotPaidAmount || 0, type: 'currency', tone: 'good' },
                { label: 'Should have been paid but missing', value: state.sdraSummary?.shouldHaveBeenPaidButMissing || 0, type: 'currency', tone: 'warn', onClick: () => setReportContext({ section: 'SDRA', filterText: 'RX not paid and should have been', flaggedOnly: false }) },
                { label: 'Improper 340B exposure', value: state.sdraSummary?.shouldNotHaveBeenPaidExposure || 0, type: 'currency', tone: 'bad', onClick: () => setReportContext({ section: 'SDRA', filterText: '340B', flaggedOnly: true }) },
              ]}
              actions={[
                { label: 'Flagged SDRA rows', onClick: () => setReportContext({ section: 'SDRA', flaggedOnly: true }), kind: 'primary' },
                { label: 'Only 340B issues', onClick: () => setReportContext({ section: 'SDRA', filterText: '340B', flaggedOnly: true }), kind: 'secondary' },
                { label: 'Only pending', onClick: () => setReportContext({ section: 'SDRA', filterText: 'Pending', flaggedOnly: false }), kind: 'secondary' },
              ]}
            />
            <ReportTable title="SDRA reconciliation" description="Grouped by pharmacy, with claim-level drilldown into matched MTF rows, payment source, and variance." rows={state.sdraResults} columns={sdraColumns} exportName="sdra_reconciliation" onApplyLabel={saveReviewDecision} renderDetails={(row) => <DetailTable details={row.details} />} externalFilterText={visibleReportContext?.filterText} externalFlaggedOnly={visibleReportContext?.flaggedOnly} />
          </>
        )}

        {section === 'Claims' && (
          <>
            <SectionOverview
              title="Claims analysis"
              subtitle="Focus on recurring negative margin, atypical day-supply patterns, recurring brand cash claims, and concentrated payer exposure rather than flagging every low-value anomaly."
              color={sectionColorMap.Claims}
              metrics={[
                { label: 'Claim groups', value: state.claimsSummary?.totalRows || 0, type: 'number' },
                { label: 'Flagged groups', value: state.claimsSummary?.flaggedClaims || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: 'Claims', flaggedOnly: true }) },
                { label: 'Price-modeled claims', value: state.claimsSummary?.priceModeledClaims || 0, type: 'number' },
                { label: 'Cash claims', value: state.claimsSummary?.cashClaims || 0, type: 'number', onClick: () => setReportContext({ section: 'Claims', filterText: 'cash', flaggedOnly: false }) },
                { label: 'Inactive excluded', value: state.claimsSummary?.inactiveExcludedClaims || 0, type: 'number', tone: 'neutral' },
                { label: 'Gross profit', value: state.financeSummary?.grossProfit || 0, type: 'currency', tone: (state.financeSummary?.grossProfit || 0) >= 0 ? 'good' : 'bad' },
              ]}
              actions={[
                { label: 'Flagged groups', onClick: () => setReportContext({ section: 'Claims', flaggedOnly: true }), kind: 'primary' },
                { label: 'Negative margin', onClick: () => setReportContext({ section: 'Claims', filterText: 'Material negative gross profit', flaggedOnly: false }), kind: 'secondary' },
                { label: 'Brand cash', onClick: () => setReportContext({ section: 'Claims', filterText: 'Recurring brand cash claims', flaggedOnly: false }), kind: 'secondary' },
              ]}
            />
            <ReportTable title="Claims analysis" description="Opportunities are grouped by pharmacy + NDC + inventory group and always drill to the exact claim rows driving the signal." rows={state.claimsAnalysis} columns={claimsColumns} exportName="claims_analysis" onApplyLabel={saveReviewDecision} renderDetails={(row) => <DetailTable details={row.details} />} externalFilterText={visibleReportContext?.filterText} externalFlaggedOnly={visibleReportContext?.flaggedOnly} />
          </>
        )}

        {section === 'Third Party' && (
          <>
            <SectionOverview
              title="Third-party performance"
              subtitle="Monitor payer groups by pharmacy for negative or low gross profit, mix, and 340B utilization so contracting and pricing decisions are focused where they matter."
              color={sectionColorMap['Third Party']}
              metrics={[
                { label: 'Payer groups', value: state.thirdPartySummary?.groups || 0, type: 'number' },
                { label: 'Claims in scope', value: state.thirdPartySummary?.totalClaims || 0, type: 'number' },
                { label: 'Med D claims', value: state.thirdPartySummary?.medDClaims || 0, type: 'number', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Med D', flaggedOnly: false }) },
                { label: 'Medicaid claims', value: state.thirdPartySummary?.medicaidClaims || 0, type: 'number', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Medicaid', flaggedOnly: false }) },
                { label: 'RX CASH claims', value: state.thirdPartySummary?.rxCashClaims || 0, type: 'number', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Cash', flaggedOnly: false }) },
                { label: 'High GP groups', value: state.thirdPartySummary?.highGrossProfitGroups || 0, type: 'number', tone: 'good', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Healthy', flaggedOnly: false }) },
                { label: 'Lowest GP / RX', value: state.thirdPartySummary?.lowestGrossProfitPerRx || 0, type: 'currency', tone: 'bad', onClick: () => setReportContext({ section: 'Third Party', flaggedOnly: true }) },
              ]}
              actions={[
                { label: 'Flagged payers', onClick: () => setReportContext({ section: 'Third Party', flaggedOnly: true }), kind: 'primary' },
                { label: 'Negative GP', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Negative gross profit', flaggedOnly: false }), kind: 'secondary' },
                { label: 'Low GP', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Low gross profit', flaggedOnly: false }), kind: 'secondary' },
              ]}
            />
            <ReportTable title="Third-party analysis" description="Grouped by payer within each pharmacy, with row-level drilldown to the claims contributing to payer performance." rows={state.thirdParty} columns={thirdPartyColumns} exportName="third_party_analysis" onApplyLabel={saveReviewDecision} renderDetails={(row) => <DetailTable details={row.details} />} externalFilterText={visibleReportContext?.filterText} externalFlaggedOnly={visibleReportContext?.flaggedOnly} />
          </>
        )}

        {section === 'Inventory' && (
          <>
            <SectionOverview
              title="Inventory management"
              subtitle="Separate RX reorder logic from 340B replenishment, keep stores separate, and surface return candidates, understock, and overstock using days-on-hand rules." 
              color={sectionColorMap.Inventory}
              metrics={[
                { label: 'Tracked NDCs', value: state.inventorySummary?.ndcs || 0, type: 'number' },
                { label: 'Return candidates', value: state.inventorySummary?.returnCandidates || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Return candidate', flaggedOnly: false }) },
                { label: 'RX reorder', value: state.inventorySummary?.reorderRx || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Reorder RX', flaggedOnly: false }) },
                { label: '340B replenish', value: state.inventorySummary?.replenish340B || 0, type: 'number', tone: 'bad', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Replenish 340B', flaggedOnly: false }) },
                { label: 'Inventory value', value: state.financeSummary?.totalInventoryValue || 0, type: 'currency' },
              ]}
              actions={[
                { label: 'Flagged items', onClick: () => setReportContext({ section: 'Inventory', flaggedOnly: true }), kind: 'primary' },
                { label: 'Return queue', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Return candidate', flaggedOnly: false }), kind: 'secondary' },
                { label: 'Replenish 340B', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Replenish 340B', flaggedOnly: false }), kind: 'secondary' },
              ]}
            />
            <ReportTable title="Inventory management" description="Inventory drilldown stays at pharmacy level so transfer-before-return decisions remain actionable and store-specific." rows={state.inventoryManagement} columns={inventoryColumns} exportName="inventory_management" onApplyLabel={saveReviewDecision} renderDetails={(row) => <DetailTable details={row.details} />} externalFilterText={visibleReportContext?.filterText} externalFlaggedOnly={visibleReportContext?.flaggedOnly} />
          </>
        )}

        {section === 'NDC' && (
          <>
            <SectionOverview
              title="NDC optimization"
              subtitle="Use global RX and 340B price files plus Pioneer claim mix to compare dispensed NDCs only against equivalent drugs, prioritizing GCN when available and requiring matched strength before savings are suggested."
              color={sectionColorMap.NDC}
              metrics={[
                { label: 'Optimization rows', value: state.ndcSummary?.rows || 0, type: 'number' },
                { label: 'Same-group opportunities', value: state.ndcSummary?.sameGroupOpportunities || 0, type: 'number', tone: 'good' },
                { label: 'Weighted opportunities', value: state.ndcSummary?.weightedOpportunities || 0, type: 'number', tone: 'good' },
                { label: 'Same-group savings', value: state.ndcSummary?.totalSameGroupSavings || 0, type: 'currency', tone: 'good' },
                { label: 'Weighted savings', value: state.ndcSummary?.totalWeightedSavings || 0, type: 'currency', tone: 'good' },
              ]}
              actions={[
                { label: 'Flagged rows', onClick: () => setReportContext({ section: 'NDC', flaggedOnly: true }), kind: 'primary' },
                { label: 'Weighted cheaper equivalent', onClick: () => setReportContext({ section: 'NDC', filterText: 'Equivalent weighted lower-cost NDC available', flaggedOnly: false }), kind: 'secondary' },
                { label: 'Same-group cheaper equivalent', onClick: () => setReportContext({ section: 'NDC', filterText: 'Equivalent lower-cost NDC available in same inventory group', flaggedOnly: false }), kind: 'secondary' },
              ]}
            />
            <ReportTable title="NDC optimization" description="Every NDC opportunity remains drillable to candidate cost comparisons and store-specific claim utilization." rows={state.ndcOptimization} columns={ndcColumns} exportName="ndc_optimization" onApplyLabel={saveReviewDecision} renderDetails={(row) => <DetailTable details={row.details} />} externalFilterText={visibleReportContext?.filterText} externalFlaggedOnly={visibleReportContext?.flaggedOnly} />
          </>
        )}

        {section === '340B' && (
          <>
            <SectionOverview
              title="340B compliance"
              subtitle="Prioritize Medicaid on 340B, non-eligible prescribers on 340B inventory, and referral-note verification, while preserving the diabetic-supply exception and not auto-flagging Medicaid RX claims tied to 340B prescribers." 
              color={sectionColorMap['340B']}
              metrics={[
                { label: 'Findings', value: state.complianceSummary?.findings || 0, type: 'number', tone: 'bad', onClick: () => setReportContext({ section: '340B', flaggedOnly: false }) },
                { label: 'High severity', value: state.complianceSummary?.high || 0, type: 'number', tone: 'bad', onClick: () => setReportContext({ section: '340B', filterText: 'high', flaggedOnly: true }) },
                { label: 'Medium severity', value: state.complianceSummary?.medium || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: '340B', filterText: 'medium', flaggedOnly: true }) },
                { label: 'Referral checks', value: state.complianceSummary?.referralChecks || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: '340B', filterText: 'referral verification queue', flaggedOnly: false }) },
              ]}
              actions={[
                { label: 'Flagged rows', onClick: () => setReportContext({ section: '340B', flaggedOnly: true }), kind: 'primary' },
                { label: 'Medicaid on 340B', onClick: () => setReportContext({ section: '340B', filterText: 'Medicaid plan dispensed from 340B inventory', flaggedOnly: false }), kind: 'secondary' },
                { label: 'Referral verification', onClick: () => setReportContext({ section: '340B', filterText: 'referral', flaggedOnly: false }), kind: 'secondary' },
              ]}
            />
            <ReportTable title="340B compliance" description="Compliance findings drill directly to the underlying claim so corrective action can be assigned immediately." rows={state.compliance} columns={complianceColumns} exportName="340b_compliance" onApplyLabel={saveReviewDecision} renderDetails={(row) => <DetailTable details={row.details} />} externalFilterText={visibleReportContext?.filterText} externalFlaggedOnly={visibleReportContext?.flaggedOnly} />
          </>
        )}

        {section === 'Staffing' && (
          <>
            <SectionOverview
              title="Staffing profile and workload capacity"
              subtitle="Use the provided staffing profile, shared-seat rules, and a 4.5-day operating week to compare current coverage against observed RX/day demand and role-specific capacity ranges." 
              color={sectionColorMap.Staffing}
              metrics={[
                { label: 'Observed RX', value: staffingSummary.totalObservedRx || 0, type: 'number' },
                { label: 'RX / day', value: staffingSummary.overallAvgRxPerWeightedDay || 0, type: 'number' },
                { label: 'Allocated FTE', value: staffingSummary.totalAllocatedFte || 0, type: 'number' },
                { label: 'Covered FTE', value: staffingSummary.totalFilledFte || 0, type: 'number' },
                { label: 'Open / exposed FTE', value: staffingSummary.totalOpenFte || 0, type: 'number', tone: (staffingSummary.totalOpenFte || 0) > 0 ? 'warn' : 'good' },
                { label: 'Pressure pharmacies', value: staffingSummary.pharmaciesWithPressure || 0, type: 'number', tone: (staffingSummary.pharmaciesWithPressure || 0) > 0 ? 'warn' : 'good' },
                { label: 'Manual entries', value: manualStaffEntries.length, type: 'number' },
              ]}
              actions={[
                { label: 'Only pressure roles', onClick: () => setReportContext({ section: 'Staffing', flaggedOnly: true }), kind: 'primary' },
                { label: 'Temporary coverage', onClick: () => setReportContext({ section: 'Staffing', filterText: 'temporary', flaggedOnly: false }), kind: 'secondary' },
                { label: 'Open coverage', onClick: () => setReportContext({ section: 'Staffing', filterText: 'Open coverage needed', flaggedOnly: false }), kind: 'secondary' },
              ]}
            />
            <div className="grid two-col">
              <div className="card section-card">
                <div className="eyebrow">Admin support</div>
                <h3>Central support roster</h3>
                <div className="support-list">
                  <div><strong>Pharmacist support:</strong> {state.staffing?.summary?.adminSupport?.pharmacistSupport?.join(', ') || '—'}</div>
                  <div><strong>Billing support:</strong> {state.staffing?.summary?.adminSupport?.billingSupport?.join(', ') || '—'}</div>
                </div>
              </div>
              <div className="card section-card">
                <div className="eyebrow">Role capacity rules</div>
                <h3>Allocated position framework</h3>
                <ul className="plain-list compact">
                  <li>RPH: 150–200 RX per weighted day</li>
                  <li>Tech: 100–150 RX per weighted day</li>
                  <li>Clerk: 200–300 RX per weighted day</li>
                  <li>Arlington and Monte Vista share 0.5 driver support each</li>
                  <li>Seminole carries 0.5 driver / billing specialist support</li>
                </ul>
              </div>
            </div>
            <div className="card section-card" style={{ marginTop: 18 }}>
              <div className="eyebrow">Manual staffing entries</div>
              <h3>Add staffing profile rows</h3>
              <p className="section-copy">Add local staffing rows by pharmacy and position (allocated vs covered spots) to supplement the fixed profile when temporary updates are needed.</p>
              <form onSubmit={addManualStaffEntry} className="form-grid" style={{ marginTop: 12 }}>
                <select value={manualStaffForm.pharmacyCode} onChange={(e) => setManualStaffForm((prev) => ({ ...prev, pharmacyCode: e.target.value }))}>
                  {bootstrap.pharmacies.map((pharmacy) => <option key={pharmacy.code} value={pharmacy.code}>{pharmacy.name}</option>)}
                </select>
                <input value={manualStaffForm.roleLabel} onChange={(e) => setManualStaffForm((prev) => ({ ...prev, roleLabel: e.target.value }))} placeholder="Position / role (e.g., Technician)" />
                <input value={manualStaffForm.allocated} onChange={(e) => setManualStaffForm((prev) => ({ ...prev, allocated: e.target.value }))} placeholder="Allocated spots" type="number" min={0} step={0.5} />
                <input value={manualStaffForm.covered} onChange={(e) => setManualStaffForm((prev) => ({ ...prev, covered: e.target.value }))} placeholder="Covered spots" type="number" min={0} step={0.5} />
                <input value={manualStaffForm.names} onChange={(e) => setManualStaffForm((prev) => ({ ...prev, names: e.target.value }))} placeholder="Staff names (optional)" />
                <input value={manualStaffForm.notes} onChange={(e) => setManualStaffForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes (optional)" />
                <button className="primary" type="submit">Add manual row</button>
              </form>
              {manualStaffEntries.length > 0 && (
                <div className="queue-table-wrap" style={{ marginTop: 12 }}>
                  <table className="queue-table">
                    <thead>
                      <tr><th>Pharmacy</th><th>Role</th><th>Allocated</th><th>Covered</th><th>Open</th><th></th></tr>
                    </thead>
                    <tbody>
                      {manualStaffEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{bootstrap.pharmacies.find((item) => item.code === entry.pharmacyCode)?.name || entry.pharmacyCode}</td>
                          <td>{entry.roleLabel}</td>
                          <td>{entry.allocated}</td>
                          <td>{entry.covered}</td>
                          <td>{Math.max(entry.allocated - entry.covered, 0)}</td>
                          <td><button className="secondary" type="button" onClick={() => removeManualStaffEntry(entry.id)}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div style={{ marginTop: 18 }}>
              <ReportTable title="Staffing by pharmacy and role" description="Allocated positions, named coverage, temporary seats, transitional changes, manual entries, and capacity pressure are normalized to uploaded RX/day." rows={staffingRowsWithManual} columns={staffingColumns} exportName="staffing_profile" onApplyLabel={saveReviewDecision} renderDetails={(row) => <DetailTable details={row.details} />} externalFilterText={visibleReportContext?.filterText} externalFlaggedOnly={visibleReportContext?.flaggedOnly} />
            </div>
          </>
        )}

        {section === 'Users' && (
          <>
            <SectionOverview
              title="User management"
              subtitle="Maintain local user accounts and roles so analysts, viewers, and administrators see the same single-source local application." 
              color={sectionColorMap.Users}
              metrics={[
                { label: 'User accounts', value: state.users.length, type: 'number' },
                { label: 'Admins', value: state.users.filter((row) => row.role === 'admin').length, type: 'number' },
                { label: 'Analysts', value: state.users.filter((row) => row.role === 'analyst').length, type: 'number' },
                { label: 'Viewers', value: state.users.filter((row) => row.role === 'viewer').length, type: 'number' },
              ]}
              actions={[]}
            />
            <div className="grid two-col">
              <div className="card section-card">
                <div className="eyebrow">Add user</div>
                <h3>Create local user</h3>
                <form onSubmit={createUser} className="form-grid" style={{ marginTop: 12 }}>
                  <input placeholder="Display name" value={userForm.displayName} onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })} />
                  <input placeholder="Username" value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
                  <input placeholder="Password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
                  <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                    <option value="viewer">viewer</option>
                    <option value="analyst">analyst</option>
                    <option value="admin">admin</option>
                  </select>
                  <button className="primary" type="submit">Add user</button>
                </form>
              </div>
              <ReportTable title="Current users" description="Local users stay inside the app_data database and can be refreshed or backed up with the rest of the application data." rows={state.users} columns={userColumns} exportName="users" groupByPharmacy={false} allowDrilldown={false} />
            </div>
          </>
        )}
        </>
      </div>
    </div>
  );
}


function ExecutiveKpi({ title, value, type, tone = 'neutral', onClick }: { title:string; value:any; type?:ColumnDef['type']; tone?:'neutral'|'good'|'warn'|'bad'; onClick?:()=>void }) {
  const renderedValue = formatCell(value, type);
  const fitClass = renderedValue.length > 18 ? 'fit-xxs' : renderedValue.length > 15 ? 'fit-xs' : renderedValue.length > 12 ? 'fit-sm' : '';
  const content = (
    <>
      <div className="small-label">{title}</div>
      <div className={`executive-value ${fitClass}`}>{renderedValue}</div>
    </>
  );
  return onClick ? (
    <button className={`card executive-kpi tone-${tone} clickable-card`} onClick={onClick}>{content}</button>
  ) : (
    <div className={`card executive-kpi tone-${tone}`}>{content}</div>
  );
}

function MiniMetric({ label, value }: { label:string; value:any }) {
  return (
    <div className="mini-metric">
      <div className="small-label">{label}</div>
      <div className="mini-value">{formatCell(value, typeof value === 'number' && String(value).includes('.') ? 'number' : 'number')}</div>
    </div>
  );
}

function ActionQueueCard({ title, value, hint, tone = 'neutral', onClick }: { title:string; value:any; hint:string; tone?:'neutral'|'good'|'warn'|'bad'; onClick:()=>void }) {
  return (
    <button className={`action-card tone-${tone}`} onClick={onClick}>
      <div className="action-value">{formatCell(value, 'number')}</div>
      <div className="action-title">{title}</div>
      <div className="action-hint">{hint}</div>
    </button>
  );
}

function PharmacyFinanceCard({ item, staffing, onClickSdra, onClickStaffing }: { item:any; staffing:any; onClickSdra:()=>void; onClickStaffing:()=>void }) {
  const color = item.pharmacyColor || pharmacyColorMap[item.pharmacyCode] || '#132238';
  return (
    <div className="card pharmacy-performance-card" style={{ ['--pharmacyColor' as any]: color }}>
      <div className="pharmacy-performance-head">
        <div>
          <div className="eyebrow">{item.pharmacyName}</div>
          <h3>{formatCell(item.revenue || 0, 'currency')} revenue</h3>
        </div>
        <div className="pill" style={{ background: `${color}18`, color }}>{staffing?.staffingStatus || 'Stable'}</div>
      </div>
      <div className="metric-grid compact-grid">
        <MetricStack label="Gross profit" value={item.grossProfit || 0} type="currency" />
        <MetricStack label="Gross margin" value={item.grossMargin || 0} type="percent" />
        <MetricStack label="SDRA gap" value={item.sdraCollectibleGap || 0} type="currency" />
        <MetricStack label="340B exposure" value={item.improper340BExposure || 0} type="currency" />
        <MetricStack label="Inventory" value={item.inventoryValue || 0} type="currency" />
        <MetricStack label="Weighted NDC" value={item.weightedNdcSavings || 0} type="currency" />
      </div>
      <div className="small muted" style={{ marginTop: 12 }}>{staffing?.dashboardNote || `${item.flaggedActions || 0} flagged actions are currently attached to this pharmacy.`}</div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="secondary" onClick={onClickSdra}>Open SDRA issues</button>
        <button className="secondary" onClick={onClickStaffing}>Open staffing</button>
      </div>
    </div>
  );
}

function MetricStack({ label, value, type }: { label:string; value:any; type?:ColumnDef['type'] }) {
  return (
    <div>
      <div className="small-label">{label}</div>
      <div className="metric-value">{formatCell(value, type)}</div>
    </div>
  );
}

function SectionOverview({ title, subtitle, metrics, actions, color }: { title:string; subtitle:string; metrics:OverviewMetric[]; actions:OverviewAction[]; color:string }) {
  return (
    <div className="card overview-card" style={{ ['--accent' as any]: color }}>
      <div className="overview-top">
        <div>
          <div className="eyebrow">Overview</div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {actions.length > 0 && (
          <div className="overview-actions">
            {actions.map((action) => (
              <button key={action.label} className={action.kind === 'primary' ? 'primary' : 'secondary'} onClick={action.onClick}>{action.label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="overview-metrics">
        {metrics.map((metric) => {
          const content = (
            <>
              <div className="small-label">{metric.label}</div>
              <div className="overview-value">{formatCell(metric.value, metric.type)}</div>
              {metric.hint && <div className="small muted">{metric.hint}</div>}
            </>
          );
          return metric.onClick ? (
            <button key={metric.label} className={`overview-metric tone-${metric.tone || 'neutral'} clickable-metric`} onClick={metric.onClick}>{content}</button>
          ) : (
            <div key={metric.label} className={`overview-metric tone-${metric.tone || 'neutral'}`}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}

function formatCell(value: any, type: ColumnDef['type'] = 'text') {
  if (value == null || value === '') return '';
  if (type === 'currency') return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === 'percent') return `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (type === 'number') return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return String(value);
}

function cellValue(row: any, column: ColumnDef) {
  if (column.render) return column.render(row);
  return column.key.split('.').reduce((acc: any, part) => acc?.[part], row);
}

function csvEscape(value: any) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportRows(filename: string, columns: ColumnDef[], rows: any[]) {
  const lines = [columns.map((column) => csvEscape(column.label)).join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvEscape(cellValue(row, column))).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeForSearch(value: any) {
  return String(value ?? '').toLowerCase();
}

function compareValues(a: any, b: any) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const maybeNumberA = Number(a);
  const maybeNumberB = Number(b);
  if (!Number.isNaN(maybeNumberA) && !Number.isNaN(maybeNumberB) && `${a}` !== '' && `${b}` !== '') return maybeNumberA - maybeNumberB;
  return String(a).localeCompare(String(b));
}

function pharmacySortKey(code: string) {
  const index = pharmacyOrder.indexOf(code);
  return index === -1 ? 999 : index;
}

function summarizeGroup(rows: any[], columns: ColumnDef[]) {
  const flagged = rows.filter((row) => row.flagged).length;
  const manualLabels = rows.filter((row) => row.manualLabel).length;
  const numericColumns = columns.filter((column) => column.type === 'currency' || column.type === 'number');
  const highlights = numericColumns.slice(0, 2).map((column) => {
    const total = rows.reduce((sum, row) => {
      const value = Number(cellValue(row, column));
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    return `${column.label}: ${formatCell(total, column.type)}`;
  });
  return { flagged, manualLabels, totalRows: rows.length, highlights };
}

function countBy<T>(rows: T[], keyFn: (row: T) => string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = keyFn(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function ReportTable({
  title,
  description,
  rows,
  columns,
  exportName,
  groupByPharmacy = true,
  collapseGroupsByDefault = true,
  allowDrilldown = true,
  renderDetails,
  externalFilterText,
  externalFlaggedOnly,
  onApplyLabel,
}: {
  title: string;
  description?: string;
  rows: any[];
  columns: ColumnDef[];
  exportName: string;
  groupByPharmacy?: boolean;
  collapseGroupsByDefault?: boolean;
  allowDrilldown?: boolean;
  renderDetails?: (row: any) => any;
  externalFilterText?: string;
  externalFlaggedOnly?: boolean;
  onApplyLabel?: (targetKey: string, label: 'flag' | 'do_not_flag' | 'resolved' | null) => Promise<void> | void;
}) {
  const [sortKey, setSortKey] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterText, setFilterText] = useState(externalFilterText || '');
  const [flaggedOnly, setFlaggedOnly] = useState(Boolean(externalFlaggedOnly));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [pendingLabels, setPendingLabels] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; row: any } | null>(null);
  const showLabelColumn = Boolean(onApplyLabel) || rows.some((row) => row.manualLabel);

  useEffect(() => {
    if (externalFilterText !== undefined) setFilterText(externalFilterText);
  }, [externalFilterText]);

  useEffect(() => {
    if (externalFlaggedOnly !== undefined) setFlaggedOnly(Boolean(externalFlaggedOnly));
  }, [externalFlaggedOnly]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const filtered = useMemo(() => {
    const text = filterText.trim().toLowerCase();
    return rows.filter((row) => {
      if (flaggedOnly && !row.flagged) return false;
      if (!text) return true;
      return columns.some((column) => normalizeForSearch(cellValue(row, column)).includes(text))
        || normalizeForSearch(row.manualLabel).includes(text)
        || normalizeForSearch(row.flagReason).includes(text);
    });
  }, [rows, columns, filterText, flaggedOnly]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((left, right) => {
      const flagDelta = Number(Boolean(right.flagged)) - Number(Boolean(left.flagged));
      if (flagDelta !== 0) return flagDelta;
      if (sortKey) {
        const column = columns.find((item) => item.key === sortKey);
        const leftValue = column ? cellValue(left, column) : left[sortKey];
        const rightValue = column ? cellValue(right, column) : right[sortKey];
        const delta = compareValues(leftValue, rightValue);
        if (delta !== 0) return sortDir === 'asc' ? delta : -delta;
      }
      return compareValues(left.pharmacyCode || '', right.pharmacyCode || '') || compareValues(left.id || '', right.id || '');
    });
    return list;
  }, [filtered, sortKey, sortDir, columns]);

  const grouped = useMemo(() => {
    if (!groupByPharmacy) return [{ key: 'ALL', label: 'All rows', color: '#132238', rows: sorted }];
    const buckets = new Map<string, { key: string; label: string; color?: string; rows: any[] }>();
    for (const row of sorted) {
      const code = row.pharmacyCode || 'UNGROUPED';
      const label = row.pharmacyName || code;
      if (!buckets.has(code)) buckets.set(code, { key: code, label, color: row.pharmacyColor || pharmacyColorMap[code] || '#132238', rows: [] });
      buckets.get(code)!.rows.push(row);
    }
    return [...buckets.values()].sort((a, b) => pharmacySortKey(a.key) - pharmacySortKey(b.key));
  }, [sorted, groupByPharmacy]);

  useEffect(() => {
    if (!groupByPharmacy) return;
    setExpandedGroups((prev) => {
      const shouldExpand = !collapseGroupsByDefault || Boolean(filterText.trim()) || flaggedOnly;
      const next = Object.fromEntries(grouped.map((group) => [group.key, prev[group.key] ?? shouldExpand]));
      const sameKeys = Object.keys(next).length === Object.keys(prev).length;
      const changed = Object.entries(next).some(([key, value]) => prev[key] !== value);
      return sameKeys && !changed ? prev : next;
    });
  }, [groupByPharmacy, grouped, collapseGroupsByDefault, filterText, flaggedOnly]);

  async function handleApplyLabel(targetKey: string, label: 'flag' | 'do_not_flag' | 'resolved' | null) {
    if (!onApplyLabel || pendingLabels[targetKey]) return;
    setPendingLabels((prev) => ({ ...prev, [targetKey]: true }));
    try {
      await onApplyLabel(targetKey, label);
    } finally {
      setPendingLabels((prev) => {
        const next = { ...prev };
        delete next[targetKey];
        return next;
      });
    }
  }

  return (
    <div className="card report-shell">
      <div className="report-header">
        <div>
          <h2>{title}</h2>
          <div className="small muted">{description || 'Grouped by pharmacy, sortable, filterable, exportable, and expandable to row-level detail.'}</div>
          {onApplyLabel && <div className="small muted" style={{ marginTop: 6 }}>Use the Action taken dropdown on each row for faster labeling, or right-click any row to label it as do not flag, flag, or resolved.</div>}
        </div>
        <div className="report-actions">
          <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Filter this report" />
          <label className="checkbox-row"><input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only</label>
          <button className="secondary" onClick={() => exportRows(exportName, columns, sorted)}>Export CSV</button>
        </div>
      </div>

      {grouped.map((group) => {
        const summary = summarizeGroup(group.rows, columns);
        const groupOpen = groupByPharmacy ? Boolean(expandedGroups[group.key]) : true;
        return (
        <div key={group.key} className="group-card">
          {groupByPharmacy && (
            <div className="group-title" style={{ background: `${group.color}14`, borderColor: `${group.color}40`, color: group.color }}>
              <div>
                <div>{group.label}</div>
                <div className="small muted">{summary.totalRows} rows · {summary.flagged ? `${summary.flagged} flagged` : 'No flagged items'}{summary.manualLabels ? ` · ${summary.manualLabels} actioned` : ''}</div>
              </div>
              <button className="secondary group-toggle-button" onClick={() => setExpandedGroups((prev) => ({ ...prev, [group.key]: !groupOpen }))}>
                {groupOpen ? 'Hide claims' : 'Show claims'}
              </button>
            </div>
          )}
          {groupByPharmacy && (
            <div className="group-summary">
              {summary.highlights.length ? summary.highlights.join(' · ') : 'Summary ready'}
            </div>
          )}
          {groupOpen && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {allowDrilldown && <th style={{ width: 58 }}>Detail</th>}
                  {showLabelColumn && <th style={{ width: 168 }}>Action taken</th>}
                  {columns.map((column) => (
                    <th key={column.key} style={{ width: column.width }}>
                      <button className="sort-button" onClick={() => {
                        if (sortKey === column.key) setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc');
                        else { setSortKey(column.key); setSortDir('asc'); }
                      }}>
                        {column.label}{sortKey === column.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.rows.length ? group.rows.map((row) => {
                  const rowId = row.id || `${row.pharmacyCode || 'row'}-${Math.random()}`;
                  return (
                    <Fragment key={rowId}>
                      <tr className={row.flagged ? 'row-flagged' : ''} onContextMenu={(event) => {
                        if (!onApplyLabel) return;
                        event.preventDefault();
                        setMenu({ x: event.clientX, y: event.clientY, row });
                      }}>
                        {allowDrilldown && (
                          <td>
                            {renderDetails || row.details ? (
                              <button className="link-button" onClick={() => setExpanded((prev) => ({ ...prev, [rowId]: !prev[rowId] }))}>
                                {expanded[rowId] ? 'Hide' : 'View'}
                              </button>
                            ) : ''}
                          </td>
                        )}
                        {showLabelColumn && (
                          <td>
                            {onApplyLabel ? (
                              <select
                                disabled={Boolean(pendingLabels[row.id])}
                                value={row.manualLabel === 'Flag' ? 'flag' : row.manualLabel === 'Do not flag' ? 'do_not_flag' : row.manualLabel === 'Resolved' ? 'resolved' : ''}
                                onChange={(event) => handleApplyLabel(row.id, (event.target.value || null) as 'flag' | 'do_not_flag' | 'resolved' | null)}
                              >
                                <option value="">{pendingLabels[row.id] ? 'Saving…' : 'No action'}</option>
                                <option value="flag">Flag</option>
                                <option value="do_not_flag">Do not flag</option>
                                <option value="resolved">Resolved</option>
                              </select>
                            ) : row.manualLabel ? <span className="pill">{row.manualLabel}</span> : '—'}
                          </td>
                        )}
                        {columns.map((column) => (
                          <td key={`${rowId}-${column.key}`}>
                            <Cell value={cellValue(row, column)} type={column.type} />
                          </td>
                        ))}
                      </tr>
                      {allowDrilldown && expanded[rowId] && (
                        <tr className="detail-row">
                          <td colSpan={columns.length + 1 + (showLabelColumn ? 1 : 0)}>
                            {renderDetails ? renderDetails(row) : <DetailTable details={row.details} />}
                            {row.flagReason && <div className="small muted" style={{ marginTop: 10 }}>Flag reason: {row.flagReason}</div>}
                            {row.manualLabel && <div className="small muted" style={{ marginTop: 6 }}>Manual label: {row.manualLabel}</div>}
                            {row.actionItems?.length ? <div className="small muted" style={{ marginTop: 6 }}>Action items: {row.actionItems.join(' · ')}</div> : null}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                }) : <tr><td colSpan={columns.length + (allowDrilldown ? 1 : 0) + (showLabelColumn ? 1 : 0)}>No data yet</td></tr>}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )})}

      {menu && onApplyLabel && (
        <div className="context-menu" style={{ top: menu.y, left: menu.x }}>
          <button onClick={async () => { await handleApplyLabel(menu.row.id, 'flag'); setMenu(null); }}>Flag</button>
          <button onClick={async () => { await handleApplyLabel(menu.row.id, 'do_not_flag'); setMenu(null); }}>Do not flag</button>
          <button onClick={async () => { await handleApplyLabel(menu.row.id, 'resolved'); setMenu(null); }}>Resolved</button>
          <button onClick={async () => { await handleApplyLabel(menu.row.id, null); setMenu(null); }}>Clear label</button>
        </div>
      )}
    </div>
  );
}

function Cell({ value, type }: { value: any; type?: ColumnDef['type']; flagged?: boolean }) {
  if (type === 'currency' || type === 'percent' || type === 'number') return <span>{formatCell(value, type)}</span>;
  if (typeof value === 'string' && /high/i.test(value)) return <span className="pill bad">{value}</span>;
  if (typeof value === 'string' && /medium|negative gross profit|unexpected|review|incorrect|improper|reorder|replenish|return candidate|medicaid|below minimum|open coverage/i.test(value)) {
    return <span className="pill warn">{value}</span>;
  }
  if (typeof value === 'string' && /healthy|paid correctly|no payment expected|low|stable|at or above preferred|resolved/i.test(value)) {
    return <span className="pill good">{value}</span>;
  }
  if (typeof value === 'string' && /pending|monitor|volume driver|stretch|do not flag|flag/i.test(value)) {
    return <span className="pill">{value}</span>;
  }
  return <span>{formatCell(value, type)}</span>;
}

function DetailTable({ details }: { details?: { columns?: string[]; rows?: any[][] } }) {
  if (!details?.columns?.length) return <div className="small muted">No drilldown rows available.</div>;
  return (
    <div className="detail-wrap">
      <table>
        <thead>
          <tr>{details.columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {details.rows?.length ? details.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>) : <tr><td colSpan={details.columns.length}>No detail rows</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
