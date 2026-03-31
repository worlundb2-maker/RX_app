import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useEffect, useMemo, useState } from 'react';
const sections = ['Dashboard', 'Uploads', 'SDRA', 'Claims', 'Third Party', 'Inventory', 'NDC', '340B', 'Staffing', 'Users'];
const pharmacyOrder = ['KONAWA', 'MONTE_VISTA', 'ARLINGTON', 'SEMINOLE'];
const pharmacyColorMap = {
    KONAWA: '#eab308',
    MONTE_VISTA: '#2563eb',
    ARLINGTON: '#dc2626',
    SEMINOLE: '#16a34a',
};
const uploadTypeLabels = {
    pioneer: 'Pioneer claims',
    mtf: 'MTF payment file',
    mtf_adjustment: 'MTF adjustment file',
    inventory: 'On-hands inventory',
    price_rx: 'RX pricing',
    price_340b: '340B pricing',
};
const sectionColorMap = {
    Dashboard: '#132238',
    Uploads: '#334155',
    SDRA: '#7c2d12',
    Claims: '#0f766e',
    'Third Party': '#4338ca',
    Inventory: '#0f766e',
    NDC: '#14532d',
    '340B': '#991b1b',
    Staffing: '#1d4ed8',
    Users: '#475569',
};
export default function App() {
    const [bootstrap, setBootstrap] = useState(null);
    const [state, setState] = useState(null);
    const [section, setSection] = useState('Dashboard');
    const [user, setUser] = useState(null);
    const [selectedPharmacy, setSelectedPharmacy] = useState('ALL');
    const [message, setMessage] = useState('');
    const [uploadForm, setUploadForm] = useState({ type: 'pioneer', pharmacyCode: 'SEMINOLE' });
    const [uploadQueue, setUploadQueue] = useState([]);
    const [userForm, setUserForm] = useState({ username: '', password: '', displayName: '', role: 'viewer' });
    const [reportContext, setReportContext] = useState({});
    const isGlobalPriceUpload = uploadForm.type === 'price_rx' || uploadForm.type === 'price_340b';
    function isGlobalUpload(type) {
        return type === 'price_rx' || type === 'price_340b';
    }
    async function loadState(pharmacyCode = selectedPharmacy) {
        const query = pharmacyCode && pharmacyCode !== 'ALL' ? `?pharmacyCode=${pharmacyCode}` : '';
        const res = await fetch(`/api/state${query}`);
        setState(await res.json());
    }
    useEffect(() => {
        fetch('/api/bootstrap').then((r) => r.json()).then(setBootstrap);
        loadState('ALL');
    }, []);
    useEffect(() => {
        loadState(selectedPharmacy);
    }, [selectedPharmacy]);
    async function login(e) {
        e.preventDefault();
        const fd = new FormData(e.target);
        const res = await fetch('/api/login', { method: 'POST', body: new URLSearchParams(fd) });
        const data = await res.json();
        if (!res.ok)
            return setMessage(data.message || 'Login failed');
        setUser(data.user);
        setMessage('Logged in');
    }
    async function handleUpload(e) {
        e.preventDefault();
        const form = e.target;
        const fileInput = form.querySelector('input[type=file]');
        if (!fileInput.files?.length)
            return setMessage('Choose at least one file first');
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
        if (!uploadQueue.length)
            return setMessage('No queued files to upload');
        let successCount = 0;
        const notes = [];
        for (const item of uploadQueue) {
            const fd = new FormData();
            fd.append('file', item.file);
            fd.append('type', item.type);
            if (!isGlobalUpload(item.type))
                fd.append('pharmacyCode', item.pharmacyCode);
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            const data = await res.json();
            if (res.ok) {
                successCount += 1;
                notes.push(`${item.file.name}: ${data.rows}/${data.sourceRows}`);
            }
            else {
                notes.push(`${item.file.name}: ${data.message || 'Upload failed'}`);
            }
        }
        setUploadQueue([]);
        setMessage(`${successCount} of ${notes.length} queued files uploaded · ${notes.join(' | ')}`);
        loadState();
    }
    async function saveReviewDecision(targetKey, label) {
        const res = await fetch('/api/review-decision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetKey, label, pharmacyCode: selectedPharmacy }),
        });
        const data = await res.json();
        setMessage(res.ok ? (label ? `Saved label: ${label.replace(/_/g, ' ')}` : 'Cleared manual label') : data.message || 'Unable to save label');
        if (res.ok && data.state)
            setState(data.state);
    }
    async function clearDataset(dataset) {
        await fetch('/api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset }) });
        setMessage(`Cleared ${dataset}`);
        loadState();
    }
    async function scanInbox() {
        const res = await fetch('/api/inbox/scan', { method: 'POST' });
        const data = await res.json();
        if (!res.ok)
            return setMessage(data.message || 'Inbox scan failed');
        const note = `${data.importedCount || 0} imported`;
        const rejected = data.rejectedCount ? ` · ${data.rejectedCount} rejected` : '';
        setMessage(`Inbox scan complete: ${note}${rejected}`);
        loadState();
    }
    function updateQueuedFile(id, patch) {
        setUploadQueue((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
    }
    function removeQueuedFile(id) {
        setUploadQueue((prev) => prev.filter((item) => item.id !== id));
    }
    async function createUser(e) {
        e.preventDefault();
        const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userForm) });
        const data = await res.json();
        setMessage(res.ok ? 'User added' : data.message || 'User add failed');
        if (res.ok) {
            setUserForm({ username: '', password: '', displayName: '', role: 'viewer' });
            loadState();
        }
    }
    function openReport(targetSection, options) {
        setSection(targetSection);
        setReportContext({ section: targetSection, filterText: options?.filterText ?? '', flaggedOnly: options?.flaggedOnly ?? false });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    const visibleReportContext = reportContext.section === section ? reportContext : undefined;
    const topFindings = useMemo(() => {
        if (!state)
            return [];
        const finance = state.financeSummary || {};
        const staffingSummary = state.staffing?.summary || {};
        return [
            `${formatCell(finance.sdraCollectibleGap || 0, 'currency')} in RX SDRA collectible variance is sitting in queue.`,
            `${state.sdraSummary?.improper340BPayments || 0} 340B SDRA rows still show payment exposure.`,
            `${state.complianceSummary?.findings || 0} 340B compliance exceptions require review.`,
            `${formatCell(finance.weightedNdcSavings || 0, 'currency')} of weighted NDC savings is currently modeled.`,
            `${staffingSummary.pharmaciesWithPressure || 0} pharmacies show staffing pressure or temporary coverage.`
        ];
    }, [state]);
    const staffingRows = useMemo(() => {
        if (!state?.staffing?.byPharmacy)
            return [];
        return state.staffing.byPharmacy.flatMap((site) => site.roles.map((role) => ({
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
                rows: (role.names.length ? role.names : ['No named coverage']).map((name, index) => [name, index === 0 ? (role.notes?.join(' | ') || site.dashboardNote || '') : ''])
            }
        })));
    }, [state]);
    if (!bootstrap || !state)
        return _jsx("div", { className: "app", children: _jsx("div", { className: "loading-state", children: "Loading\u2026" }) });
    const pharmacyLookup = bootstrap.pharmacies.reduce((acc, pharmacy) => {
        acc[pharmacy.code] = pharmacy;
        return acc;
    }, {});
    const filteredFinanceByPharmacy = (state.financeSummary?.byPharmacy || []).filter((row) => row.claimCount > 0 || selectedPharmacy === row.pharmacyCode || selectedPharmacy === 'ALL');
    const sdraDashboardColumns = [
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
    const sdraColumns = [
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
    const claimsColumns = [
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
    const thirdPartyColumns = [
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
    const inventoryColumns = [
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
    const ndcColumns = [
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
    const complianceColumns = [
        { key: 'pharmacyName', label: 'Pharmacy' },
        { key: 'claim.rxNumber', label: 'Rx', render: (row) => row.claim.rxNumber },
        { key: 'claim.drugName', label: 'Drug', render: (row) => row.claim.drugName },
        { key: 'claim.inventoryGroup', label: 'Group', render: (row) => row.claim.inventoryGroup },
        { key: 'claim.primaryPayer', label: 'Payer', render: (row) => row.claim.primaryPayer },
        { key: 'claim.prescriberCategory', label: 'Prescriber Category', render: (row) => row.claim.prescriberCategory },
        { key: 'finding', label: 'Finding' },
        { key: 'severity', label: 'Severity' },
    ];
    const staffingColumns = [
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
    const uploadColumns = [
        { key: 'type', label: 'Type' },
        { key: 'pharmacyCode', label: 'Pharmacy', render: (row) => (row.type === 'price_rx' || row.type === 'price_340b') ? 'GLOBAL' : (pharmacyLookup[row.pharmacyCode || '']?.name || row.pharmacyCode || 'ALL') },
        { key: 'rows', label: 'Accepted', type: 'number' },
        { key: 'sourceRows', label: 'Source', type: 'number' },
        { key: 'rejectedRows', label: 'Rejected', type: 'number' },
        { key: 'sheetName', label: 'Sheet' },
        { key: 'uploadedAt', label: 'Uploaded At', render: (row) => new Date(row.uploadedAt).toLocaleString() },
        { key: 'originalName', label: 'File' },
    ];
    const userColumns = [
        { key: 'displayName', label: 'Display name' },
        { key: 'username', label: 'Username' },
        { key: 'role', label: 'Role' },
    ];
    const uploadCounts = countBy(state.uploads, (row) => row.type);
    const staffingSummary = state.staffing?.summary || {};
    return (_jsxs("div", { className: "app-shell", children: [_jsx("div", { className: "app-bg" }), _jsxs("div", { className: "app", children: [_jsxs("header", { className: "topbar card glass-card", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Foundation-aligned local build" }), _jsx("h1", { children: "Pharmacy Analytics" }), _jsx("div", { className: "subtitle", children: "Finance-forward pharmacy intelligence with row-level drilldown, manual clear controls, and store-level color identity across Konawa, Monte Vista, Arlington, and Seminole." })] }), _jsxs("div", { className: "header-actions", children: [_jsxs("select", { value: selectedPharmacy, onChange: (e) => setSelectedPharmacy(e.target.value), children: [_jsx("option", { value: "ALL", children: "All pharmacies" }), bootstrap.pharmacies.map((p) => _jsx("option", { value: p.code, children: p.name }, p.code))] }), _jsx("div", { className: "status-chip", children: user ? `${user.displayName} (${user.role})` : `Default login: ${bootstrap.defaultLogin.username}/${bootstrap.defaultLogin.password}` })] })] }), _jsx("div", { className: "tabs card", children: sections.map((s) => (_jsx("button", { className: `tab ${section === s ? 'active' : ''}`, style: section === s ? { borderColor: sectionColorMap[s], background: `${sectionColorMap[s]}14`, color: sectionColorMap[s] } : undefined, onClick: () => setSection(s), children: s }, s))) }), message && _jsx("div", { className: "message-banner card", children: message }), section === 'Dashboard' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "dashboard-hero card hero-card", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Executive overview" }), _jsx("h2", { children: "Financial control, compliance exposure, staffing pressure, and store action queues" }), _jsx("p", { children: "The dashboard is centered on modeled revenue, estimated acquisition, SDRA collectible gap, improper 340B payment exposure, inventory capital, and staffing capacity normalized to a 4.5-day operating week." })] }), _jsx("div", { className: "hero-points", children: topFindings.map((item) => _jsx("div", { className: "hero-point", children: item }, item)) })] }), _jsxs("div", { className: "grid executive-kpi-grid", children: [_jsx(ExecutiveKpi, { title: "Recorded revenue", value: state.financeSummary?.recordedRevenue, type: "currency", tone: "neutral", onClick: () => openReport('Claims') }), _jsx(ExecutiveKpi, { title: "Modeled acquisition", value: state.financeSummary?.modeledAcquisition, type: "currency", tone: "neutral", onClick: () => openReport('Claims') }), _jsx(ExecutiveKpi, { title: "Gross profit", value: state.financeSummary?.grossProfit, type: "currency", tone: (state.financeSummary?.grossProfit || 0) >= 0 ? 'good' : 'bad', onClick: () => openReport('Third Party') }), _jsx(ExecutiveKpi, { title: "Gross margin", value: state.financeSummary?.grossMargin, type: "percent", tone: (state.financeSummary?.grossMargin || 0) >= 0 ? 'good' : 'bad', onClick: () => openReport('Third Party') }), _jsx(ExecutiveKpi, { title: "SDRA collectible gap", value: state.financeSummary?.sdraCollectibleGap, type: "currency", tone: (state.financeSummary?.sdraCollectibleGap || 0) > 0 ? 'warn' : 'good', onClick: () => openReport('SDRA', { flaggedOnly: true }) }), _jsx(ExecutiveKpi, { title: "340B payment exposure", value: state.financeSummary?.improper340BExposure, type: "currency", tone: (state.financeSummary?.improper340BExposure || 0) > 0 ? 'bad' : 'good', onClick: () => openReport('340B', { flaggedOnly: true }) }), _jsx(ExecutiveKpi, { title: "Weighted NDC savings", value: state.financeSummary?.weightedNdcSavings, type: "currency", tone: (state.financeSummary?.weightedNdcSavings || 0) > 0 ? 'good' : 'neutral', onClick: () => openReport('NDC', { flaggedOnly: true }) }), _jsx(ExecutiveKpi, { title: "Inventory value", value: state.financeSummary?.totalInventoryValue, type: "currency", tone: "neutral", onClick: () => openReport('Inventory') })] }), _jsxs("div", { className: "grid two-col", style: { marginTop: 18 }, children: [_jsxs("div", { className: "card section-card", children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Immediate work queue" }), _jsx("h3", { children: "Actionable exceptions" })] }) }), _jsxs("div", { className: "action-grid", children: [_jsx(ActionQueueCard, { title: "SDRA unpaid / incorrect RX", value: state.sdraSummary?.unpaidRx + state.sdraSummary?.incorrectRx, hint: formatCell(state.financeSummary?.sdraCollectibleGap || 0, 'currency'), tone: "warn", onClick: () => openReport('SDRA', { flaggedOnly: true }) }), _jsx(ActionQueueCard, { title: "Improper 340B SDRA payments", value: state.sdraSummary?.improper340BPayments, hint: formatCell(state.financeSummary?.improper340BExposure || 0, 'currency'), tone: "bad", onClick: () => openReport('SDRA', { filterText: '340B', flaggedOnly: true }) }), _jsx(ActionQueueCard, { title: "Claims margin opportunities", value: state.claimsSummary?.flaggedClaims, hint: "Open negative margin / audit patterns", tone: "warn", onClick: () => openReport('Claims', { flaggedOnly: true }) }), _jsx(ActionQueueCard, { title: "Payer groups under pressure", value: state.thirdParty.filter((row) => row.flagged).length, hint: "Open low or negative gross profit payers", tone: "warn", onClick: () => openReport('Third Party', { flaggedOnly: true }) }), _jsx(ActionQueueCard, { title: "Inventory action items", value: (state.inventorySummary?.returnCandidates || 0) + (state.inventorySummary?.reorderRx || 0) + (state.inventorySummary?.replenish340B || 0), hint: "Return, reorder, and replenish queue", tone: "warn", onClick: () => openReport('Inventory', { flaggedOnly: true }) }), _jsx(ActionQueueCard, { title: "340B compliance exceptions", value: state.complianceSummary?.findings, hint: "Prescriber, Medicaid, and referral verification", tone: "bad", onClick: () => openReport('340B', { flaggedOnly: true }) }), _jsx(ActionQueueCard, { title: "Staffing pressure pharmacies", value: staffingSummary.pharmaciesWithPressure, hint: `${formatCell(staffingSummary.totalOpenFte || 0, 'number')} open or exposed FTE`, tone: staffingSummary.pharmaciesWithPressure ? 'warn' : 'good', onClick: () => openReport('Staffing', { flaggedOnly: true }) }), _jsx(ActionQueueCard, { title: "Upload integrity", value: state.uploads.length, hint: "Manual clear remains available on every dataset", tone: "neutral", onClick: () => openReport('Uploads') })] })] }), !user ? (_jsxs("div", { className: "card section-card", children: [_jsx("div", { className: "eyebrow", children: "Authentication" }), _jsx("h3", { children: "Log in" }), _jsxs("form", { onSubmit: login, className: "form-grid", style: { marginTop: 14 }, children: [_jsx("input", { name: "username", placeholder: "Username", defaultValue: "admin" }), _jsx("input", { name: "password", type: "password", placeholder: "Password", defaultValue: "admin" }), _jsx("button", { className: "primary", type: "submit", children: "Log in" })] })] })) : (_jsxs("div", { className: "card section-card", children: [_jsx("div", { className: "eyebrow", children: "Staffing operating note" }), _jsx("h3", { children: "4.5-day productivity normalization" }), _jsx("p", { children: "Monday through Thursday count as 1.0 operating day and Friday counts as 0.5. RX/day is calculated from total observed claims divided by those weighted operating days, and staffing pressure is derived from that RX/day rate." }), _jsxs("div", { className: "micro-metrics", children: [_jsx(MiniMetric, { label: "Weighted operating days in data", value: staffingSummary.totalWeightedOperatingDays }), _jsx(MiniMetric, { label: "RX / day", value: staffingSummary.overallAvgRxPerWeightedDay }), _jsx(MiniMetric, { label: "Open / exposed FTE", value: staffingSummary.totalOpenFte })] })] }))] }), _jsx("div", { className: "grid pharmacy-card-grid", style: { marginTop: 18 }, children: filteredFinanceByPharmacy.map((item) => (_jsx(PharmacyFinanceCard, { item: item, staffing: state.staffing?.byPharmacy?.find((site) => site.pharmacyCode === item.pharmacyCode), onClickSdra: () => openReport('SDRA', { flaggedOnly: true, filterText: item.pharmacyName }), onClickStaffing: () => openReport('Staffing', { filterText: item.pharmacyName, flaggedOnly: true }) }, item.pharmacyCode))) }), _jsxs(_Fragment, { children: [_jsx("div", { style: { marginTop: 18 }, children: _jsx(SectionOverview, { title: "SDRA overview", subtitle: "Quick totals for what should have been paid, what was paid in error, and what was correctly paid or correctly left unpaid.", color: sectionColorMap.SDRA, metrics: [{ label: "Should have been paid and was paid", value: state.sdraSummary?.shouldHaveBeenPaidAndWasPaid || 0, type: "currency", tone: "good" }, { label: "Should not have been paid and was paid", value: state.sdraSummary?.shouldNotHaveBeenPaidAndWasPaid || 0, type: "currency", tone: "bad", onClick: () => openReport('SDRA', { filterText: '340B', flaggedOnly: true }) }, { label: "Correctly paid", value: state.sdraSummary?.correctlyPaidAmount || 0, type: "currency", tone: "good" }, { label: "Correctly not paid", value: state.sdraSummary?.correctlyNotPaidAmount || 0, type: "currency", tone: "good" }, { label: "Should have been paid but missing", value: state.sdraSummary?.shouldHaveBeenPaidButMissing || 0, type: "currency", tone: "warn" }, { label: "Improper 340B exposure", value: state.sdraSummary?.shouldNotHaveBeenPaidExposure || 0, type: "currency", tone: "bad" }], actions: [] }) }), _jsx("div", { style: { marginTop: 18 }, children: _jsx(ReportTable, { title: "SDRA totals by pharmacy", description: "Drill from store-level SDRA performance into exact claims driving collectible gap, unexpected payments, and improper 340B payment exposure.", rows: state.sdraDashboardByPharmacy, columns: sdraDashboardColumns, exportName: "sdra_dashboard", onApplyLabel: saveReviewDecision, renderDetails: (row) => _jsx(DetailTable, { details: row.details }), externalFilterText: visibleReportContext?.section === 'Dashboard' ? visibleReportContext?.filterText : '', externalFlaggedOnly: visibleReportContext?.section === 'Dashboard' ? visibleReportContext?.flaggedOnly : false }) })] })] })), section === 'Uploads' && (_jsxs(_Fragment, { children: [_jsx(SectionOverview, { title: "Uploads control center", subtitle: "Every dataset is locally stored, manually clearable, and isolated to its intended analytic purpose so reconciliation logic stays clean.", color: sectionColorMap.Uploads, metrics: [
                                    { label: 'Upload records', value: state.uploads.length, type: 'number' },
                                    { label: 'Pioneer files', value: uploadCounts.pioneer || 0, type: 'number' },
                                    { label: 'MTF files', value: (uploadCounts.mtf || 0) + (uploadCounts.mtf_adjustment || 0), type: 'number' },
                                    { label: 'Inventory files', value: uploadCounts.inventory || 0, type: 'number' },
                                    { label: 'Global price files', value: (uploadCounts.price_rx || 0) + (uploadCounts.price_340b || 0), type: 'number' },
                                ], actions: [
                                    { label: 'Clear MTF', onClick: () => clearDataset('mtf'), kind: 'secondary' },
                                    { label: 'Clear adjustments', onClick: () => clearDataset('mtf_adjustment'), kind: 'secondary' },
                                    { label: 'Clear all', onClick: () => clearDataset('all'), kind: 'primary' },
                                ] }), _jsxs("div", { className: "grid two-col", children: [_jsxs("div", { className: "card section-card", children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Upload data" }), _jsx("h3", { children: "Queue and ingest source files" })] }) }), _jsx("p", { className: "section-copy", children: "Select one or many files at once, then manually assign the correct file type and pharmacy to each queued file before uploading them together. For faster local intake, the app also supports an SFTP-compatible inbox folder scan." }), _jsx("form", { onSubmit: handleUpload, style: { marginTop: 16 }, children: _jsxs("div", { className: "form-grid", children: [_jsxs("select", { value: uploadForm.type, onChange: (e) => setUploadForm({ ...uploadForm, type: e.target.value }), children: [_jsx("option", { value: "pioneer", children: "Pioneer claims" }), _jsx("option", { value: "mtf", children: "MTF payment file" }), _jsx("option", { value: "mtf_adjustment", children: "MTF adjustment file" }), _jsx("option", { value: "inventory", children: "On-hands inventory" }), _jsx("option", { value: "price_rx", children: "RX pricing" }), _jsx("option", { value: "price_340b", children: "340B pricing" })] }), isGlobalPriceUpload ? (_jsx("div", { className: "global-upload", children: "Applies to all stores" })) : (_jsx("select", { value: uploadForm.pharmacyCode, onChange: (e) => setUploadForm({ ...uploadForm, pharmacyCode: e.target.value }), children: bootstrap.pharmacies.map((p) => _jsx("option", { value: p.code, children: p.name }, p.code)) })), _jsx("input", { type: "file", accept: ".xlsx,.xls,.csv", multiple: true }), _jsx("button", { className: "primary", type: "submit", children: "Add to queue" })] }) }), _jsxs("div", { className: "queue-toolbar", children: [_jsxs("div", { className: "small muted", children: [uploadQueue.length, " file", uploadQueue.length === 1 ? '' : 's', " queued"] }), _jsxs("div", { className: "row", children: [_jsx("button", { className: "secondary", type: "button", onClick: () => setUploadQueue([]), children: "Clear queue" }), _jsx("button", { className: "primary", type: "button", onClick: uploadQueuedFiles, children: "Upload queued files" })] })] }), _jsx("div", { className: "queue-table-wrap", children: _jsxs("table", { className: "queue-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "File" }), _jsx("th", { children: "Type" }), _jsx("th", { children: "Pharmacy" }), _jsx("th", {})] }) }), _jsx("tbody", { children: uploadQueue.length ? uploadQueue.map((item) => (_jsxs("tr", { children: [_jsx("td", { children: item.file.name }), _jsx("td", { children: _jsx("select", { value: item.type, onChange: (e) => updateQueuedFile(item.id, { type: e.target.value }), children: Object.entries(uploadTypeLabels).map(([value, label]) => _jsx("option", { value: value, children: label }, value)) }) }), _jsx("td", { children: isGlobalUpload(item.type) ? (_jsx("div", { className: "global-upload compact", children: "Global" })) : (_jsx("select", { value: item.pharmacyCode, onChange: (e) => updateQueuedFile(item.id, { pharmacyCode: e.target.value }), children: bootstrap.pharmacies.map((pharmacy) => _jsx("option", { value: pharmacy.code, children: pharmacy.name }, pharmacy.code)) })) }), _jsx("td", { children: _jsx("button", { className: "secondary", type: "button", onClick: () => removeQueuedFile(item.id), children: "Remove" }) })] }, item.id))) : _jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No files queued yet" }) }) })] }) }), _jsx("div", { className: "clear-grid", children: ['pioneer', 'mtf', 'mtf_adjustment', 'inventory', 'price_rx', 'price_340b', 'all'].map((d) => (_jsx("button", { className: "secondary", onClick: () => clearDataset(d), children: d === 'all' ? 'Clear everything' : `Clear ${uploadTypeLabels[d] || d}` }, d))) })] }), _jsxs("div", { className: "card section-card", children: [_jsx("div", { className: "eyebrow", children: "SFTP-compatible inbox" }), _jsx("h3", { children: "Scan a local drop folder" }), _jsx("p", { className: "section-copy", children: "Any SFTP client or manual file copy can drop files into the inbox folder below. The scanner accepts the current operational naming style such as SEMINOLE_pioneer_claims..., MV_mtf_payments..., and the older double-underscore format. Click scan to import them into the normal local workflow without replacing manual upload." }), _jsxs("div", { className: "support-list", children: [_jsxs("div", { children: [_jsx("strong", { children: "Inbox folder:" }), " ", bootstrap.inbox?.folder || 'ingest_inbox'] }), _jsxs("div", { children: [_jsx("strong", { children: "Examples:" }), " ", (bootstrap.inbox?.examples || []).join(' · ') || 'SEMINOLE_pioneer_claims.xlsx'] })] }), _jsx("div", { className: "row", style: { marginTop: 14 }, children: _jsx("button", { className: "primary", type: "button", onClick: scanInbox, children: "Scan inbox now" }) })] }), _jsxs("div", { className: "card section-card", children: [_jsx("div", { className: "eyebrow", children: "Guardrails" }), _jsx("h3", { children: "Data separation rules" }), _jsxs("ul", { className: "plain-list", children: [_jsx("li", { children: "Pioneer claims drive analytics and reconciliation matching." }), _jsx("li", { children: "MTF and MTF adjustments change SDRA status only." }), _jsx("li", { children: "The inbox scan uses the same file-type and pharmacy validation rules as manual upload." }), _jsx("li", { children: "On-hand files drive inventory valuation and stock status." }), _jsx("li", { children: "Global RX and 340B price files drive NDC and margin modeling." }), _jsx("li", { children: "Pioneer claims plus MTF payments and adjustments build a running history; inventory and price files overwrite their prior dataset by design, and every dataset remains manually clearable." })] })] })] }), _jsx("div", { style: { marginTop: 18 }, children: _jsx(ReportTable, { title: "Upload history", description: "Track what is currently loaded and clear only the dataset you want to reset.", rows: state.uploads, columns: uploadColumns, exportName: "upload_history", groupByPharmacy: false, externalFilterText: visibleReportContext?.filterText, externalFlaggedOnly: visibleReportContext?.flaggedOnly }) })] })), section === 'SDRA' && (_jsxs(_Fragment, { children: [_jsx(SectionOverview, { title: "SDRA reconciliation", subtitle: "Monitor RX collectible gap, improper 340B payment exposure, pending items, and unexpected payment rows from MTF plus adjustment uploads.", color: sectionColorMap.SDRA, metrics: [
                                    { label: 'Should have been paid and was paid', value: state.sdraSummary?.shouldHaveBeenPaidAndWasPaid || 0, type: 'currency', tone: 'good' },
                                    { label: 'Should not have been paid and was paid', value: state.sdraSummary?.shouldNotHaveBeenPaidAndWasPaid || 0, type: 'currency', tone: 'bad', onClick: () => setReportContext({ section: 'SDRA', filterText: '340B', flaggedOnly: true }) },
                                    { label: 'Correctly paid', value: state.sdraSummary?.correctlyPaidAmount || 0, type: 'currency', tone: 'good' },
                                    { label: 'Correctly not paid', value: state.sdraSummary?.correctlyNotPaidAmount || 0, type: 'currency', tone: 'good' },
                                    { label: 'Should have been paid but missing', value: state.sdraSummary?.shouldHaveBeenPaidButMissing || 0, type: 'currency', tone: 'warn', onClick: () => setReportContext({ section: 'SDRA', filterText: 'RX not paid and should have been', flaggedOnly: false }) },
                                    { label: 'Improper 340B exposure', value: state.sdraSummary?.shouldNotHaveBeenPaidExposure || 0, type: 'currency', tone: 'bad', onClick: () => setReportContext({ section: 'SDRA', filterText: '340B', flaggedOnly: true }) },
                                ], actions: [
                                    { label: 'Flagged SDRA rows', onClick: () => setReportContext({ section: 'SDRA', flaggedOnly: true }), kind: 'primary' },
                                    { label: 'Only 340B issues', onClick: () => setReportContext({ section: 'SDRA', filterText: '340B', flaggedOnly: true }), kind: 'secondary' },
                                    { label: 'Only pending', onClick: () => setReportContext({ section: 'SDRA', filterText: 'Pending', flaggedOnly: false }), kind: 'secondary' },
                                ] }), _jsx(ReportTable, { title: "SDRA reconciliation", description: "Grouped by pharmacy, with claim-level drilldown into matched MTF rows, payment source, and variance.", rows: state.sdraResults, columns: sdraColumns, exportName: "sdra_reconciliation", onApplyLabel: saveReviewDecision, renderDetails: (row) => _jsx(DetailTable, { details: row.details }), externalFilterText: visibleReportContext?.filterText, externalFlaggedOnly: visibleReportContext?.flaggedOnly })] })), section === 'Claims' && (_jsxs(_Fragment, { children: [_jsx(SectionOverview, { title: "Claims analysis", subtitle: "Focus on recurring negative margin, atypical day-supply patterns, recurring brand cash claims, and concentrated payer exposure rather than flagging every low-value anomaly.", color: sectionColorMap.Claims, metrics: [
                                    { label: 'Claim groups', value: state.claimsSummary?.totalRows || 0, type: 'number' },
                                    { label: 'Flagged groups', value: state.claimsSummary?.flaggedClaims || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: 'Claims', flaggedOnly: true }) },
                                    { label: 'Price-modeled claims', value: state.claimsSummary?.priceModeledClaims || 0, type: 'number' },
                                    { label: 'Cash claims', value: state.claimsSummary?.cashClaims || 0, type: 'number', onClick: () => setReportContext({ section: 'Claims', filterText: 'cash', flaggedOnly: false }) },
                                    { label: 'Inactive excluded', value: state.claimsSummary?.inactiveExcludedClaims || 0, type: 'number', tone: 'neutral' },
                                    { label: 'Gross profit', value: state.financeSummary?.grossProfit || 0, type: 'currency', tone: (state.financeSummary?.grossProfit || 0) >= 0 ? 'good' : 'bad' },
                                ], actions: [
                                    { label: 'Flagged groups', onClick: () => setReportContext({ section: 'Claims', flaggedOnly: true }), kind: 'primary' },
                                    { label: 'Negative margin', onClick: () => setReportContext({ section: 'Claims', filterText: 'Material negative gross profit', flaggedOnly: false }), kind: 'secondary' },
                                    { label: 'Brand cash', onClick: () => setReportContext({ section: 'Claims', filterText: 'Recurring brand cash claims', flaggedOnly: false }), kind: 'secondary' },
                                ] }), _jsx(ReportTable, { title: "Claims analysis", description: "Opportunities are grouped by pharmacy + NDC + inventory group and always drill to the exact claim rows driving the signal.", rows: state.claimsAnalysis, columns: claimsColumns, exportName: "claims_analysis", onApplyLabel: saveReviewDecision, renderDetails: (row) => _jsx(DetailTable, { details: row.details }), externalFilterText: visibleReportContext?.filterText, externalFlaggedOnly: visibleReportContext?.flaggedOnly })] })), section === 'Third Party' && (_jsxs(_Fragment, { children: [_jsx(SectionOverview, { title: "Third-party performance", subtitle: "Monitor payer groups by pharmacy for negative or low gross profit, mix, and 340B utilization so contracting and pricing decisions are focused where they matter.", color: sectionColorMap['Third Party'], metrics: [
                                    { label: 'Payer groups', value: state.thirdPartySummary?.groups || 0, type: 'number' },
                                    { label: 'Claims in scope', value: state.thirdPartySummary?.totalClaims || 0, type: 'number' },
                                    { label: 'Med D claims', value: state.thirdPartySummary?.medDClaims || 0, type: 'number', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Med D', flaggedOnly: false }) },
                                    { label: 'Medicaid claims', value: state.thirdPartySummary?.medicaidClaims || 0, type: 'number', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Medicaid', flaggedOnly: false }) },
                                    { label: 'RX CASH claims', value: state.thirdPartySummary?.rxCashClaims || 0, type: 'number', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Cash', flaggedOnly: false }) },
                                    { label: 'High GP groups', value: state.thirdPartySummary?.highGrossProfitGroups || 0, type: 'number', tone: 'good', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Healthy', flaggedOnly: false }) },
                                    { label: 'Lowest GP / RX', value: state.thirdPartySummary?.lowestGrossProfitPerRx || 0, type: 'currency', tone: 'bad', onClick: () => setReportContext({ section: 'Third Party', flaggedOnly: true }) },
                                ], actions: [
                                    { label: 'Flagged payers', onClick: () => setReportContext({ section: 'Third Party', flaggedOnly: true }), kind: 'primary' },
                                    { label: 'Negative GP', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Negative gross profit', flaggedOnly: false }), kind: 'secondary' },
                                    { label: 'Low GP', onClick: () => setReportContext({ section: 'Third Party', filterText: 'Low gross profit', flaggedOnly: false }), kind: 'secondary' },
                                ] }), _jsx(ReportTable, { title: "Third-party analysis", description: "Grouped by payer within each pharmacy, with row-level drilldown to the claims contributing to payer performance.", rows: state.thirdParty, columns: thirdPartyColumns, exportName: "third_party_analysis", onApplyLabel: saveReviewDecision, renderDetails: (row) => _jsx(DetailTable, { details: row.details }), externalFilterText: visibleReportContext?.filterText, externalFlaggedOnly: visibleReportContext?.flaggedOnly })] })), section === 'Inventory' && (_jsxs(_Fragment, { children: [_jsx(SectionOverview, { title: "Inventory management", subtitle: "Separate RX reorder logic from 340B replenishment, keep stores separate, and surface return candidates, understock, and overstock using days-on-hand rules.", color: sectionColorMap.Inventory, metrics: [
                                    { label: 'Tracked NDCs', value: state.inventorySummary?.ndcs || 0, type: 'number' },
                                    { label: 'Return candidates', value: state.inventorySummary?.returnCandidates || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Return candidate', flaggedOnly: false }) },
                                    { label: 'RX reorder', value: state.inventorySummary?.reorderRx || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Reorder RX', flaggedOnly: false }) },
                                    { label: '340B replenish', value: state.inventorySummary?.replenish340B || 0, type: 'number', tone: 'bad', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Replenish 340B', flaggedOnly: false }) },
                                    { label: 'Inventory value', value: state.financeSummary?.totalInventoryValue || 0, type: 'currency' },
                                ], actions: [
                                    { label: 'Flagged items', onClick: () => setReportContext({ section: 'Inventory', flaggedOnly: true }), kind: 'primary' },
                                    { label: 'Return queue', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Return candidate', flaggedOnly: false }), kind: 'secondary' },
                                    { label: 'Replenish 340B', onClick: () => setReportContext({ section: 'Inventory', filterText: 'Replenish 340B', flaggedOnly: false }), kind: 'secondary' },
                                ] }), _jsx(ReportTable, { title: "Inventory management", description: "Inventory drilldown stays at pharmacy level so transfer-before-return decisions remain actionable and store-specific.", rows: state.inventoryManagement, columns: inventoryColumns, exportName: "inventory_management", onApplyLabel: saveReviewDecision, renderDetails: (row) => _jsx(DetailTable, { details: row.details }), externalFilterText: visibleReportContext?.filterText, externalFlaggedOnly: visibleReportContext?.flaggedOnly })] })), section === 'NDC' && (_jsxs(_Fragment, { children: [_jsx(SectionOverview, { title: "NDC optimization", subtitle: "Use global RX and 340B price files plus Pioneer claim mix to compare dispensed NDCs only against equivalent drugs, prioritizing GCN when available and requiring matched strength before savings are suggested.", color: sectionColorMap.NDC, metrics: [
                                    { label: 'Optimization rows', value: state.ndcSummary?.rows || 0, type: 'number' },
                                    { label: 'Same-group opportunities', value: state.ndcSummary?.sameGroupOpportunities || 0, type: 'number', tone: 'good' },
                                    { label: 'Weighted opportunities', value: state.ndcSummary?.weightedOpportunities || 0, type: 'number', tone: 'good' },
                                    { label: 'Same-group savings', value: state.ndcSummary?.totalSameGroupSavings || 0, type: 'currency', tone: 'good' },
                                    { label: 'Weighted savings', value: state.ndcSummary?.totalWeightedSavings || 0, type: 'currency', tone: 'good' },
                                ], actions: [
                                    { label: 'Flagged rows', onClick: () => setReportContext({ section: 'NDC', flaggedOnly: true }), kind: 'primary' },
                                    { label: 'Weighted cheaper equivalent', onClick: () => setReportContext({ section: 'NDC', filterText: 'Equivalent weighted lower-cost NDC available', flaggedOnly: false }), kind: 'secondary' },
                                    { label: 'Same-group cheaper equivalent', onClick: () => setReportContext({ section: 'NDC', filterText: 'Equivalent lower-cost NDC available in same inventory group', flaggedOnly: false }), kind: 'secondary' },
                                ] }), _jsx(ReportTable, { title: "NDC optimization", description: "Every NDC opportunity remains drillable to candidate cost comparisons and store-specific claim utilization.", rows: state.ndcOptimization, columns: ndcColumns, exportName: "ndc_optimization", onApplyLabel: saveReviewDecision, renderDetails: (row) => _jsx(DetailTable, { details: row.details }), externalFilterText: visibleReportContext?.filterText, externalFlaggedOnly: visibleReportContext?.flaggedOnly })] })), section === '340B' && (_jsxs(_Fragment, { children: [_jsx(SectionOverview, { title: "340B compliance", subtitle: "Prioritize Medicaid on 340B, non-eligible prescribers on 340B inventory, and referral-note verification, while preserving the diabetic-supply exception and not auto-flagging Medicaid RX claims tied to 340B prescribers.", color: sectionColorMap['340B'], metrics: [
                                    { label: 'Findings', value: state.complianceSummary?.findings || 0, type: 'number', tone: 'bad', onClick: () => setReportContext({ section: '340B', flaggedOnly: false }) },
                                    { label: 'High severity', value: state.complianceSummary?.high || 0, type: 'number', tone: 'bad', onClick: () => setReportContext({ section: '340B', filterText: 'high', flaggedOnly: true }) },
                                    { label: 'Medium severity', value: state.complianceSummary?.medium || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: '340B', filterText: 'medium', flaggedOnly: true }) },
                                    { label: 'Referral checks', value: state.complianceSummary?.referralChecks || 0, type: 'number', tone: 'warn', onClick: () => setReportContext({ section: '340B', filterText: 'referral verification queue', flaggedOnly: false }) },
                                ], actions: [
                                    { label: 'Flagged rows', onClick: () => setReportContext({ section: '340B', flaggedOnly: true }), kind: 'primary' },
                                    { label: 'Medicaid on 340B', onClick: () => setReportContext({ section: '340B', filterText: 'Medicaid plan dispensed from 340B inventory', flaggedOnly: false }), kind: 'secondary' },
                                    { label: 'Referral verification', onClick: () => setReportContext({ section: '340B', filterText: 'referral', flaggedOnly: false }), kind: 'secondary' },
                                ] }), _jsx(ReportTable, { title: "340B compliance", description: "Compliance findings drill directly to the underlying claim so corrective action can be assigned immediately.", rows: state.compliance, columns: complianceColumns, exportName: "340b_compliance", onApplyLabel: saveReviewDecision, renderDetails: (row) => _jsx(DetailTable, { details: row.details }), externalFilterText: visibleReportContext?.filterText, externalFlaggedOnly: visibleReportContext?.flaggedOnly })] })), section === 'Staffing' && (_jsxs(_Fragment, { children: [_jsx(SectionOverview, { title: "Staffing profile and workload capacity", subtitle: "Use the provided staffing profile, shared-seat rules, and a 4.5-day operating week to compare current coverage against observed RX/day demand and role-specific capacity ranges.", color: sectionColorMap.Staffing, metrics: [
                                    { label: 'Observed RX', value: staffingSummary.totalObservedRx || 0, type: 'number' },
                                    { label: 'RX / day', value: staffingSummary.overallAvgRxPerWeightedDay || 0, type: 'number' },
                                    { label: 'Allocated FTE', value: staffingSummary.totalAllocatedFte || 0, type: 'number' },
                                    { label: 'Covered FTE', value: staffingSummary.totalFilledFte || 0, type: 'number' },
                                    { label: 'Open / exposed FTE', value: staffingSummary.totalOpenFte || 0, type: 'number', tone: (staffingSummary.totalOpenFte || 0) > 0 ? 'warn' : 'good' },
                                    { label: 'Pressure pharmacies', value: staffingSummary.pharmaciesWithPressure || 0, type: 'number', tone: (staffingSummary.pharmaciesWithPressure || 0) > 0 ? 'warn' : 'good' },
                                ], actions: [
                                    { label: 'Only pressure roles', onClick: () => setReportContext({ section: 'Staffing', flaggedOnly: true }), kind: 'primary' },
                                    { label: 'Temporary coverage', onClick: () => setReportContext({ section: 'Staffing', filterText: 'temporary', flaggedOnly: false }), kind: 'secondary' },
                                    { label: 'Open coverage', onClick: () => setReportContext({ section: 'Staffing', filterText: 'Open coverage needed', flaggedOnly: false }), kind: 'secondary' },
                                ] }), _jsxs("div", { className: "grid two-col", children: [_jsxs("div", { className: "card section-card", children: [_jsx("div", { className: "eyebrow", children: "Admin support" }), _jsx("h3", { children: "Central support roster" }), _jsxs("div", { className: "support-list", children: [_jsxs("div", { children: [_jsx("strong", { children: "Pharmacist support:" }), " ", state.staffing?.summary?.adminSupport?.pharmacistSupport?.join(', ') || '—'] }), _jsxs("div", { children: [_jsx("strong", { children: "Billing support:" }), " ", state.staffing?.summary?.adminSupport?.billingSupport?.join(', ') || '—'] })] })] }), _jsxs("div", { className: "card section-card", children: [_jsx("div", { className: "eyebrow", children: "Role capacity rules" }), _jsx("h3", { children: "Allocated position framework" }), _jsxs("ul", { className: "plain-list compact", children: [_jsx("li", { children: "RPH: 150\u2013200 RX per weighted day" }), _jsx("li", { children: "Tech: 100\u2013150 RX per weighted day" }), _jsx("li", { children: "Clerk: 200\u2013300 RX per weighted day" }), _jsx("li", { children: "Arlington and Monte Vista share 0.5 driver support each" }), _jsx("li", { children: "Seminole carries 0.5 driver / billing specialist support" })] })] })] }), _jsx("div", { style: { marginTop: 18 }, children: _jsx(ReportTable, { title: "Staffing by pharmacy and role", description: "Allocated positions, named coverage, temporary seats, transitional changes, and capacity pressure are all normalized to uploaded RX/day.", rows: staffingRows, columns: staffingColumns, exportName: "staffing_profile", onApplyLabel: saveReviewDecision, renderDetails: (row) => _jsx(DetailTable, { details: row.details }), externalFilterText: visibleReportContext?.filterText, externalFlaggedOnly: visibleReportContext?.flaggedOnly }) })] })), section === 'Users' && (_jsxs(_Fragment, { children: [_jsx(SectionOverview, { title: "User management", subtitle: "Maintain local user accounts and roles so analysts, viewers, and administrators see the same single-source local application.", color: sectionColorMap.Users, metrics: [
                                    { label: 'User accounts', value: state.users.length, type: 'number' },
                                    { label: 'Admins', value: state.users.filter((row) => row.role === 'admin').length, type: 'number' },
                                    { label: 'Analysts', value: state.users.filter((row) => row.role === 'analyst').length, type: 'number' },
                                    { label: 'Viewers', value: state.users.filter((row) => row.role === 'viewer').length, type: 'number' },
                                ], actions: [] }), _jsxs("div", { className: "grid two-col", children: [_jsxs("div", { className: "card section-card", children: [_jsx("div", { className: "eyebrow", children: "Add user" }), _jsx("h3", { children: "Create local user" }), _jsxs("form", { onSubmit: createUser, className: "form-grid", style: { marginTop: 12 }, children: [_jsx("input", { placeholder: "Display name", value: userForm.displayName, onChange: (e) => setUserForm({ ...userForm, displayName: e.target.value }) }), _jsx("input", { placeholder: "Username", value: userForm.username, onChange: (e) => setUserForm({ ...userForm, username: e.target.value }) }), _jsx("input", { placeholder: "Password", value: userForm.password, onChange: (e) => setUserForm({ ...userForm, password: e.target.value }) }), _jsxs("select", { value: userForm.role, onChange: (e) => setUserForm({ ...userForm, role: e.target.value }), children: [_jsx("option", { value: "viewer", children: "viewer" }), _jsx("option", { value: "analyst", children: "analyst" }), _jsx("option", { value: "admin", children: "admin" })] }), _jsx("button", { className: "primary", type: "submit", children: "Add user" })] })] }), _jsx(ReportTable, { title: "Current users", description: "Local users stay inside the app_data database and can be refreshed or backed up with the rest of the application data.", rows: state.users, columns: userColumns, exportName: "users", groupByPharmacy: false, allowDrilldown: false })] })] }))] })] }));
}
function ExecutiveKpi({ title, value, type, tone = 'neutral', onClick }) {
    const renderedValue = formatCell(value, type);
    const fitClass = renderedValue.length > 18 ? 'fit-xxs' : renderedValue.length > 15 ? 'fit-xs' : renderedValue.length > 12 ? 'fit-sm' : '';
    const content = (_jsxs(_Fragment, { children: [_jsx("div", { className: "small-label", children: title }), _jsx("div", { className: `executive-value ${fitClass}`, children: renderedValue })] }));
    return onClick ? (_jsx("button", { className: `card executive-kpi tone-${tone} clickable-card`, onClick: onClick, children: content })) : (_jsx("div", { className: `card executive-kpi tone-${tone}`, children: content }));
}
function MiniMetric({ label, value }) {
    return (_jsxs("div", { className: "mini-metric", children: [_jsx("div", { className: "small-label", children: label }), _jsx("div", { className: "mini-value", children: formatCell(value, typeof value === 'number' && String(value).includes('.') ? 'number' : 'number') })] }));
}
function ActionQueueCard({ title, value, hint, tone = 'neutral', onClick }) {
    return (_jsxs("button", { className: `action-card tone-${tone}`, onClick: onClick, children: [_jsx("div", { className: "action-value", children: formatCell(value, 'number') }), _jsx("div", { className: "action-title", children: title }), _jsx("div", { className: "action-hint", children: hint })] }));
}
function PharmacyFinanceCard({ item, staffing, onClickSdra, onClickStaffing }) {
    const color = item.pharmacyColor || pharmacyColorMap[item.pharmacyCode] || '#132238';
    return (_jsxs("div", { className: "card pharmacy-performance-card", style: { ['--pharmacyColor']: color }, children: [_jsxs("div", { className: "pharmacy-performance-head", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: item.pharmacyName }), _jsxs("h3", { children: [formatCell(item.revenue || 0, 'currency'), " revenue"] })] }), _jsx("div", { className: "pill", style: { background: `${color}18`, color }, children: staffing?.staffingStatus || 'Stable' })] }), _jsxs("div", { className: "metric-grid compact-grid", children: [_jsx(MetricStack, { label: "Gross profit", value: item.grossProfit || 0, type: "currency" }), _jsx(MetricStack, { label: "Gross margin", value: item.grossMargin || 0, type: "percent" }), _jsx(MetricStack, { label: "SDRA gap", value: item.sdraCollectibleGap || 0, type: "currency" }), _jsx(MetricStack, { label: "340B exposure", value: item.improper340BExposure || 0, type: "currency" }), _jsx(MetricStack, { label: "Inventory", value: item.inventoryValue || 0, type: "currency" }), _jsx(MetricStack, { label: "Weighted NDC", value: item.weightedNdcSavings || 0, type: "currency" })] }), _jsx("div", { className: "small muted", style: { marginTop: 12 }, children: staffing?.dashboardNote || `${item.flaggedActions || 0} flagged actions are currently attached to this pharmacy.` }), _jsxs("div", { className: "row", style: { marginTop: 14 }, children: [_jsx("button", { className: "secondary", onClick: onClickSdra, children: "Open SDRA issues" }), _jsx("button", { className: "secondary", onClick: onClickStaffing, children: "Open staffing" })] })] }));
}
function MetricStack({ label, value, type }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "small-label", children: label }), _jsx("div", { className: "metric-value", children: formatCell(value, type) })] }));
}
function SectionOverview({ title, subtitle, metrics, actions, color }) {
    return (_jsxs("div", { className: "card overview-card", style: { ['--accent']: color }, children: [_jsxs("div", { className: "overview-top", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Overview" }), _jsx("h2", { children: title }), _jsx("p", { children: subtitle })] }), actions.length > 0 && (_jsx("div", { className: "overview-actions", children: actions.map((action) => (_jsx("button", { className: action.kind === 'primary' ? 'primary' : 'secondary', onClick: action.onClick, children: action.label }, action.label))) }))] }), _jsx("div", { className: "overview-metrics", children: metrics.map((metric) => {
                    const content = (_jsxs(_Fragment, { children: [_jsx("div", { className: "small-label", children: metric.label }), _jsx("div", { className: "overview-value", children: formatCell(metric.value, metric.type) }), metric.hint && _jsx("div", { className: "small muted", children: metric.hint })] }));
                    return metric.onClick ? (_jsx("button", { className: `overview-metric tone-${metric.tone || 'neutral'} clickable-metric`, onClick: metric.onClick, children: content }, metric.label)) : (_jsx("div", { className: `overview-metric tone-${metric.tone || 'neutral'}`, children: content }, metric.label));
                }) })] }));
}
function formatCell(value, type = 'text') {
    if (value == null || value === '')
        return '';
    if (type === 'currency')
        return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (type === 'percent')
        return `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    if (type === 'number')
        return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
    return String(value);
}
function cellValue(row, column) {
    if (column.render)
        return column.render(row);
    return column.key.split('.').reduce((acc, part) => acc?.[part], row);
}
function csvEscape(value) {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n'))
        return `"${text.replace(/"/g, '""')}"`;
    return text;
}
function exportRows(filename, columns, rows) {
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
function normalizeForSearch(value) {
    return String(value ?? '').toLowerCase();
}
function compareValues(a, b) {
    if (a == null && b == null)
        return 0;
    if (a == null)
        return 1;
    if (b == null)
        return -1;
    if (typeof a === 'number' && typeof b === 'number')
        return a - b;
    const maybeNumberA = Number(a);
    const maybeNumberB = Number(b);
    if (!Number.isNaN(maybeNumberA) && !Number.isNaN(maybeNumberB) && `${a}` !== '' && `${b}` !== '')
        return maybeNumberA - maybeNumberB;
    return String(a).localeCompare(String(b));
}
function pharmacySortKey(code) {
    const index = pharmacyOrder.indexOf(code);
    return index === -1 ? 999 : index;
}
function summarizeGroup(rows, columns) {
    const flagged = rows.filter((row) => row.flagged).length;
    const numericColumns = columns.filter((column) => column.type === 'currency' || column.type === 'number');
    const highlights = numericColumns.slice(0, 2).map((column) => {
        const total = rows.reduce((sum, row) => {
            const value = Number(cellValue(row, column));
            return Number.isFinite(value) ? sum + value : sum;
        }, 0);
        return `${column.label}: ${formatCell(total, column.type)}`;
    });
    return { flagged, highlights };
}
function countBy(rows, keyFn) {
    return rows.reduce((acc, row) => {
        const key = keyFn(row);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}
function ReportTable({ title, description, rows, columns, exportName, groupByPharmacy = true, allowDrilldown = true, renderDetails, externalFilterText, externalFlaggedOnly, onApplyLabel, }) {
    const [sortKey, setSortKey] = useState('');
    const [sortDir, setSortDir] = useState('asc');
    const [filterText, setFilterText] = useState(externalFilterText || '');
    const [flaggedOnly, setFlaggedOnly] = useState(Boolean(externalFlaggedOnly));
    const [expanded, setExpanded] = useState({});
    const [menu, setMenu] = useState(null);
    const showLabelColumn = Boolean(onApplyLabel) || rows.some((row) => row.manualLabel);
    useEffect(() => {
        if (externalFilterText !== undefined)
            setFilterText(externalFilterText);
    }, [externalFilterText]);
    useEffect(() => {
        if (externalFlaggedOnly !== undefined)
            setFlaggedOnly(Boolean(externalFlaggedOnly));
    }, [externalFlaggedOnly]);
    useEffect(() => {
        if (!menu)
            return;
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
            if (flaggedOnly && !row.flagged)
                return false;
            if (!text)
                return true;
            return columns.some((column) => normalizeForSearch(cellValue(row, column)).includes(text))
                || normalizeForSearch(row.manualLabel).includes(text)
                || normalizeForSearch(row.flagReason).includes(text);
        });
    }, [rows, columns, filterText, flaggedOnly]);
    const sorted = useMemo(() => {
        const list = [...filtered];
        list.sort((left, right) => {
            const flagDelta = Number(Boolean(right.flagged)) - Number(Boolean(left.flagged));
            if (flagDelta !== 0)
                return flagDelta;
            if (sortKey) {
                const column = columns.find((item) => item.key === sortKey);
                const leftValue = column ? cellValue(left, column) : left[sortKey];
                const rightValue = column ? cellValue(right, column) : right[sortKey];
                const delta = compareValues(leftValue, rightValue);
                if (delta !== 0)
                    return sortDir === 'asc' ? delta : -delta;
            }
            return compareValues(left.pharmacyCode || '', right.pharmacyCode || '') || compareValues(left.id || '', right.id || '');
        });
        return list;
    }, [filtered, sortKey, sortDir, columns]);
    const grouped = useMemo(() => {
        if (!groupByPharmacy)
            return [{ key: 'ALL', label: 'All rows', color: '#132238', rows: sorted }];
        const buckets = new Map();
        for (const row of sorted) {
            const code = row.pharmacyCode || 'UNGROUPED';
            const label = row.pharmacyName || code;
            if (!buckets.has(code))
                buckets.set(code, { key: code, label, color: row.pharmacyColor || pharmacyColorMap[code] || '#132238', rows: [] });
            buckets.get(code).rows.push(row);
        }
        return [...buckets.values()].sort((a, b) => pharmacySortKey(a.key) - pharmacySortKey(b.key));
    }, [sorted, groupByPharmacy]);
    return (_jsxs("div", { className: "card report-shell", children: [_jsxs("div", { className: "report-header", children: [_jsxs("div", { children: [_jsx("h2", { children: title }), _jsx("div", { className: "small muted", children: description || 'Grouped by pharmacy, sortable, filterable, exportable, and expandable to row-level detail.' }), onApplyLabel && _jsx("div", { className: "small muted", style: { marginTop: 6 }, children: "Use the Action taken dropdown on each row for faster labeling, or right-click any row to label it as do not flag, flag, or resolved." })] }), _jsxs("div", { className: "report-actions", children: [_jsx("input", { value: filterText, onChange: (e) => setFilterText(e.target.value), placeholder: "Filter this report" }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: flaggedOnly, onChange: (e) => setFlaggedOnly(e.target.checked) }), " Flagged only"] }), _jsx("button", { className: "secondary", onClick: () => exportRows(exportName, columns, sorted), children: "Export CSV" })] })] }), grouped.map((group) => (_jsxs("div", { className: "group-card", children: [groupByPharmacy && (_jsxs("div", { className: "group-title", style: { background: `${group.color}14`, borderColor: `${group.color}40`, color: group.color }, children: [_jsx("span", { children: group.label }), _jsxs("span", { className: "small muted", children: [group.rows.length, " rows"] })] })), groupByPharmacy && (() => {
                        const summary = summarizeGroup(group.rows, columns);
                        return (_jsxs("div", { className: "group-summary", children: [summary.flagged ? `${summary.flagged} flagged` : 'No flagged items', summary.highlights.length ? ` · ${summary.highlights.join(' · ')}` : ''] }));
                    })(), _jsx("div", { className: "table-wrap", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [allowDrilldown && _jsx("th", { style: { width: 58 }, children: "Detail" }), showLabelColumn && _jsx("th", { style: { width: 168 }, children: "Action taken" }), columns.map((column) => (_jsx("th", { style: { width: column.width }, children: _jsxs("button", { className: "sort-button", onClick: () => {
                                                        if (sortKey === column.key)
                                                            setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc');
                                                        else {
                                                            setSortKey(column.key);
                                                            setSortDir('asc');
                                                        }
                                                    }, children: [column.label, sortKey === column.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''] }) }, column.key)))] }) }), _jsx("tbody", { children: group.rows.length ? group.rows.map((row) => {
                                        const rowId = row.id || `${row.pharmacyCode || 'row'}-${Math.random()}`;
                                        return (_jsxs(Fragment, { children: [_jsxs("tr", { className: row.flagged ? 'row-flagged' : '', onContextMenu: (event) => {
                                                        if (!onApplyLabel)
                                                            return;
                                                        event.preventDefault();
                                                        setMenu({ x: event.clientX, y: event.clientY, row });
                                                    }, children: [allowDrilldown && (_jsx("td", { children: renderDetails || row.details ? (_jsx("button", { className: "link-button", onClick: () => setExpanded((prev) => ({ ...prev, [rowId]: !prev[rowId] })), children: expanded[rowId] ? 'Hide' : 'View' })) : '' })), showLabelColumn && (_jsx("td", { children: onApplyLabel ? (_jsxs("select", { value: row.manualLabel === 'Flag' ? 'flag' : row.manualLabel === 'Do not flag' ? 'do_not_flag' : row.manualLabel === 'Resolved' ? 'resolved' : '', onChange: (event) => onApplyLabel(row.id, (event.target.value || null)), children: [_jsx("option", { value: "", children: "No action" }), _jsx("option", { value: "flag", children: "Flag" }), _jsx("option", { value: "do_not_flag", children: "Do not flag" }), _jsx("option", { value: "resolved", children: "Resolved" })] })) : row.manualLabel ? _jsx("span", { className: "pill", children: row.manualLabel }) : '—' })), columns.map((column) => (_jsx("td", { children: _jsx(Cell, { value: cellValue(row, column), type: column.type }) }, `${rowId}-${column.key}`)))] }), allowDrilldown && expanded[rowId] && (_jsx("tr", { className: "detail-row", children: _jsxs("td", { colSpan: columns.length + 1 + (showLabelColumn ? 1 : 0), children: [renderDetails ? renderDetails(row) : _jsx(DetailTable, { details: row.details }), row.flagReason && _jsxs("div", { className: "small muted", style: { marginTop: 10 }, children: ["Flag reason: ", row.flagReason] }), row.manualLabel && _jsxs("div", { className: "small muted", style: { marginTop: 6 }, children: ["Manual label: ", row.manualLabel] }), row.actionItems?.length ? _jsxs("div", { className: "small muted", style: { marginTop: 6 }, children: ["Action items: ", row.actionItems.join(' · ')] }) : null] }) }))] }, rowId));
                                    }) : _jsx("tr", { children: _jsx("td", { colSpan: columns.length + (allowDrilldown ? 1 : 0) + (showLabelColumn ? 1 : 0), children: "No data yet" }) }) })] }) })] }, group.key))), menu && onApplyLabel && (_jsxs("div", { className: "context-menu", style: { top: menu.y, left: menu.x }, children: [_jsx("button", { onClick: () => { onApplyLabel(menu.row.id, 'flag'); setMenu(null); }, children: "Flag" }), _jsx("button", { onClick: () => { onApplyLabel(menu.row.id, 'do_not_flag'); setMenu(null); }, children: "Do not flag" }), _jsx("button", { onClick: () => { onApplyLabel(menu.row.id, 'resolved'); setMenu(null); }, children: "Resolved" }), _jsx("button", { onClick: () => { onApplyLabel(menu.row.id, null); setMenu(null); }, children: "Clear label" })] }))] }));
}
function Cell({ value, type }) {
    if (type === 'currency' || type === 'percent' || type === 'number')
        return _jsx("span", { children: formatCell(value, type) });
    if (typeof value === 'string' && /high/i.test(value))
        return _jsx("span", { className: "pill bad", children: value });
    if (typeof value === 'string' && /medium|negative gross profit|unexpected|review|incorrect|improper|reorder|replenish|return candidate|medicaid|below minimum|open coverage/i.test(value)) {
        return _jsx("span", { className: "pill warn", children: value });
    }
    if (typeof value === 'string' && /healthy|paid correctly|no payment expected|low|stable|at or above preferred|resolved/i.test(value)) {
        return _jsx("span", { className: "pill good", children: value });
    }
    if (typeof value === 'string' && /pending|monitor|volume driver|stretch|do not flag|flag/i.test(value)) {
        return _jsx("span", { className: "pill", children: value });
    }
    return _jsx("span", { children: formatCell(value, type) });
}
function DetailTable({ details }) {
    if (!details?.columns?.length)
        return _jsx("div", { className: "small muted", children: "No drilldown rows available." });
    return (_jsx("div", { className: "detail-wrap", children: _jsxs("table", { children: [_jsx("thead", { children: _jsx("tr", { children: details.columns.map((column) => _jsx("th", { children: column }, column)) }) }), _jsx("tbody", { children: details.rows?.length ? details.rows.map((row, index) => _jsx("tr", { children: row.map((cell, cellIndex) => _jsx("td", { children: cell }, cellIndex)) }, index)) : _jsx("tr", { children: _jsx("td", { colSpan: details.columns.length, children: "No detail rows" }) }) })] }) }));
}
