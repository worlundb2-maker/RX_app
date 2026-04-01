import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import xlsx from 'xlsx';

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-regression-'));
process.chdir(sandboxRoot);

const { ingestUpload } = await import('./parser');
const { getAppState } = await import('./analysis');
const { readDb, writeDb, resolvePharmacy } = await import('./data');
const { parseInboxAssignment } = await import('./routes');

function resetDb() {
  const current = readDb();
  writeDb({
    ...current,
    uploads: [],
    pioneerClaims: [],
    mtfClaims: [],
    inventoryRows: [],
    priceRows: [],
    reviewDecisions: [],
  });
}

function writeWorkbook(fileName: string, rows: Array<Record<string, string | number | null>>) {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  const filePath = path.join(sandboxRoot, fileName);
  xlsx.writeFile(wb, filePath);
  return filePath;
}

test.beforeEach(() => {
  resetDb();
});

test('fresh local database has no preloaded credentials', () => {
  const db = readDb();
  assert.equal(db.users.length, 0);
});

test('claim lifecycle guardrails exclude inactive claims from active analytics', () => {
  const pioneerPath = writeWorkbook('pioneer-lifecycle.xlsx', [
    {
      RxNumber: '1001',
      NDC: '00003089421',
      FillDate: '2026-03-01',
      Quantity: 30,
      'Days Supply': 30,
      PrimaryPayer: 'Caremark',
      InventoryGroup: 'RX',
      Store: '4',
      'Claim Status': 'B1',
      'Current Transaction Status': 'Completed',
    },
    {
      RxNumber: '1002',
      NDC: '00003089421',
      FillDate: '2026-03-01',
      Quantity: 30,
      'Days Supply': 30,
      PrimaryPayer: 'Caremark',
      InventoryGroup: 'RX',
      Store: '4',
      'Claim Status': 'B2',
      'Current Transaction Status': 'Completed',
    },
    {
      RxNumber: '1003',
      NDC: '00003089421',
      FillDate: '2026-03-01',
      Quantity: 30,
      'Days Supply': 30,
      PrimaryPayer: 'Caremark',
      InventoryGroup: 'RX',
      Store: '4',
      'Claim Status': '',
      'Current Transaction Status': 'Cancelled',
    },
  ]);

  ingestUpload(pioneerPath, 'pioneer');

  const state = getAppState();
  assert.equal(state.kpi.pioneerClaims, 1);
  assert.equal(state.kpi.inactiveClaimsExcluded, 2);
});

test('inventory and price uploads fully overwrite their target datasets', () => {
  const inventoryA = writeWorkbook('inventory-a.xlsx', [
    { NDC: '11111-1111-11', Name: 'Drug A', 'Inventory Group': 'RX', 'Inventory On Hand': 10, 'Last Cost Paid': 5, 'Stock Size': 10 },
  ]);
  const inventoryB = writeWorkbook('inventory-b.xlsx', [
    { NDC: '22222-2222-22', Name: 'Drug B', 'Inventory Group': 'RX', 'Inventory On Hand': 20, 'Last Cost Paid': 4, 'Stock Size': 20 },
  ]);

  ingestUpload(inventoryA, 'inventory', 'SEMINOLE');
  ingestUpload(inventoryB, 'inventory', 'SEMINOLE');

  const priceRxA = writeWorkbook('price-rx-a.xlsx', [
    { NDC: '11111111111', ProperContractPrice: 8, SellDescription: 'Drug A', GCN: 'GCN1' },
  ]);
  const priceRxB = writeWorkbook('price-rx-b.xlsx', [
    { NDC: '22222222222', ProperContractPrice: 7, SellDescription: 'Drug B', GCN: 'GCN2' },
  ]);

  ingestUpload(priceRxA, 'price_rx');
  ingestUpload(priceRxB, 'price_rx');

  const db = readDb();
  const seminoleInventory = db.inventoryRows.filter((row) => row.pharmacyCode === 'SEMINOLE');
  assert.equal(seminoleInventory.length, 1);
  assert.equal(seminoleInventory[0].ndc, '22222222222');

  const rxPrices = db.priceRows.filter((row) => row.inventoryGroup === 'RX');
  assert.equal(rxPrices.length, 1);
  assert.equal(rxPrices[0].ndc, '22222222222');
});

