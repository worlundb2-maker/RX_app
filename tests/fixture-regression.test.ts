import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

function writeCsv(filePath: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((value) => {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }).join(',')).join('\n');
  writeFileSync(filePath, csv, 'utf8');
}

test('fixture regression coverage: dedupe, overwrite, and lifecycle exclusion', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'rx-app-fixture-'));
  process.chdir(tempRoot);
  mkdirSync('fixtures', { recursive: true });

  const parserModule = await import('../server/parser.ts');
  const analysisModule = await import('../server/analysis.ts');
  const dataModule = await import('../server/data.ts');

  const { ingestUpload } = parserModule;
  const { getAppState } = analysisModule;
  const { readDb } = dataModule;

  const pioneerBatchA = path.join(tempRoot, 'fixtures', 'pioneer_a.csv');
  writeCsv(pioneerBatchA, [
    ['RxNumber', 'NDC', 'FillDate', 'Quantity', 'InventoryGroup', 'ClaimStatus', 'CurrentTransactionStatus', 'PrimaryPayer'],
    ['1001', '00003089421', '2026-03-01', '30', 'RX', 'B1', 'Paid', 'Med D PDP'],
    ['1002', '00006011231', '2026-03-02', '30', 'RX', '', 'Cancelled', 'Med D PDP'],
  ]);

  const pioneerBatchB = path.join(tempRoot, 'fixtures', 'pioneer_b.csv');
  writeCsv(pioneerBatchB, [
    ['RxNumber', 'NDC', 'FillDate', 'Quantity', 'InventoryGroup', 'ClaimStatus', 'CurrentTransactionStatus', 'PrimaryPayer', 'TotalPricePaid'],
    ['1001', '00003089421', '2026-03-01', '30', 'RX', 'B1', 'Paid', 'Med D PDP', '45.00'],
    ['1003', '00006027731', '2026-03-03', '30', 'RX', 'B1', 'Paid', 'Med D PDP', '50.00'],
  ]);

  ingestUpload(pioneerBatchA, 'pioneer', 'SEMINOLE');
  ingestUpload(pioneerBatchB, 'pioneer', 'SEMINOLE');

  let db = readDb();
  assert.equal(db.pioneerClaims.length, 3, 'pioneer claims should keep history with dedupe replacement');

  const state = getAppState('SEMINOLE');
  assert.equal(state.kpi.pioneerClaims, 2, 'active analytics should exclude cancelled/rejected lifecycle claims');
  assert.equal(state.kpi.inactiveClaimsExcluded, 1, 'inactive claim count should be tracked');

  const mtfA = path.join(tempRoot, 'fixtures', 'mtf_a.csv');
  writeCsv(mtfA, [
    ['Rx Num', 'ICN', 'Service Date', 'Payment Issue Date', 'NDC', 'MFR Payment Amount'],
    ['1001', 'ICN-1001', '2026-03-01', '2026-03-10', '00003089421', '10.00'],
  ]);

  const mtfB = path.join(tempRoot, 'fixtures', 'mtf_b.csv');
  writeCsv(mtfB, [
    ['Rx Num', 'ICN', 'Service Date', 'Payment Issue Date', 'NDC', 'MFR Payment Amount'],
    ['1001', 'ICN-1001', '2026-03-01', '2026-03-10', '00003089421', '10.00'],
  ]);

  ingestUpload(mtfA, 'mtf', 'SEMINOLE');
  ingestUpload(mtfB, 'mtf', 'SEMINOLE');

  db = readDb();
  assert.equal(db.mtfClaims.length, 1, 'mtf claims should dedupe by source key');

  const inventoryA = path.join(tempRoot, 'fixtures', 'inventory_a.csv');
  writeCsv(inventoryA, [
    ['NDC', 'Name', 'Inventory Group', 'Inventory Group On Hand', 'Last Cost Paid'],
    ['11111111111', 'Drug One', 'RX', '5', '3.00'],
    ['22222222222', 'Drug Two', '340B', '7', '2.00'],
  ]);

  const inventoryB = path.join(tempRoot, 'fixtures', 'inventory_b.csv');
  writeCsv(inventoryB, [
    ['NDC', 'Name', 'Inventory Group', 'Inventory Group On Hand', 'Last Cost Paid'],
    ['33333333333', 'Drug Three', 'RX', '9', '4.00'],
  ]);

  ingestUpload(inventoryA, 'inventory', 'SEMINOLE');
  ingestUpload(inventoryB, 'inventory', 'SEMINOLE');

  db = readDb();
  const seminoleInventory = db.inventoryRows.filter((row) => row.pharmacyCode === 'SEMINOLE');
  assert.equal(seminoleInventory.length, 1, 'inventory ingest should fully overwrite per pharmacy');
  assert.equal(seminoleInventory[0]?.ndc, '33333333333');

  const rxPriceA = path.join(tempRoot, 'fixtures', 'price_rx_a.csv');
  writeCsv(rxPriceA, [
    ['NDC', 'ProperContractPrice', 'SellDescription'],
    ['44444444444', '1.11', 'Price One'],
    ['55555555555', '2.22', 'Price Two'],
  ]);

  const rxPriceB = path.join(tempRoot, 'fixtures', 'price_rx_b.csv');
  writeCsv(rxPriceB, [
    ['NDC', 'ProperContractPrice', 'SellDescription'],
    ['66666666666', '3.33', 'Price Three'],
  ]);

  ingestUpload(rxPriceA, 'price_rx');
  ingestUpload(rxPriceB, 'price_rx');

  db = readDb();
  const rxRows = db.priceRows.filter((row) => row.inventoryGroup === 'RX');
  assert.equal(rxRows.length, 1, 'rx price ingest should fully overwrite the RX group');
  assert.equal(rxRows[0]?.ndc, '66666666666');
});