test('pioneer and mtf ingests keep running history with dedupe keys', () => {
  const pioneerA = writeWorkbook('pioneer-a.xlsx', [
    {
      RxNumber: '5001',
      NDC: '00003089421',
      FillDate: '2026-03-01',
      Quantity: 30,
      'Days Supply': 30,
      PrimaryPayer: 'Caremark',
      InventoryGroup: 'RX',
      Store: '4',
      'Claim Status': 'B1',
      'Current Transaction Status': 'Completed',
      TotalPricePaid: 40,
    },
  ]);
  const pioneerB = writeWorkbook('pioneer-b.xlsx', [
    {
      RxNumber: '5001',
      NDC: '00003089421',
      FillDate: '2026-03-02',
      Quantity: 30,
      'Days Supply': 30,
      PrimaryPayer: 'Caremark',
      InventoryGroup: 'RX',
      Store: '4',
      'Claim Status': 'B1',
      'Current Transaction Status': 'Completed',
      TotalPricePaid: 45,
    },
    {
      RxNumber: '5002',
      NDC: '00003089321',
      FillDate: '2026-03-02',
      Quantity: 30,
      'Days Supply': 30,
      PrimaryPayer: 'Caremark',
      InventoryGroup: 'RX',
      Store: '4',
      'Claim Status': 'B1',
      'Current Transaction Status': 'Completed',
      TotalPricePaid: 50,
    },
  ]);

  ingestUpload(pioneerA, 'pioneer');
  ingestUpload(pioneerB, 'pioneer');

  const mtfA = writeWorkbook('mtf-a.xlsx', [
    {
      'Rx Num': '5001',
      NDC: '00003089421',
      ICN: 'A-1',
      'Payment Amount': 11,
      'Service Date': '2026-03-01',
      'Payment Issue Date': '2026-03-05',
      'Store NPI': '1205540101',
    },
  ]);
  const mtfB = writeWorkbook('mtf-b.xlsx', [
    {
      'Rx Num': '5001',
      NDC: '00003089421',
      ICN: 'A-1',
      'Payment Amount': 11,
      'Service Date': '2026-03-01',
      'Payment Issue Date': '2026-03-05',
      'Store NPI': '1205540101',
    },
    {
      'Rx Num': '5002',
      NDC: '00003089321',
      ICN: 'A-2',
      'Payment Amount': 7,
      'Service Date': '2026-03-02',
      'Payment Issue Date': '2026-03-06',
      'Store NPI': '1205540101',
    },
  ]);

  ingestUpload(mtfA, 'mtf');
  ingestUpload(mtfB, 'mtf');

  const db = readDb();
  assert.equal(db.pioneerClaims.length, 2);
  const refreshedClaim = db.pioneerClaims.find((row) => row.rxNumber === '5001');
  assert.equal(refreshedClaim?.totalPricePaid, 45);

  assert.equal(db.mtfClaims.length, 2);
  const dedupedPayment = db.mtfClaims.find((row) => row.rxNumber === '5001' && row.icn === 'A-1');
  assert.equal(dedupedPayment?.manufacturerPaymentAmount, 11);
});



test('sdra status classification covers key payment edge cases', () => {
  const pioneerPath = writeWorkbook('pioneer-sdra.xlsx', [
    { RxNumber: '9001', NDC: '00003089421', FillDate: '2026-03-10', Quantity: 10, 'Days Supply': 30, PrimaryPayer: 'Med D PDP', InventoryGroup: 'RX', Store: '4', 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
    { RxNumber: '9002', NDC: '00003089421', FillDate: '2026-03-10', Quantity: 10, 'Days Supply': 30, PrimaryPayer: 'Med D PDP', InventoryGroup: 'RX', Store: '4', 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
    { RxNumber: '9003', NDC: '00003089421', FillDate: '2026-03-01', Quantity: 10, 'Days Supply': 30, PrimaryPayer: 'Med D PDP', InventoryGroup: 'RX', Store: '4', 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
    { RxNumber: '9004', NDC: '00003089421', FillDate: '2026-03-29', Quantity: 10, 'Days Supply': 30, PrimaryPayer: 'Med D PDP', InventoryGroup: 'RX', Store: '4', 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
    { RxNumber: '9005', NDC: '00003089421', FillDate: '2026-03-10', Quantity: 10, 'Days Supply': 30, PrimaryPayer: 'Med D PDP', InventoryGroup: '340B', Store: '4', 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
    { RxNumber: '9006', NDC: '00003089421', FillDate: '2026-03-10', Quantity: 10, 'Days Supply': 30, PrimaryPayer: 'Med D PDP', InventoryGroup: '340B', Store: '4', 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
  ]);

  const mtfPath = writeWorkbook('mtf-sdra.xlsx', [
    { 'Rx Num': '9001', NDC: '00003089421', ICN: 'SDRA-1', 'Payment Amount': 16.2, 'Service Date': '2026-03-10', 'Payment Issue Date': '2026-03-12', 'Store NPI': '1205540101' },
    { 'Rx Num': '9002', NDC: '00003089421', ICN: 'SDRA-2', 'Payment Amount': 5, 'Service Date': '2026-03-10', 'Payment Issue Date': '2026-03-12', 'Store NPI': '1205540101' },
    { 'Rx Num': '9005', NDC: '00003089421', ICN: 'SDRA-3', 'Payment Amount': 8, 'Service Date': '2026-03-10', 'Payment Issue Date': '2026-03-12', 'Store NPI': '1205540101' },
    { 'Rx Num': '9006', NDC: '00003089421', ICN: 'SDRA-4', 'Payment Amount': -3, 'Service Date': '2026-03-10', 'Payment Issue Date': '2026-03-12', 'Store NPI': '1205540101' },
  ]);

  ingestUpload(pioneerPath, 'pioneer');
  ingestUpload(mtfPath, 'mtf');

  const state = getAppState();
  const statusByRx = new Map(state.sdraResults.map((row) => [row.claim.rxNumber, row.status]));

  assert.equal(statusByRx.get('9001'), 'RX paid correctly');
  assert.equal(statusByRx.get('9002'), 'RX not paid correctly');
  assert.equal(statusByRx.get('9003'), 'RX not paid and should have been');
  assert.equal(statusByRx.get('9004'), 'Pending payment');
  assert.equal(statusByRx.get('9005'), '340B paid and should not have been');
  assert.equal(statusByRx.get('9006'), '340B adjustment posted');
});

test('day-supply exceptions suppress expected stock-cycle claims but still flag true atypical fills', () => {
  const inventoryPath = writeWorkbook('inventory-days-supply.xlsx', [
    { NDC: '55555-5555-55', Name: 'Cycle Drug', 'Inventory Group': 'RX', 'Inventory On Hand': 10, 'Last Cost Paid': 5, 'Stock Size': 5 },
  ]);

  const pioneerPath = writeWorkbook('pioneer-days-supply.xlsx', [
    { RxNumber: '9101', NDC: '55555-5555-55', FillDate: '2026-03-10', Quantity: 5, 'Days Supply': 28, PrimaryPayer: 'Caremark', InventoryGroup: 'RX', Store: '4', 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
    { RxNumber: '9102', NDC: '55555-5555-55', FillDate: '2026-03-10', Quantity: 5, 'Days Supply': 30, PrimaryPayer: 'Caremark', InventoryGroup: 'RX', Store: '4', 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
  ]);

  ingestUpload(inventoryPath, 'inventory', 'SEMINOLE');
  ingestUpload(pioneerPath, 'pioneer');

  const state = getAppState('SEMINOLE');
  const groupRow = state.claimsAnalysis.find((row) => row.ndc === '55555555555');

  assert.equal(groupRow?.totalClaims, 2);
  assert.equal(groupRow?.atypicalDaysSupplyCount, 1);
});

test('inbox filename parser assigns pharmacy and type for supported naming patterns', () => {
  assert.deepEqual(parseInboxAssignment('SEMINOLE_pioneer_claims_01012026to03202026.xlsx'), {
    type: 'pioneer',
    pharmacyCode: 'SEMINOLE',
  });

  assert.deepEqual(parseInboxAssignment('MV_mtf_payments.csv'), {
    type: 'mtf',
    pharmacyCode: 'MONTE_VISTA',
  });

  assert.deepEqual(parseInboxAssignment('GLOBAL_price_340b_340b_prices.xlsx'), {
    type: 'price_340b',
  });

  assert.deepEqual(parseInboxAssignment('SEMINOLE__pioneer__claims.xlsx'), {
    type: 'pioneer',
    pharmacyCode: 'SEMINOLE',
  });

  assert.equal(parseInboxAssignment('unknown_file_name.xlsx'), null);
});

test('MV and Monte Vista aliases resolve to the same fixed pharmacy mapping', () => {
  const byAlias = resolvePharmacy({ pharmacyName: 'MV' });
  const byName = resolvePharmacy({ pharmacyName: 'Monte Vista' });

  assert.equal(byAlias?.code, 'MONTE_VISTA');
  assert.equal(byName?.code, 'MONTE_VISTA');
  assert.equal(byAlias?.color, byName?.color);
});

test('ira 2025 vs 2026 comparison tracks financial deltas while keeping 2025 out of sdra totals', () => {
  const pioneerPath = writeWorkbook('pioneer-ira-compare.xlsx', [
    { RxNumber: '9201', NDC: '00003089421', FillDate: '2025-05-01', Quantity: 10, PrimaryPayer: 'Med D PDP', InventoryGroup: 'RX', Store: '4', TotalPricePaid: 100, 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
    { RxNumber: '9202', NDC: '00003089421', FillDate: '2026-05-01', Quantity: 10, PrimaryPayer: 'Med D PDP', InventoryGroup: 'RX', Store: '4', TotalPricePaid: 80, 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
  ]);
  const pricePath = writeWorkbook('price-ira-compare.xlsx', [
    { NDC: '00003089421', ProperContractPrice: 5, SellDescription: 'IRA Drug', GCN: 'GCN-IRA' },
  ]);

  ingestUpload(pricePath, 'price_rx');
  ingestUpload(pioneerPath, 'pioneer');

  const state = getAppState('SEMINOLE');
  const row2025 = state.iraYearComparison.find((row) => row.year === 2025);
  const row2026 = state.iraYearComparison.find((row) => row.year === 2026);

  assert.equal(state.kpi.pioneerClaims, 1);
  assert.equal(state.financeSummary.recordedRevenue, 80);
  assert.equal(row2025?.totalRevenue, 100);
  assert.equal(row2026?.totalRevenue, 80);
  assert.equal(row2026?.revenueDeltaVs2025, -20);
  assert.equal(row2026?.grossProfitDeltaVs2025, -20);
  assert.match(String(row2025?.note || ''), /excluded from SDRA totals/i);
});

test('month filtering scopes dashboard and comparison outputs to selected month', () => {
  const pioneerPath = writeWorkbook('pioneer-month-filter.xlsx', [
    { RxNumber: '9301', NDC: '00003089421', FillDate: '2025-05-01', Quantity: 10, PrimaryPayer: 'Med D PDP', InventoryGroup: 'RX', Store: '4', TotalPricePaid: 100, 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
    { RxNumber: '9302', NDC: '00003089421', FillDate: '2026-05-01', Quantity: 10, PrimaryPayer: 'Med D PDP', InventoryGroup: 'RX', Store: '4', TotalPricePaid: 90, 'Claim Status': 'B1', 'Current Transaction Status': 'Completed' },
  ]);
  const pricePath = writeWorkbook('price-month-filter.xlsx', [
    { NDC: '00003089421', ProperContractPrice: 5, SellDescription: 'IRA Drug', GCN: 'GCN-IRA' },
  ]);
  ingestUpload(pricePath, 'price_rx');
  ingestUpload(pioneerPath, 'pioneer');

  const may2025 = getAppState('SEMINOLE', '2025-05');
  const may2026 = getAppState('SEMINOLE', '2026-05');

  assert.equal(may2025.kpi.pioneerClaims, 0);
  assert.equal(may2026.kpi.pioneerClaims, 1);
  assert.equal(may2025.financeSummary.recordedRevenue, 0);
  assert.equal(may2026.financeSummary.recordedRevenue, 90);
  assert.equal(may2025.iraYearComparison.find((row) => row.year === 2025)?.claimCount, 1);
  assert.equal(may2025.iraYearComparison.find((row) => row.year === 2026)?.claimCount, 0);
  assert.equal(may2026.iraYearComparison.find((row) => row.year === 2025)?.claimCount, 0);
});
