import { PHARMACIES, readDb } from './data';
import { buildStaffingState } from './staffing';
import type { MtfClaim, PharmacyCode, PioneerClaim, PriceRow } from './types';

const SDRA_REFERENCE = [
  ['00003089421', 1.6147777778], ['00003089321', 1.6147777778], ['00310621030', 6.5411111111], ['00310620530', 6.541],
  ['00310621090', 6.5411111111], ['00310620590', 6.5411111111], ['00006011231', 7.092], ['00006027731', 7.092],
  ['00006022131', 7.092], ['00006011254', 7.092], ['00597015230', 4.8726666667], ['00597015330', 4.873],
  ['00597015290', 4.8726666667], ['00597015390', 4.8726666667], ['00169320415', 0.3573333333], ['00169633910', 0.357],
  ['00169320111', 0.277], ['00169750111', 0.277], ['50458057930', 13.0544444444], ['50458057990', 13.0544444444],
  ['50458057760', 6.5306666667], ['50458057830', 13.0602222222], ['00078065920', 6.8796666667], ['00078077720', 6.8796666667],
  ['00078069620', 6.8796666667], ['00078065967', 6.8796666667], ['00078077767', 6.8796666667], ['00078069667', 6.8796666667]
] as const;

const sdraMap = new Map<string, number>(SDRA_REFERENCE as unknown as [string, number][]);

function groupBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values: number[]) {
  return values.reduce((s, value) => s + value, 0);
}

function money(value: number) {
  return Number(value.toFixed(2));
}

function claimYear(claim: Pick<PioneerClaim, 'fillDate' | 'claimDate'>) {
  const candidate = String(claim.fillDate || claim.claimDate || '');
  const match = /^(\d{4})/.exec(candidate);
  return match ? Number(match[1]) : null;
}

function normalizeIsoDate(value: string | null | undefined) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
  return match ? match[1] : null;
}

function dateWithinRange(date: string | null, startDate?: string, endDate?: string) {
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function claimInDateRange(claim: Pick<PioneerClaim, 'fillDate' | 'claimDate'>, startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return true;
  const fillDate = normalizeIsoDate(claim.fillDate);
  const claimDate = normalizeIsoDate(claim.claimDate);
  return dateWithinRange(fillDate, startDate, endDate) || dateWithinRange(claimDate, startDate, endDate);
}

function mtfInDateRange(claim: Pick<MtfClaim, 'serviceDate' | 'receiptDate'>, startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return true;
  const serviceDate = normalizeIsoDate(claim.serviceDate);
  const receiptDate = normalizeIsoDate(claim.receiptDate);
  return dateWithinRange(serviceDate, startDate, endDate) || dateWithinRange(receiptDate, startDate, endDate);
}

function cleanNdc(ndc: string | null | undefined) {
  return String(ndc || '').replace(/[^0-9]/g, '');
}

function isInactiveLifecycle(claim: Pick<PioneerClaim, 'normalizedClaimLifecycle' | 'claimStatus' | 'currentTransactionStatus'>) {
  const lifecycle = String(claim.normalizedClaimLifecycle || '').toLowerCase();
  if (['reversed', 'cancelled', 'rejected_on_hold', 'transferred', 'other_inactive'].includes(lifecycle)) return true;
  const claimType = String(claim.claimStatus || '').toUpperCase();
  const currentStatus = String(claim.currentTransactionStatus || '').toLowerCase();
  if (claimType === 'B2') return true;
  if (/cancel|reverse|reject|hold|transfer/.test(currentStatus)) return true;
  return false;
}

function activeClaimsOnly<T extends PioneerClaim>(claims: T[]) {
  return claims.filter((claim) => !isInactiveLifecycle(claim));
}

function countLifecycle(claims: PioneerClaim[], lifecycle: PioneerClaim['normalizedClaimLifecycle']) {
  return claims.filter((claim) => claim.normalizedClaimLifecycle === lifecycle).length;
}

const MEDICAID_PLAN_NAMES = [
  'ohca',
  'oklahoma health care authority',
  'aetna better health of oklahoma medicaid mco',
  'oklahoma complete health (centene) medicaid mco 2hfa',
  'humana health horizons ok medicaid mco 1a791',
  'soonercare',
  'medicaid'
];

function includesMedicaidMarker(value: string | null | undefined) {
  const text = String(value || '').toLowerCase();
  return MEDICAID_PLAN_NAMES.some((marker) => text.includes(marker)) || /medicaid|soonercare|welfare/.test(text);
}

function isMedicaidClaim(claim: PioneerClaim) {
  return claim.payerType === 'Medicaid'
    || includesMedicaidMarker(claim.primaryPayer)
    || includesMedicaidMarker(claim.secondaryPayer)
    || includesMedicaidMarker(claim.thirdPartyName)
    || includesMedicaidMarker(claim.primaryPlanType)
    || includesMedicaidMarker(claim.secondaryPlanType);
}

function reviewLabelDisplay(label: string | null | undefined) {
  if (label === 'flag') return 'Flag';
  if (label === 'do_not_flag') return 'Do not flag';
  if (label === 'resolved') return 'Resolved';
  return '';
}

function applyReviewDecisions<T extends { id: string; flagged?: boolean; severity?: string | null; flagReason?: string | null }>(rows: T[], reviewDecisionMap: Map<string, string>) {
  return rows.map((row) => {
    const decision = reviewDecisionMap.get(row.id);
    if (!decision) return { ...row, manualLabel: '' };
    const manualLabel = reviewLabelDisplay(decision);
    if (decision === 'flag') {
      const severity = row.severity === 'high' ? 'high' : 'medium';
      const flagReason = [row.flagReason, 'Manual flag'].filter(Boolean).join('; ');
      return { ...row, flagged: true, severity, flagReason, manualLabel };
    }
    const flagReason = [row.flagReason, decision === 'resolved' ? 'Marked resolved' : 'Marked do not flag'].filter(Boolean).join('; ');
    return { ...row, flagged: false, flagReason, manualLabel };
  });
}

function buildStockSizeMap(rows: { pharmacyCode: string; ndc: string; stockSize: number | null }[]) {
  const exact = new Map<string, number>();
  const anyGroup = new Map<string, number>();
  for (const row of rows) {
    if (row.stockSize == null || row.stockSize <= 0) continue;
    exact.set(`${row.pharmacyCode}|${cleanNdc(row.ndc)}`, Number(row.stockSize));
    if (!anyGroup.has(`${row.pharmacyCode}|${cleanNdc(row.ndc)}`)) anyGroup.set(`${row.pharmacyCode}|${cleanNdc(row.ndc)}`, Number(row.stockSize));
  }
  return { exact, anyGroup };
}

function isOneStockSizeCycle(claim: PioneerClaim, stockSizeMap: ReturnType<typeof buildStockSizeMap>) {
  const daysSupply = Number(claim.daysSupply || 0);
  if (![7, 14, 28].includes(daysSupply)) return false;
  const quantity = Number(claim.quantity || 0);
  const stockSize = stockSizeMap.exact.get(`${claim.pharmacyCode}|${cleanNdc(claim.ndc)}`)
    ?? stockSizeMap.anyGroup.get(`${claim.pharmacyCode}|${cleanNdc(claim.ndc)}`)
    ?? 0;
  return stockSize > 0 && Math.abs(quantity - stockSize) < 0.0001;
}

function buildInventoryReferenceMap(rows: { pharmacyCode: string; ndc: string; drugName: string; strength: string | null; dispensingUnit: string | null }[]) {
  const map = new Map<string, { drugName: string; strength: string | null; dispensingUnit: string | null }>();
  for (const row of rows) {
    const key = `${row.pharmacyCode}|${cleanNdc(row.ndc)}`;
    if (!map.has(key)) map.set(key, { drugName: row.drugName, strength: row.strength, dispensingUnit: row.dispensingUnit });
  }
  return map;
}

function daySupplyReferenceText(
  claim: PioneerClaim,
  inventoryReferenceMap: ReturnType<typeof buildInventoryReferenceMap>,
) {
  const reference = inventoryReferenceMap.get(`${claim.pharmacyCode}|${cleanNdc(claim.ndc)}`);
  return [claim.drugName, reference?.drugName, reference?.strength, reference?.dispensingUnit].filter(Boolean).join(' ');
}

function isPackageSensitiveDaySupplyClaim(
  claim: PioneerClaim,
  inventoryReferenceMap: ReturnType<typeof buildInventoryReferenceMap>,
) {
  const text = daySupplyReferenceText(claim, inventoryReferenceMap);
  const form = dosageFormKey(text);
  if (form === 'injectable' || form === 'inhaler' || form === 'neb' || form === 'drops') return true;
  return /insulin|flexpen|kwikpen|solostar|flextouch|vial|penfill|zepbound|trulicity|victoza|ozempic|wegovy|mounjaro|saxenda/i.test(text);
}

function isVariableDosePackageClaim(
  claim: PioneerClaim,
  stockSizeMap: ReturnType<typeof buildStockSizeMap>,
  inventoryReferenceMap: ReturnType<typeof buildInventoryReferenceMap>,
) {
  const quantity = Number(claim.quantity || 0);
  const daysSupply = Number(claim.daysSupply || 0);
  if (!quantity || !daysSupply) return false;
  const stockSize = stockSizeMap.exact.get(`${claim.pharmacyCode}|${cleanNdc(claim.ndc)}`)
    ?? stockSizeMap.anyGroup.get(`${claim.pharmacyCode}|${cleanNdc(claim.ndc)}`)
    ?? 0;
  if (stockSize <= 0 || Math.abs(quantity - stockSize) > 0.0001) return false;
  return isPackageSensitiveDaySupplyClaim(claim, inventoryReferenceMap);
}

function isCommonPackageDaysSupply(daysSupply: number) {
  return [7, 14, 28, 30, 31, 42, 56, 63, 84, 90].includes(Number(daysSupply || 0));
}

function isLikelyPackagedInjectableClaim(
  claim: PioneerClaim,
  stockSizeMap: ReturnType<typeof buildStockSizeMap>,
  inventoryReferenceMap: ReturnType<typeof buildInventoryReferenceMap>,
) {
  if (!isPackageSensitiveDaySupplyClaim(claim, inventoryReferenceMap)) return false;
  const quantity = Number(claim.quantity || 0);
  const daysSupply = Number(claim.daysSupply || 0);
  if (!quantity || !daysSupply || !isCommonPackageDaysSupply(daysSupply)) return false;

  const stockSize = stockSizeMap.exact.get(`${claim.pharmacyCode}|${cleanNdc(claim.ndc)}`)
    ?? stockSizeMap.anyGroup.get(`${claim.pharmacyCode}|${cleanNdc(claim.ndc)}`)
    ?? 0;

  if (stockSize > 0) {
    const multiplier = quantity / stockSize;
    const roundedMultiplier = Math.round(multiplier);
    if (roundedMultiplier >= 1 && roundedMultiplier <= 3 && Math.abs(multiplier - roundedMultiplier) <= 0.05) return true;
    if (Math.abs(multiplier - 0.5) <= 0.05 || Math.abs(multiplier - 1.5) <= 0.05) return true;
  }

  return quantity <= 12;
}

function hasAtypicalDaySupply(
  claim: PioneerClaim,
  stockSizeMap: ReturnType<typeof buildStockSizeMap>,
  inventoryReferenceMap: ReturnType<typeof buildInventoryReferenceMap>,
) {
  const quantity = Number(claim.quantity || 0);
  const daysSupply = Number(claim.daysSupply || 0);
  if (!quantity || !daysSupply) return false;
  if (isOneStockSizeCycle(claim, stockSizeMap)) return false;
  if (isVariableDosePackageClaim(claim, stockSizeMap, inventoryReferenceMap)) return false;
  const unitsPerDay = quantity / daysSupply;
  if (unitsPerDay < 0.35 && isLikelyPackagedInjectableClaim(claim, stockSizeMap, inventoryReferenceMap)) return false;
  if (isPackageSensitiveDaySupplyClaim(claim, inventoryReferenceMap) && unitsPerDay < 0.35 && isCommonPackageDaysSupply(daysSupply)) return false;
  return unitsPerDay < 0.35 || unitsPerDay > 4.5;
}

function normalizeStrength(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/([0-9.]+)\s*mg/g, '$1mg')
    .replace(/([0-9.]+)\s*mcg/g, '$1mcg')
    .replace(/([0-9.]+)\s*g/g, '$1g')
    .replace(/([0-9.]+)\s*ml/g, '$1ml')
    .replace(/([0-9.]+)\s*unit(?:s)?/g, '$1unit')
    .replace(/([0-9.]+)\s*%/g, '$1pct')
    .trim();
}

function extractStrengthFromName(value: string | null | undefined): string {
  const text = String(value || '');
  const matches = text.match(/([0-9.]+\s*(?:mg|mcg|g|ml|unit|units|%)(?:\/[0-9.]+\s*(?:ml|g))?)/i);
  return normalizeStrength(matches?.[1] ?? '');
}

function drugStem(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeGcn(value: string | null | undefined) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

const DOSAGE_FORM_PATTERNS: Array<[RegExp, string]> = [
  [/tab(?:let)?s?|tabs/i, 'tablet'],
  [/cap(?:sule)?s?/i, 'capsule'],
  [/softgel/i, 'softgel'],
  [/inj(?:ection)?|pen|auto-?injector|syringe/i, 'injectable'],
  [/sol(?:ution)?|soln/i, 'solution'],
  [/susp(?:ension)?/i, 'suspension'],
  [/cream/i, 'cream'],
  [/ointment|oint/i, 'ointment'],
  [/gel/i, 'gel'],
  [/patch/i, 'patch'],
  [/drops?|oph|otic/i, 'drops'],
  [/inhal(?:er|ation)|hfa|dpi/i, 'inhaler'],
  [/neb(?:ulizer)?/i, 'neb'],
  [/kit/i, 'kit'],
];

function dosageFormKey(value: string | null | undefined) {
  const text = String(value || '');
  for (const [pattern, label] of DOSAGE_FORM_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return '';
}

function priceStrength(row: { drugName?: string | null; strength?: string | null }) {
  return normalizeStrength(row.strength) || extractStrengthFromName(row.drugName);
}

function displayStrength(row: { drugName?: string | null; strength?: string | null } | null | undefined) {
  if (!row) return '';
  return row.strength || extractStrengthFromName(row.drugName) || '';
}

function equivalenceBasisLabel(args: { gcn?: string | null; strength?: string | null; form?: string | null }) {
  const hasGcn = Boolean(normalizeGcn(args.gcn));
  const hasStrength = Boolean(args.strength);
  const hasForm = Boolean(args.form);
  if (hasGcn && hasStrength && hasForm) return 'GCN + strength + form';
  if (hasGcn && hasStrength) return 'GCN + strength';
  if (hasStrength && hasForm) return 'Drug + strength + form';
  if (hasStrength) return 'Drug + strength';
  return 'Strength unresolved';
}

function priceFamilyKey(row: { gcn?: string; genericName?: string | null; drugName?: string | null; strength?: string | null; unit?: string | null }) {
  const gcn = normalizeGcn(row.gcn);
  const stem = drugStem(row.genericName || row.drugName || '');
  const strength = priceStrength(row);
  const form = dosageFormKey(`${row.drugName || ''} ${row.genericName || ''} ${row.unit || ''}`) || 'na';
  return `${gcn ? `gcn:${gcn}` : `stem:${stem || 'unknown'}`}|${strength || 'unknown'}|${form}`;
}

function claimFamilyKey(claim: PioneerClaim, priceMaps: ReturnType<typeof buildPriceMaps>) {
  const ndc = cleanNdc(claim.ndc);
  const reference = priceMaps.byGroupExact.get(`${claim.inventoryGroup}|${ndc}`) || priceMaps.byAnyExact.get(ndc) || null;
  if (reference) return priceFamilyKey(reference);
  const stem = drugStem(claim.drugName);
  const strength = extractStrengthFromName(claim.drugName);
  const form = dosageFormKey(claim.drugName) || 'na';
  return `${stem ? `stem:${stem}` : 'stem:unknown'}|${strength || 'unknown'}|${form}`;
}

function payerBucket(name: string) {
  const payer = name.toLowerCase();
  if (payer.includes('caremark') || payer.includes('cvs')) return 'Caremark';
  if (payer.includes('express') || payer.includes('esi')) return 'Express Scripts';
  if (payer.includes('optum')) return 'Optum';
  if (payer.includes('humana')) return includesMedicaidMarker(name) ? 'Medicaid' : 'Humana';
  if (payer.includes('prime')) return 'Prime';
  if (includesMedicaidMarker(name)) return 'Medicaid';
  if (payer.includes('cash') || payer.includes('self-pay') || payer.includes('rx cash')) return 'Cash';
  return name || 'Unknown';
}

function claimKey(claim: PioneerClaim) {
  return `${claim.pharmacyCode}|${claim.rxNumber}|${claim.fillNumber}|${cleanNdc(claim.ndc)}`;
}

function paymentKey(row: MtfClaim) {
  return `${row.pharmacyCode}|${row.rxNumber}|${row.fillNumber}|${cleanNdc(row.ndc)}`;
}

function rxFillKey(pharmacyCode: string, rxNumber: string, fillNumber: number) {
  return `${pharmacyCode}|${rxNumber}|${fillNumber}`;
}

function rxOnlyKey(pharmacyCode: string, rxNumber: string) {
  return `${pharmacyCode}|${rxNumber}`;
}

function lookupExpectedSdra(claim: PioneerClaim) {
  if (claim.inventoryGroup === '340B') return 0;
  const unit = sdraMap.get(cleanNdc(claim.ndc));
  if (unit == null) return 0;
  return money(unit * Number(claim.quantity || 0));
}

function totalRemitForClaim(claim: PioneerClaim) {
  const primary = Number(claim.primaryRemitAmount || 0);
  const secondary = Number(claim.secondaryRemitAmount || 0);
  const combined = primary + secondary;
  if (combined !== 0) return money(combined);
  if (claim.primaryRemitAmount != null || claim.secondaryRemitAmount != null) return 0;
  if (claim.totalPricePaid != null) return money(Number(claim.totalPricePaid || 0));
  return null;
}

function acquisitionForClaim(claim: PioneerClaim, priceMaps: ReturnType<typeof buildPriceMaps>) {
  if (claim.acquisitionCost != null) return money(Number(claim.acquisitionCost || 0));
  const unitCost = priceMaps.byGroupExact.get(`${claim.inventoryGroup}|${cleanNdc(claim.ndc)}`)?.acquisitionCost;
  if (unitCost == null) return null;
  return money(Number(unitCost) * Number(claim.quantity || 0));
}

function payerDisplayName(claim: PioneerClaim) {
  if (claim.payerType === 'Cash') return claim.thirdPartyName || claim.primaryPayer || 'RX CASH';
  return claim.thirdPartyName || claim.primaryPayer || 'Unknown';
}

function pharmacyNameOf(code: string) {
  return PHARMACIES.find((row) => row.code === code)?.name || code;
}

function unexpectedPaymentAmount(row: MtfClaim) {
  return Number(row.rawPaymentAmount ?? row.manufacturerPaymentAmount ?? 0);
}

function validPaymentAmount(row: MtfClaim) {
  return row.unexpectedPayment ? 0 : Number(row.manufacturerPaymentAmount || 0);
}

function severityRank(value: string | null | undefined) {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;
  return 0;
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function recentWindowCutoff(claims: PioneerClaim[]) {
  const dates = claims.map((claim) => claim.fillDate || claim.claimDate).filter(Boolean) as string[];
  if (!dates.length) return null;
  const latest = new Date([...dates].sort().slice(-1)[0]);
  latest.setDate(latest.getDate() - 14);
  return latest;
}

function positiveShortfall(value: number) {
  return value > 0 ? value : 0;
}

function grossProfitTuple(claim: PioneerClaim, priceMaps: ReturnType<typeof buildPriceMaps>) {
  const remit = totalRemitForClaim(claim);
  const acquisition = acquisitionForClaim(claim, priceMaps);
  if (remit == null || acquisition == null) return null;
  return { remit, acquisition, grossProfit: money(remit - acquisition) };
}

function percent(value: number, denominator: number) {
  return denominator ? Number(((value / denominator) * 100).toFixed(1)) : 0;
}

function classifySdraStatus(args: {
  claim: PioneerClaim;
  expected: number;
  netPayment: number;
  pendingCutoff: Date | null;
  unexpectedPaymentCount?: number;
}) {
  const { claim, expected, netPayment, pendingCutoff, unexpectedPaymentCount } = args;
  const fillDate = claim.fillDate ? new Date(claim.fillDate) : claim.claimDate ? new Date(claim.claimDate) : null;

  if ((unexpectedPaymentCount || 0) > 0) {
    return claim.inventoryGroup === '340B' ? 'Unexpected 340B payment value' : 'Unexpected RX payment value';
  }

  if (claim.inventoryGroup === '340B') {
    if (netPayment > 1) return '340B paid and should not have been';
    if (netPayment < -1) return '340B adjustment posted';
    return '340B no payment expected';
  }

  if (Math.abs(netPayment - expected) <= 1) return 'RX paid correctly';
  if (netPayment > 1) return 'RX not paid correctly';
  if (fillDate && pendingCutoff && fillDate >= pendingCutoff) return 'Pending payment';
  return 'RX not paid and should have been';
}

function buildPriceMaps(priceRows: PriceRow[]) {
  const byGroupExact = new Map<string, PriceRow>();
  const byAnyExact = new Map<string, PriceRow>();
  const byGroupFamily = new Map<string, PriceRow[]>();
  const weightedFamily = new Map<string, PriceRow[]>();

  const rowScore = (row: PriceRow) =>
    Number(Boolean(normalizeGcn(row.gcn)))
    + Number(Boolean(priceStrength(row)))
    + Number(Boolean(row.genericName))
    + Number(Boolean(dosageFormKey(`${row.drugName || ''} ${row.genericName || ''} ${row.unit || ''}`)));

  for (const row of priceRows) {
    const ndc = cleanNdc(row.ndc);
    byGroupExact.set(`${row.inventoryGroup}|${ndc}`, row);
    const existing = byAnyExact.get(ndc);
    if (!existing || rowScore(row) > rowScore(existing)) byAnyExact.set(ndc, row);
    const familyKey = priceFamilyKey(row);
    const familyBucket = `${row.inventoryGroup}|${familyKey}`;
    if (!byGroupFamily.has(familyBucket)) byGroupFamily.set(familyBucket, []);
    byGroupFamily.get(familyBucket)!.push(row);
    if (!weightedFamily.has(familyKey)) weightedFamily.set(familyKey, []);
    weightedFamily.get(familyKey)!.push(row);
  }

  for (const rows of byGroupFamily.values()) rows.sort((a, b) => Number(a.acquisitionCost || Infinity) - Number(b.acquisitionCost || Infinity));
  for (const rows of weightedFamily.values()) rows.sort((a, b) => Number(a.acquisitionCost || Infinity) - Number(b.acquisitionCost || Infinity));

  return { byGroupExact, byAnyExact, byGroupFamily, weightedFamily };
}

export function getAppState(pharmacyCode?: PharmacyCode, filters?: { startDate?: string; endDate?: string; iraStartDate?: string; iraEndDate?: string }) {
  const db = readDb();
  const startDate = filters?.startDate;
  const endDate = filters?.endDate;
  const iraStartDate = filters?.iraStartDate ?? startDate;
  const iraEndDate = filters?.iraEndDate ?? endDate;

  const scopedPioneerClaims = pharmacyCode ? db.pioneerClaims.filter((row) => row.pharmacyCode === pharmacyCode) : db.pioneerClaims;
  const pioneerClaimsAll = scopedPioneerClaims.filter((row) => claimInDateRange(row, startDate, endDate));
  const pioneerClaims = activeClaimsOnly(pioneerClaimsAll);
  const generalAnalyticsClaims = pioneerClaims.filter((row) => claimYear(row) !== 2025);
  const scopedMtfClaims = pharmacyCode ? db.mtfClaims.filter((row) => row.pharmacyCode === pharmacyCode) : db.mtfClaims;
  const mtfClaims = scopedMtfClaims.filter((row) => mtfInDateRange(row, startDate, endDate));
  const inventoryRows = pharmacyCode ? db.inventoryRows.filter((row) => row.pharmacyCode === pharmacyCode) : db.inventoryRows;
  const priceRows = db.priceRows;
  const uploads = db.uploads.filter((row) => dateWithinRange(normalizeIsoDate(row.uploadedAt), startDate, endDate));

  const priceMaps = buildPriceMaps(priceRows);
  const pendingCutoff = recentWindowCutoff(pioneerClaims);
  const reviewDecisionMap = new Map(db.reviewDecisions.map((item) => [item.targetKey, item.label]));
  const stockSizeMap = buildStockSizeMap(inventoryRows);
  const inventoryReferenceMap = buildInventoryReferenceMap(inventoryRows);

  const kpi = {
    pioneerClaims: generalAnalyticsClaims.length,
    inactiveClaimsExcluded: pioneerClaimsAll.length - pioneerClaims.length,
    medDClaims: generalAnalyticsClaims.filter((row) => row.payerType === 'Med D').length,
    inventoryItems: inventoryRows.length,
    totalInventoryValue: money(sum(inventoryRows.map((row) => Math.max(row.onHand, 0) * Number(row.lastCostPaid || 0)))),
    '340bClaims': generalAnalyticsClaims.filter((row) => row.inventoryGroup === '340B').length,
    rxClaims: generalAnalyticsClaims.filter((row) => row.inventoryGroup === 'RX').length,
    uploadedFiles: uploads.length,
    mtfRows: mtfClaims.filter((row) => row.sourceType === 'mtf').length,
    adjustmentRows: mtfClaims.filter((row) => row.sourceType === 'mtf_adjustment').length,
    priceRows: priceRows.length
  };

  const pharmacyCards = PHARMACIES.map((pharmacy) => {
    const claims = activeClaimsOnly(db.pioneerClaims.filter((row) => row.pharmacyCode === pharmacy.code && claimInDateRange(row, startDate, endDate)))
      .filter((row) => claimYear(row) !== 2025);
    const inventory = db.inventoryRows.filter((row) => row.pharmacyCode === pharmacy.code);
    const mtf = db.mtfClaims.filter((row) => row.pharmacyCode === pharmacy.code && mtfInDateRange(row, startDate, endDate));
    return {
      ...pharmacy,
      claimCount: claims.length,
      medDClaims: claims.filter((row) => row.payerType === 'Med D').length,
      inventoryValue: money(sum(inventory.map((row) => Math.max(row.onHand, 0) * Number(row.lastCostPaid || 0)))),
      mtfPayments: money(sum(mtf.filter((row) => row.sourceType === 'mtf').map((row) => validPaymentAmount(row)))),
      mtfAdjustments: money(sum(mtf.filter((row) => row.sourceType === 'mtf_adjustment').map((row) => validPaymentAmount(row)))),
      unexpectedMtfRows: mtf.filter((row) => row.unexpectedPayment).length,
    };
  });

  const mtfByExact = new Map<string, MtfClaim[]>();
  const mtfByRxFill = new Map<string, MtfClaim[]>();
  const mtfByRxOnly = new Map<string, MtfClaim[]>();
  for (const row of mtfClaims) {
    if (!mtfByExact.has(paymentKey(row))) mtfByExact.set(paymentKey(row), []);
    mtfByExact.get(paymentKey(row))!.push(row);
    if (!mtfByRxFill.has(rxFillKey(row.pharmacyCode, row.rxNumber, row.fillNumber))) mtfByRxFill.set(rxFillKey(row.pharmacyCode, row.rxNumber, row.fillNumber), []);
    mtfByRxFill.get(rxFillKey(row.pharmacyCode, row.rxNumber, row.fillNumber))!.push(row);
    if (!mtfByRxOnly.has(rxOnlyKey(row.pharmacyCode, row.rxNumber))) mtfByRxOnly.set(rxOnlyKey(row.pharmacyCode, row.rxNumber), []);
    mtfByRxOnly.get(rxOnlyKey(row.pharmacyCode, row.rxNumber))!.push(row);
  }

  const usedMtfIds = new Set<string>();
  const sdraClaims = pioneerClaims.filter((claim) => claim.payerType === 'Med D' && sdraMap.has(cleanNdc(claim.ndc)));

  const sdraResultsRaw = sdraClaims.map((claim) => {
    const candidateSets = [
      mtfByExact.get(claimKey(claim)) ?? [],
      mtfByRxFill.get(rxFillKey(claim.pharmacyCode, claim.rxNumber, claim.fillNumber)) ?? [],
      mtfByRxOnly.get(rxOnlyKey(claim.pharmacyCode, claim.rxNumber)) ?? []
    ];
    let matched: MtfClaim[] = [];
    let matchLevel = 'none';
    for (const [idx, candidateSet] of candidateSets.entries()) {
      const available = candidateSet.filter((row) => !usedMtfIds.has(row.id));
      if (available.length) {
        matched = available;
        matchLevel = idx === 0 ? 'exact' : idx === 1 ? 'rx+fill' : 'rx-only';
        break;
      }
    }
    matched.forEach((row) => usedMtfIds.add(row.id));

    const expected = lookupExpectedSdra(claim);
    const validPositive = matched.filter((row) => validPaymentAmount(row) > 0);
    const validNegative = matched.filter((row) => validPaymentAmount(row) < 0);
    const unexpectedRows = matched.filter((row) => row.unexpectedPayment);
    const grossPayment = money(sum(validPositive.map((row) => validPaymentAmount(row))));
    const adjustmentAmount = money(sum(validNegative.map((row) => validPaymentAmount(row))));
    const netPayment = money(sum(matched.map((row) => validPaymentAmount(row))));
    const rawPayment = money(sum(matched.map((row) => unexpectedPaymentAmount(row))));
    const variance = money(netPayment - expected);
    const status = classifySdraStatus({ claim, expected, netPayment, pendingCutoff, unexpectedPaymentCount: unexpectedRows.length });
    const flagged = unexpectedRows.length > 0
      || status === 'RX not paid correctly'
      || status === 'RX not paid and should have been'
      || status === '340B paid and should not have been';
    const severity = unexpectedRows.length > 0 || status === '340B paid and should not have been'
      ? 'high'
      : flagged
        ? 'medium'
        : 'low';
    const flagReason = unexpectedRows.length
      ? unexpectedRows.map((row) => row.unexpectedReason || 'Unexpected payment amount').join('; ')
      : flagged
        ? status
        : null;

    return {
      id: claimKey(claim),
      pharmacyCode: claim.pharmacyCode,
      pharmacyName: pharmacyNameOf(claim.pharmacyCode),
      claim,
      expected,
      grossPayment,
      adjustmentAmount,
      actual: netPayment,
      rawActual: rawPayment,
      variance,
      status,
      matchLevel,
      matchedRows: matched.length,
      matchedIcns: matched.map((row) => row.icn).filter(Boolean),
      unexpectedPaymentCount: unexpectedRows.length,
      unexpectedPaymentAmount: money(sum(unexpectedRows.map((row) => unexpectedPaymentAmount(row)))),
      flagged,
      severity,
      flagReason,
      details: {
        columns: ['Source','ICN','Amount Used','Raw Amount','Unexpected','Reason','Receipt Date','Pricing Method'],
        rows: matched.map((row) => [
          row.sourceType,
          row.icn || '',
          money(validPaymentAmount(row)),
          money(unexpectedPaymentAmount(row)),
          row.unexpectedPayment ? 'Yes' : 'No',
          row.unexpectedReason || '',
          row.receiptDate || '',
          row.pricingMethod || '',
        ])
      }
    };
  }).sort((a, b) => Number(b.flagged) - Number(a.flagged) || Math.abs(b.variance) - Math.abs(a.variance) || b.expected - a.expected);
  const sdraResults = applyReviewDecisions(sdraResultsRaw, reviewDecisionMap);

  const unmatchedMtfRaw = mtfClaims
    .filter((row) => !usedMtfIds.has(row.id))
    .map((row) => ({
      id: row.id,
      pharmacyCode: row.pharmacyCode,
      pharmacyName: pharmacyNameOf(row.pharmacyCode),
      rxNumber: row.rxNumber,
      fillNumber: row.fillNumber,
      ndc: row.ndc,
      drugName: row.drugName,
      amount: validPaymentAmount(row),
      rawAmount: unexpectedPaymentAmount(row),
      sourceType: row.sourceType,
      flagged: true,
      flagReason: row.unexpectedPayment ? row.unexpectedReason || 'Unexpected payment amount' : 'No Pioneer match'
    }))
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || Math.abs(b.rawAmount) - Math.abs(a.rawAmount));

  const unmatchedMtf = applyReviewDecisions(unmatchedMtfRaw, reviewDecisionMap);

  const sdraDashboardByPharmacy = PHARMACIES.map((pharmacy) => {
    const rows = sdraResults.filter((row) => row.claim.pharmacyCode === pharmacy.code);
    const count = (status: string) => rows.filter((row) => row.status === status).length;
    const eligibleRxRows = pioneerClaims.filter((claim) => claim.pharmacyCode === pharmacy.code && claim.inventoryGroup === 'RX' && claim.payerType === 'Med D' && sdraMap.has(cleanNdc(claim.ndc)));
    const flaggedRows = rows.filter((row) => row.flagged);
    return {
      id: pharmacy.code,
      pharmacyCode: pharmacy.code,
      pharmacyName: pharmacy.name,
      eligibleClaims: eligibleRxRows.length,
      rxPaidCorrectly: count('RX paid correctly'),
      rxNotPaid: count('RX not paid and should have been'),
      rxIncorrect: count('RX not paid correctly') + count('Unexpected RX payment value'),
      pending: count('Pending payment'),
      b340NoPaymentExpected: count('340B no payment expected'),
      b340ImproperPayment: count('340B paid and should not have been') + count('Unexpected 340B payment value'),
      b340AdjustmentPosted: count('340B adjustment posted'),
      unexpectedPaymentRows: count('Unexpected RX payment value') + count('Unexpected 340B payment value'),
      totalExpected: money(sum(rows.map((row) => row.expected))),
      totalActual: money(sum(rows.map((row) => row.actual))),
      totalVariance: money(sum(rows.map((row) => row.variance))),
      flagged: flaggedRows.length > 0,
      flagReason: flaggedRows.length ? `${flaggedRows.length} SDRA items require review` : null,
      details: {
        columns: ['Rx','Drug','Group','Expected','Actual','Variance','Status','Unexpected','Match'],
        rows: rows.map((row) => [
          row.claim.rxNumber,
          row.claim.drugName,
          row.claim.inventoryGroup,
          money(row.expected),
          money(row.actual),
          money(row.variance),
          row.status,
          row.unexpectedPaymentCount ? row.unexpectedPaymentCount : '',
          row.matchLevel,
        ])
      }
    };
  }).filter((row) => row.eligibleClaims > 0 || row.b340ImproperPayment > 0 || row.b340AdjustmentPosted > 0 || row.unexpectedPaymentRows > 0 || !pharmacyCode)
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || (b.totalVariance - a.totalVariance));

  const claimGroups = Object.values(groupBy(pioneerClaims, (claim) => `${claim.pharmacyCode}|${claim.ndc}|${claim.inventoryGroup}`));
  const claimsAnalysisRaw = claimGroups.map((claims) => {
    const first = claims[0];
    const ds = claims.map((claim) => Number(claim.daysSupply || 0)).filter((value) => value > 0);
    const atypicalDaysSupplyCount = claims.filter((claim) => hasAtypicalDaySupply(claim, stockSizeMap, inventoryReferenceMap)).length;
    const payerSpread = new Set(claims.map((claim) => payerBucket(claim.primaryPayer))).size;
    const cashClaims = claims.filter((claim) => claim.payerType === 'Cash').length;
    const reimbursement = claims.flatMap((claim) => {
      const value = totalRemitForClaim(claim);
      return value != null ? [value] : [];
    });
    const currentPrice = priceMaps.byGroupExact.get(`${first.inventoryGroup}|${cleanNdc(first.ndc)}`);
    const claimAcquisition = claims.flatMap((claim) => {
      const value = acquisitionForClaim(claim, priceMaps);
      return value != null ? [value] : [];
    });
    const estimatedAcquisition = claimAcquisition.length ? money(sum(claimAcquisition)) : null;
    const grossProfitValues = claims.flatMap((claim) => {
      const remit = totalRemitForClaim(claim);
      const acquisition = acquisitionForClaim(claim, priceMaps);
      return remit != null && acquisition != null ? [money(remit - acquisition)] : [];
    });
    const totalGrossProfit = grossProfitValues.length ? money(sum(grossProfitValues)) : null;
    const avgGrossProfitPerRx = grossProfitValues.length ? Number(average(grossProfitValues).toFixed(2)) : null;
    const negativeGrossProfitClaims = grossProfitValues.filter((value) => value < 0).length;
    const atypicalRatio = ratio(atypicalDaysSupplyCount, claims.length);
    const concentrationRisk = payerSpread <= 1 && claims.length >= 12;
    const materialNegativeMargin = negativeGrossProfitClaims >= 3 && ((totalGrossProfit ?? 0) <= -75 || (avgGrossProfitPerRx ?? 0) <= -10);
    const recurringBrandCash = cashClaims >= 3 && /brand/i.test(String(first.brandGeneric || ''));
    const recurringDaySupplyIssue = atypicalDaysSupplyCount >= 3 && atypicalRatio >= 0.4;
    const actionableFlags: string[] = [];
    if (materialNegativeMargin) actionableFlags.push('Material negative gross profit');
    if (recurringDaySupplyIssue) actionableFlags.push('Recurring atypical day-supply pattern');
    if (recurringBrandCash) actionableFlags.push('Recurring brand cash claims');
    if (concentrationRisk) actionableFlags.push('High payer concentration');
    const opportunity = actionableFlags[0]
      || (currentPrice ? 'Volume driver' : 'Upload price files for cost modeling');
    const flagged = actionableFlags.length > 0;
    const severity = materialNegativeMargin ? 'high' : (flagged ? 'medium' : 'low');
    return {
      id: `${first.pharmacyCode}|${first.ndc}|${first.inventoryGroup}`,
      pharmacyCode: first.pharmacyCode,
      pharmacyName: pharmacyNameOf(first.pharmacyCode),
      ndc: first.ndc,
      drugName: first.drugName,
      inventoryGroup: first.inventoryGroup,
      totalClaims: claims.length,
      medDClaims: claims.filter((claim) => claim.payerType === 'Med D').length,
      rxMix: claims.filter((claim) => claim.inventoryGroup === 'RX').length,
      b340Mix: claims.filter((claim) => claim.inventoryGroup === '340B').length,
      cashClaims,
      avgDaysSupply: ds.length ? Number(average(ds).toFixed(1)) : null,
      atypicalDaysSupplyCount,
      payerSpread,
      estimatedAcquisition,
      avgRecordedRevenuePerRx: reimbursement.some((value) => value > 0) ? Number(average(reimbursement.filter((value) => value > 0)).toFixed(2)) : null,
      totalGrossProfit,
      avgGrossProfitPerRx,
      negativeGrossProfitClaims,
      opportunity,
      flagged,
      severity,
      flagReason: flagged ? actionableFlags.join('; ') : null,
      details: {
        columns: ['Rx','Fill','Date','Payer','Plan Type','Claim Type','Current Status','Qty','Days Supply','Remit','Acquisition'],
        rows: claims.map((claim) => [
          claim.rxNumber,
          claim.fillNumber,
          claim.fillDate || claim.claimDate || '',
          payerDisplayName(claim),
          claim.payerType,
          claim.claimStatus,
          claim.currentTransactionStatus || claim.normalizedClaimLifecycle,
          claim.quantity,
          claim.daysSupply ?? '',
          money(totalRemitForClaim(claim) || 0),
          (() => { const acq = acquisitionForClaim(claim, priceMaps); return acq != null ? money(acq) : ''; })(),
        ])
      }
    };
  }).sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.totalClaims - a.totalClaims || a.pharmacyCode.localeCompare(b.pharmacyCode));
  const claimsAnalysis = applyReviewDecisions(claimsAnalysisRaw, reviewDecisionMap);

  const flaggedClaims = pioneerClaims.map((claim) => {
    const findings: string[] = [];
    if (hasAtypicalDaySupply(claim, stockSizeMap, inventoryReferenceMap)) findings.push('Atypical quantity/day-supply ratio');
    if (claim.payerType === 'Cash' && /brand|b$/i.test(String(claim.brandGeneric || ''))) findings.push('Brand cash claim');
    if (claim.inventoryGroup === '340B' && isMedicaidClaim(claim)) findings.push('Medicaid should not dispense from 340B');
    return findings.length ? { claim, findings } : null;
  }).filter(Boolean);

  const thirdPartyClaims = pioneerClaims.filter((claim) => payerDisplayName(claim) !== 'Unknown' || claim.payerType === 'Cash');
  const payerGroups = Object.entries(groupBy(thirdPartyClaims, (claim) => `${claim.pharmacyCode}|${payerDisplayName(claim)}`));
  const thirdPartyRaw = payerGroups.map(([groupKey, claims]) => {
    const first = claims[0];
    const payer = payerDisplayName(first);
    const remitValues = claims.flatMap((claim) => {
      const value = totalRemitForClaim(claim);
      return value != null ? [value] : [];
    });
    const acquisitionValues = claims.flatMap((claim) => {
      const value = acquisitionForClaim(claim, priceMaps);
      return value != null ? [value] : [];
    });
    const avgRemitPerRx = remitValues.length ? Number(average(remitValues).toFixed(2)) : null;
    const avgAcquisitionCostPerRx = acquisitionValues.length ? Number(average(acquisitionValues).toFixed(2)) : null;
    const grossProfitPerRx = avgRemitPerRx != null && avgAcquisitionCostPerRx != null ? Number((avgRemitPerRx - avgAcquisitionCostPerRx).toFixed(2)) : null;
    const payerType = Object.entries(groupBy(claims, (claim) => claim.payerType)).sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? 'Other';
    const missingData = grossProfitPerRx == null;
    const materialNegative = grossProfitPerRx != null && (grossProfitPerRx < -5 || (grossProfitPerRx < 0 && claims.length >= 8));
    const materiallyLow = grossProfitPerRx != null && grossProfitPerRx >= -5 && grossProfitPerRx < 5 && claims.length >= 12;
    const performanceFlag = missingData
      ? (claims.length >= 12 ? 'Missing acquisition or remit data' : 'Monitor data completeness')
      : materialNegative
        ? 'Negative gross profit'
        : materiallyLow
          ? 'Low gross profit'
          : 'Healthy';
    const flagged = materialNegative || materiallyLow || (missingData && claims.length >= 12);
    const severity = materialNegative || (missingData && claims.length >= 20) ? 'high' : (flagged ? 'medium' : 'low');
    return {
      id: groupKey,
      pharmacyCode: first.pharmacyCode,
      pharmacyName: pharmacyNameOf(first.pharmacyCode),
      payer,
      payerType,
      totalClaims: claims.length,
      medDClaims: claims.filter((claim) => claim.payerType === 'Med D').length,
      b340Rate: Number(((claims.filter((claim) => claim.inventoryGroup === '340B').length / Math.max(claims.length, 1)) * 100).toFixed(1)),
      ndcBreadth: new Set(claims.map((claim) => claim.ndc)).size,
      totalRemit: remitValues.length ? Number(sum(remitValues).toFixed(2)) : null,
      totalAcquisition: acquisitionValues.length ? Number(sum(acquisitionValues).toFixed(2)) : null,
      avgRemitPerRx,
      avgAcquisitionCostPerRx,
      grossProfitPerRx,
      performanceFlag,
      flagged,
      severity,
      flagReason: flagged ? performanceFlag : null,
      details: {
        columns: ['Rx','Date','Drug','Inventory','Remit','Acquisition','BIN','PCN','Group'],
        rows: claims.map((claim) => [
          claim.rxNumber,
          claim.fillDate || claim.claimDate || '',
          claim.drugName,
          claim.inventoryGroup,
          money(totalRemitForClaim(claim) || 0),
          (() => { const acq = acquisitionForClaim(claim, priceMaps); return acq != null ? money(acq) : ''; })(),
          claim.bin || '',
          claim.pcn || '',
          claim.groupNumber || '',
        ])
      }
    };
  }).sort((a, b) => Number(b.flagged) - Number(a.flagged) || (a.grossProfitPerRx ?? Infinity) - (b.grossProfitPerRx ?? Infinity) || b.totalClaims - a.totalClaims);
  const thirdParty = applyReviewDecisions(thirdPartyRaw, reviewDecisionMap);

  const inventoryByKey = Object.values(groupBy(inventoryRows, (row) => `${row.pharmacyCode}|${row.ndc}`));
  const inventoryManagementRaw = inventoryByKey.map((rows) => {
    const first = rows[0];
    const totalOnHand = sum(rows.map((row) => row.onHand));
    const rxOnHand = sum(rows.filter((row) => row.inventoryGroup === 'RX').map((row) => row.onHand));
    const b340OnHand = sum(rows.filter((row) => row.inventoryGroup === '340B').map((row) => row.onHand));
    const usageClaims = pioneerClaims.filter((claim) => claim.pharmacyCode === first.pharmacyCode && cleanNdc(claim.ndc) === cleanNdc(first.ndc));
    const totalQty30d = sum(usageClaims.map((claim) => Number(claim.quantity || 0)));
    const avgDaily = totalQty30d / 30;
    const optimalDays = first.brandOrGeneric === 'Brand' ? 3 : 5;
    const daysOnHand = avgDaily > 0 ? totalOnHand / avgDaily : 999;
    const reorderPoint = rows.find((row) => row.inventoryGroup === 'RX')?.reorderPoint ?? null;
    const rxNeedsReorder = reorderPoint != null ? rxOnHand <= reorderPoint : rxOnHand < 0;
    const b340NeedsReplenishment = b340OnHand < 0;
    const expensiveBrand = first.brandOrGeneric === 'Brand' && Number(first.lastCostPaid || 0) >= 200;
    let status = 'Healthy';
    if (b340NeedsReplenishment) status = 'Replenish 340B';
    else if (rxNeedsReorder) status = 'Reorder RX';
    else if (!expensiveBrand && daysOnHand > 30 && sum(rows.map((row) => Math.max(row.onHand, 0) * Number(row.lastCostPaid || 0))) >= 250) status = 'Overstock';
    else if (!expensiveBrand && avgDaily >= 1 && daysOnHand < optimalDays * 0.5) status = 'Understock';

    const lastMovement = [...rows.map((row) => row.lastFillDate), ...rows.map((row) => row.lastReceivedDate)].filter(Boolean).sort().slice(-1)[0];
    if (lastMovement) {
      const daysSince = (Date.now() - new Date(lastMovement).getTime()) / 86400000;
      if (daysSince >= 28 && totalOnHand >= Number(first.stockSize || 0)) status = 'Return candidate';
    }

    const flagged = ['Replenish 340B', 'Reorder RX', 'Return candidate'].includes(status)
      || (status === 'Overstock' && sum(rows.map((row) => Math.max(row.onHand, 0) * Number(row.lastCostPaid || 0))) >= 500)
      || (status === 'Understock' && avgDaily >= 2);
    const severity = status === 'Replenish 340B' || status === 'Return candidate' ? 'high' : (flagged ? 'medium' : 'low');
    return {
      id: `${first.pharmacyCode}|${first.ndc}`,
      pharmacyCode: first.pharmacyCode,
      pharmacyName: pharmacyNameOf(first.pharmacyCode),
      ndc: first.ndc,
      drugName: first.drugName,
      totalOnHand,
      rxOnHand,
      b340OnHand,
      daysOnHand: Number(daysOnHand.toFixed(1)),
      inventoryValue: money(sum(rows.map((row) => Math.max(row.onHand, 0) * Number(row.lastCostPaid || 0)))),
      reorderPoint,
      status,
      inventoryGroupMix: rows.map((row) => `${row.inventoryGroup}:${row.onHand}`).join(' | '),
      flagged,
      severity,
      flagReason: flagged ? status : null,
      details: {
        columns: ['Group','On Hand','Stock Size','Last Cost','Reorder','Last Fill','Last Received'],
        rows: rows.map((row) => [
          row.inventoryGroup,
          row.onHand,
          row.stockSize ?? '',
          row.lastCostPaid != null ? money(row.lastCostPaid) : '',
          row.reorderPoint ?? '',
          row.lastFillDate || '',
          row.lastReceivedDate || '',
        ])
      }
    };
  }).sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.inventoryValue - a.inventoryValue);
  const inventoryManagement = applyReviewDecisions(inventoryManagementRaw, reviewDecisionMap);

  const familyClaimMix = Object.entries(groupBy(pioneerClaims, (claim) => claimFamilyKey(claim, priceMaps))).reduce<Record<string, { rxRatio: number; b340Ratio: number }>>((acc, [key, claims]) => {
    const total = claims.length || 1;
    acc[key] = {
      rxRatio: claims.filter((claim) => claim.inventoryGroup === 'RX').length / total,
      b340Ratio: claims.filter((claim) => claim.inventoryGroup === '340B').length / total
    };
    return acc;
  }, {});

  const ndcOptimizationRaw = claimGroups.map((claims) => {
    const first = claims[0];
    const ndc = cleanNdc(first.ndc);
    const familyKey = claimFamilyKey(first, priceMaps);
    const currentAnyRow = priceMaps.byAnyExact.get(ndc) || null;
    const groupExact = priceMaps.byGroupExact.get(`${first.inventoryGroup}|${ndc}`) || currentAnyRow;
    const resolvedStrength = groupExact ? priceStrength(groupExact) : extractStrengthFromName(first.drugName);
    const resolvedForm = groupExact
      ? (dosageFormKey(`${groupExact.drugName || ''} ${groupExact.genericName || ''} ${groupExact.unit || ''}`) || dosageFormKey(first.drugName))
      : dosageFormKey(first.drugName);
    const equivalenceBasis = groupExact
      ? equivalenceBasisLabel({ gcn: groupExact.gcn, strength: resolvedStrength, form: resolvedForm })
      : equivalenceBasisLabel({ strength: resolvedStrength, form: resolvedForm });
    const comparisonReady = Boolean(groupExact) && Boolean(resolvedStrength) && !familyKey.includes('|unknown|');
    const sameGroupAlternates = comparisonReady
      ? (priceMaps.byGroupFamily.get(`${first.inventoryGroup}|${familyKey}`) || [])
          .filter((row) => cleanNdc(row.ndc) !== ndc && row.acquisitionCost != null)
          .sort((a, b) => Number(a.acquisitionCost || Infinity) - Number(b.acquisitionCost || Infinity))
      : [];
    const bestSameGroup = sameGroupAlternates[0] || null;
    const claimQty = sum(claims.map((claim) => Number(claim.quantity || 0)));
    const currentGroupCost = groupExact?.acquisitionCost ?? null;
    const sameGroupSavingsPerUnit = currentGroupCost != null && bestSameGroup?.acquisitionCost != null ? Number((currentGroupCost - bestSameGroup.acquisitionCost).toFixed(4)) : null;
    const sameGroupSavingsTotal = sameGroupSavingsPerUnit != null && sameGroupSavingsPerUnit > 0 ? money(sameGroupSavingsPerUnit * claimQty) : null;

    const mix = familyClaimMix[familyKey] || { rxRatio: 0.5, b340Ratio: 0.5 };
    const currentRxCost = priceMaps.byGroupExact.get(`RX|${ndc}`)?.acquisitionCost ?? currentGroupCost;
    const current340BCost = priceMaps.byGroupExact.get(`340B|${ndc}`)?.acquisitionCost ?? currentGroupCost;
    const weightedCurrentCost = currentRxCost != null || current340BCost != null ? Number((((currentRxCost ?? 0) * mix.rxRatio) + ((current340BCost ?? 0) * mix.b340Ratio)).toFixed(4)) : null;

    const weightedCandidates = comparisonReady
      ? (priceMaps.weightedFamily.get(familyKey) || []).map((row) => {
          const rxCost = priceMaps.byGroupExact.get(`RX|${cleanNdc(row.ndc)}`)?.acquisitionCost ?? row.acquisitionCost;
          const b340Cost = priceMaps.byGroupExact.get(`340B|${cleanNdc(row.ndc)}`)?.acquisitionCost ?? row.acquisitionCost;
          const weightedCost = rxCost != null || b340Cost != null ? Number((((rxCost ?? 0) * mix.rxRatio) + ((b340Cost ?? 0) * mix.b340Ratio)).toFixed(4)) : null;
          return { row, weightedCost };
        }).filter((item) => item.weightedCost != null).sort((a, b) => Number(a.weightedCost) - Number(b.weightedCost))
      : [];
    const bestWeighted = weightedCandidates[0] || null;
    const weightedSavingsPerUnit = weightedCurrentCost != null && bestWeighted?.weightedCost != null ? Number((weightedCurrentCost - bestWeighted.weightedCost).toFixed(4)) : null;
    const weightedSavingsTotal = weightedSavingsPerUnit != null && weightedSavingsPerUnit > 0 ? money(weightedSavingsPerUnit * claimQty) : null;

    const recommendation = !priceRows.length
      ? 'Upload RX and 340B price files'
      : !groupExact
        ? 'Current NDC not found in uploaded price files'
        : !comparisonReady
          ? 'Strength could not be matched for equivalent comparison'
          : sameGroupSavingsTotal && sameGroupSavingsTotal > 0
            ? 'Equivalent lower-cost NDC available in same inventory group'
            : weightedSavingsTotal && weightedSavingsTotal > 0
              ? 'Equivalent weighted lower-cost NDC available'
              : 'Current equivalent NDC appears competitive';
    const flagged = comparisonReady && ((sameGroupSavingsTotal || 0) >= 100 || (weightedSavingsTotal || 0) >= 100);
    const severity = (sameGroupSavingsTotal || 0) >= 500 || (weightedSavingsTotal || 0) >= 500 ? 'high' : (flagged ? 'medium' : 'low');
    const bestEquivalent = bestSameGroup || bestWeighted?.row || null;

    return {
      id: `${first.pharmacyCode}|${first.ndc}|${first.inventoryGroup}|NDC`,
      pharmacyCode: first.pharmacyCode,
      pharmacyName: pharmacyNameOf(first.pharmacyCode),
      ndc: first.ndc,
      drugName: first.drugName,
      inventoryGroup: first.inventoryGroup,
      claims: claims.length,
      totalQty: claimQty,
      strengthMatched: displayStrength(groupExact) || displayStrength(currentAnyRow) || extractStrengthFromName(first.drugName),
      equivalenceBasis,
      bestEquivalentDrug: bestEquivalent ? (bestEquivalent.genericName || bestEquivalent.drugName) : '',
      currentGroupCost,
      rxCost: priceMaps.byGroupExact.get(`RX|${ndc}`)?.acquisitionCost ?? null,
      b340Cost: priceMaps.byGroupExact.get(`340B|${ndc}`)?.acquisitionCost ?? null,
      weightedCurrentCost,
      bestSameGroupNdc: bestSameGroup?.ndc ?? null,
      sameGroupSavingsTotal,
      weightedBestNdc: bestWeighted?.row.ndc ?? null,
      weightedSavingsTotal,
      recommendation,
      flagged,
      severity,
      flagReason: flagged ? recommendation : null,
      details: {
        columns: ['Candidate Type','NDC','Drug','Strength','Group / Basis','Cost / Unit','Savings Opportunity'],
        rows: [
          ['Current dispensed', first.ndc, groupExact?.genericName || groupExact?.drugName || first.drugName, displayStrength(groupExact) || displayStrength(currentAnyRow) || extractStrengthFromName(first.drugName), `${first.inventoryGroup} · ${equivalenceBasis}`, currentGroupCost != null ? money(currentGroupCost) : '', ''],
          ['Same-group best', bestSameGroup?.ndc || '', bestSameGroup?.genericName || bestSameGroup?.drugName || '', displayStrength(bestSameGroup), bestSameGroup ? `${first.inventoryGroup} equivalent` : '', bestSameGroup?.acquisitionCost != null ? money(bestSameGroup.acquisitionCost) : '', sameGroupSavingsTotal != null ? money(sameGroupSavingsTotal) : ''],
          ['Weighted best', bestWeighted?.row.ndc || '', bestWeighted?.row.genericName || bestWeighted?.row.drugName || '', displayStrength(bestWeighted?.row || null), bestWeighted ? 'Weighted RX/340B equivalent' : '', bestWeighted?.weightedCost != null ? money(bestWeighted.weightedCost) : '', weightedSavingsTotal != null ? money(weightedSavingsTotal) : ''],
        ]
      }
    };
  }).sort((a, b) => Number(b.flagged) - Number(a.flagged) || (b.sameGroupSavingsTotal || b.weightedSavingsTotal || 0) - (a.sameGroupSavingsTotal || a.weightedSavingsTotal || 0));
  const ndcOptimization = applyReviewDecisions(ndcOptimizationRaw, reviewDecisionMap);

  const complianceRaw = pioneerClaims.flatMap((claim) => {
    const prescriberCategory = (claim.prescriberCategory || '').toLowerCase();
    const diabeticSupply = /test strip|lancet|sensor|meter|cgms|dexcom|freestyle|pen needle|needle/i.test(claim.drugName);
    const medicaidClaim = isMedicaidClaim(claim);
    const is340BEligible = /340b referral|340b/i.test(prescriberCategory);
    const isReferral = /340b referral/i.test(prescriberCategory);
    let finding: string | null = null;
    let severity: 'high' | 'medium' | 'low' = 'low';
    let flagged = true;

    if (medicaidClaim && claim.inventoryGroup === '340B') {
      finding = 'Medicaid plan dispensed from 340B inventory';
      severity = 'high';
    } else if (claim.inventoryGroup === '340B' && !is340BEligible) {
      finding = '340B inventory used without 340B-eligible prescriber';
      severity = 'high';
    } else if (claim.inventoryGroup === '340B' && isReferral) {
      finding = '340B referral verification queue';
      severity = 'low';
      flagged = false;
    } else if (claim.inventoryGroup === 'RX' && is340BEligible && !diabeticSupply && !medicaidClaim) {
      finding = 'RX inventory used for 340B-eligible prescriber';
      severity = 'medium';
    }

    return finding ? [{
      id: `${claim.pharmacyCode}|${claim.rxNumber}|${claim.fillNumber}|${claim.ndc}|compliance`,
      pharmacyCode: claim.pharmacyCode,
      pharmacyName: pharmacyNameOf(claim.pharmacyCode),
      claim,
      finding,
      severity,
      flagged,
      flagReason: flagged ? finding : null,
      details: {
        columns: ['Rx','Drug','Inventory','Payer','Prescriber Category','Claim Date'],
        rows: [[claim.rxNumber, claim.drugName, claim.inventoryGroup, payerDisplayName(claim), claim.prescriberCategory, claim.fillDate || claim.claimDate || '']]
      }
    }] : [];
  }).sort((a, b) => severityRank(b?.severity) - severityRank(a?.severity));
  const compliance = applyReviewDecisions(complianceRaw, reviewDecisionMap);

  const sdraSummary = {
    eligibleClaims: sdraResults.filter((row) => row.claim.inventoryGroup === 'RX').length,
    paidCorrectly: sdraResults.filter((row) => row.status === 'RX paid correctly').length,
    unpaidRx: sdraResults.filter((row) => row.status === 'RX not paid and should have been').length,
    incorrectRx: sdraResults.filter((row) => row.status === 'RX not paid correctly' || row.status === 'Unexpected RX payment value').length,
    noPaymentExpected340B: sdraResults.filter((row) => row.status === '340B no payment expected').length,
    improper340BPayments: sdraResults.filter((row) => row.status === '340B paid and should not have been' || row.status === 'Unexpected 340B payment value').length,
    adjustment340B: sdraResults.filter((row) => row.status === '340B adjustment posted').length,
    pending: sdraResults.filter((row) => row.status === 'Pending payment').length,
    unexpectedPayments: sdraResults.filter((row) => row.unexpectedPaymentCount > 0).length,
    totalExpected: money(sum(sdraResults.map((row) => row.expected))),
    totalActual: money(sum(sdraResults.map((row) => row.actual))),
    totalVariance: money(sum(sdraResults.map((row) => row.variance))),
    unmatchedMtfRows: unmatchedMtf.length,
    shouldHaveBeenPaidAndWasPaid: money(sum(sdraResults.filter((row) => row.claim.inventoryGroup === 'RX' && row.actual > 0).map((row) => row.actual))),
    shouldNotHaveBeenPaidAndWasPaid: money(sum(sdraResults.filter((row) => row.claim.inventoryGroup === '340B' && row.actual > 0).map((row) => row.actual))),
    correctlyPaidAmount: money(sum(sdraResults.filter((row) => row.status === 'RX paid correctly').map((row) => row.actual))),
    correctlyNotPaidAmount: money(sum(sdraResults.filter((row) => row.status === '340B no payment expected').map((row) => row.expected))),
    shouldHaveBeenPaidButMissing: money(sum(sdraResults.filter((row) => row.status === 'RX not paid and should have been').map((row) => row.expected))),
    shouldNotHaveBeenPaidExposure: money(sum(sdraResults.filter((row) => row.status === '340B paid and should not have been').map((row) => row.actual))),
  };

  const claimsSummary = {
    totalRows: claimsAnalysis.length,
    flaggedClaims: flaggedClaims.length,
    priceModeledClaims: claimsAnalysis.filter((row) => row.estimatedAcquisition != null).reduce((count, row) => count + row.totalClaims, 0),
    cashClaims: pioneerClaims.filter((claim) => claim.payerType === 'Cash').length,
    activeClaims: pioneerClaims.length,
    inactiveExcludedClaims: pioneerClaimsAll.length - pioneerClaims.length,
    reversedClaims: countLifecycle(pioneerClaimsAll, 'reversed'),
    cancelledClaims: countLifecycle(pioneerClaimsAll, 'cancelled'),
    rejectedOnHoldClaims: countLifecycle(pioneerClaimsAll, 'rejected_on_hold'),
    transferredClaims: countLifecycle(pioneerClaimsAll, 'transferred'),
  };

  const nonCashHighGp = thirdParty.filter((row) => row.payerType !== 'Cash' && (row.grossProfitPerRx || 0) >= 20);
  const highestNonCash = [...thirdParty.filter((row) => row.payerType !== 'Cash' && row.grossProfitPerRx != null)].sort((a, b) => (b.grossProfitPerRx || 0) - (a.grossProfitPerRx || 0))[0];
  const lowestNonCash = [...thirdParty.filter((row) => row.payerType !== 'Cash' && row.grossProfitPerRx != null)].sort((a, b) => (a.grossProfitPerRx || 0) - (b.grossProfitPerRx || 0))[0];
  const thirdPartySummary = {
    groups: thirdParty.length,
    totalClaims: thirdPartyClaims.length,
    medDClaims: thirdPartyClaims.filter((claim) => claim.payerType === 'Med D').length,
    medicaidClaims: thirdPartyClaims.filter((claim) => isMedicaidClaim(claim)).length,
    rxCashClaims: thirdPartyClaims.filter((claim) => claim.payerType === 'Cash').length,
    highGrossProfitGroups: nonCashHighGp.length,
    highestGrossProfitPerRx: highestNonCash?.grossProfitPerRx ?? null,
    lowestGrossProfitPerRx: lowestNonCash?.grossProfitPerRx ?? null
  };

  const inventorySummary = {
    ndcs: inventoryManagement.length,
    returnCandidates: inventoryManagement.filter((row) => row.status === 'Return candidate').length,
    reorderRx: inventoryManagement.filter((row) => row.status === 'Reorder RX').length,
    replenish340B: inventoryManagement.filter((row) => row.status === 'Replenish 340B').length,
    overstock: inventoryManagement.filter((row) => row.status === 'Overstock').length,
    understock: inventoryManagement.filter((row) => row.status === 'Understock').length
  };

  const ndcSummary = {
    rows: ndcOptimization.length,
    sameGroupOpportunities: ndcOptimization.filter((row) => (row.sameGroupSavingsTotal || 0) > 0).length,
    weightedOpportunities: ndcOptimization.filter((row) => (row.weightedSavingsTotal || 0) > 0).length,
    totalSameGroupSavings: money(sum(ndcOptimization.map((row) => row.sameGroupSavingsTotal || 0))),
    totalWeightedSavings: money(sum(ndcOptimization.map((row) => row.weightedSavingsTotal || 0)))
  };

  const complianceSummary = {
    findings: compliance.length,
    high: compliance.filter((row) => row?.severity === 'high' && row?.flagged).length,
    medium: compliance.filter((row) => row?.severity === 'medium' && row?.flagged).length,
    referralChecks: compliance.filter((row) => /referral verification queue/i.test(row?.finding || '')).length
  };

  const b340SavingsRaw = pioneerClaims
    .filter((claim) => claim.inventoryGroup === '340B')
    .map((claim) => {
      const ndc = cleanNdc(claim.ndc);
      const inventoryWac = db.inventoryRows.find((row) => row.pharmacyCode === claim.pharmacyCode && cleanNdc(row.ndc) === ndc)?.wac ?? null;
      const priceWac = priceMaps.byGroupExact.get(`RX|${ndc}`)?.acquisitionCost ?? null;
      const wacPerUnit = inventoryWac ?? priceWac;
      const acquisitionPerUnit = priceMaps.byGroupExact.get(`340B|${ndc}`)?.acquisitionCost ?? acquisitionForClaim(claim, priceMaps);
      const quantity = Number(claim.quantity || 0);
      const savings = wacPerUnit != null && acquisitionPerUnit != null && quantity > 0
        ? money((wacPerUnit - acquisitionPerUnit) * quantity)
        : null;
      const flagged = savings != null && savings < 0;
      return {
        id: `${claim.pharmacyCode}|${claim.rxNumber}|${claim.fillNumber}|${ndc}|340b-savings`,
        pharmacyCode: claim.pharmacyCode,
        pharmacyName: pharmacyNameOf(claim.pharmacyCode),
        claim,
        ndc,
        wacPerUnit,
        acquisitionPerUnit,
        quantity,
        savings,
        flagged,
        severity: flagged ? 'high' : 'low',
        flagReason: flagged ? '340B acquisition cost exceeded WAC baseline' : null,
        details: {
          columns: ['Rx', 'Drug', 'NDC', 'Qty', 'WAC / Unit', '340B Cost / Unit', 'Savings', 'Fill Date'],
          rows: [[claim.rxNumber, claim.drugName, ndc, quantity, wacPerUnit != null ? money(wacPerUnit) : '', acquisitionPerUnit != null ? money(acquisitionPerUnit) : '', savings != null ? money(savings) : '', claim.fillDate || claim.claimDate || '']]
        }
      };
    })
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || (b.savings || 0) - (a.savings || 0));
  const b340Savings = applyReviewDecisions(b340SavingsRaw, reviewDecisionMap);

  const assistanceByNdc = Object.values(groupBy(db.patientAssistanceRows, (row) => cleanNdc(row.ndc))).reduce<Record<string, { maxClaim: number; maxUnit: number; programs: string[] }>>((acc, group) => {
    const ndc = cleanNdc(group[0]?.ndc);
    const maxClaim = Math.max(0, ...group.filter((row) => row.assistanceBasis === 'claim').map((row) => Number(row.assistanceAmount || 0)));
    const maxUnit = Math.max(0, ...group.filter((row) => row.assistanceBasis === 'unit').map((row) => Number(row.assistanceAmount || 0)));
    acc[ndc] = { maxClaim, maxUnit, programs: group.map((row) => row.programName).filter(Boolean) };
    return acc;
  }, {});

  const affordabilityRaw = pioneerClaims
    .filter((claim) => assistanceByNdc[cleanNdc(claim.ndc)])
    .map((claim) => {
      const ndc = cleanNdc(claim.ndc);
      const assistance = assistanceByNdc[ndc];
      const quantity = Number(claim.quantity || 0);
      const claimCap = (assistance?.maxClaim || 0) + ((assistance?.maxUnit || 0) * quantity);
      const patientPay = Math.max(Number(claim.patientPayAmount || 0), 0);
      const affordabilityApplied = money(Math.min(patientPay, Math.max(claimCap, 0)));
      const uncoveredAfterAssistance = money(Math.max(patientPay - affordabilityApplied, 0));
      return {
        id: `${claim.pharmacyCode}|${claim.rxNumber}|${claim.fillNumber}|${ndc}|affordability`,
        pharmacyCode: claim.pharmacyCode,
        pharmacyName: pharmacyNameOf(claim.pharmacyCode),
        claim,
        ndc,
        matchedPrograms: assistance.programs.join('; '),
        patientPay,
        affordabilityApplied,
        uncoveredAfterAssistance,
        flagged: uncoveredAfterAssistance > 20,
        severity: uncoveredAfterAssistance > 50 ? 'high' : uncoveredAfterAssistance > 20 ? 'medium' : 'low',
        flagReason: uncoveredAfterAssistance > 20 ? 'Residual patient cost after assistance' : null,
        details: {
          columns: ['Rx', 'Drug', 'NDC', 'Programs', 'Patient Pay', 'Estimated Assistance', 'Residual', 'Fill Date'],
          rows: [[claim.rxNumber, claim.drugName, ndc, assistance.programs.join('; '), money(patientPay), money(affordabilityApplied), money(uncoveredAfterAssistance), claim.fillDate || claim.claimDate || '']]
        }
      };
    })
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.uncoveredAfterAssistance - a.uncoveredAfterAssistance);
  const affordability = applyReviewDecisions(affordabilityRaw, reviewDecisionMap);

  const pairedFinancials = generalAnalyticsClaims.map((claim) => grossProfitTuple(claim, priceMaps)).filter(Boolean) as { remit:number; acquisition:number; grossProfit:number }[];
  const financeByPharmacy = PHARMACIES.map((pharmacy) => {
    const claims = generalAnalyticsClaims.filter((claim) => claim.pharmacyCode === pharmacy.code);
    const pairs = claims.map((claim) => grossProfitTuple(claim, priceMaps)).filter(Boolean) as { remit:number; acquisition:number; grossProfit:number }[];
    const sdraRows = sdraResults.filter((row) => row.pharmacyCode === pharmacy.code);
    const flaggedActions = sdraRows.filter((row) => row.flagged).length
      + claimsAnalysis.filter((row) => row.pharmacyCode === pharmacy.code && row.flagged).length
      + thirdParty.filter((row) => row.pharmacyCode === pharmacy.code && row.flagged).length
      + inventoryManagement.filter((row) => row.pharmacyCode === pharmacy.code && row.flagged).length
      + ndcOptimization.filter((row) => row.pharmacyCode === pharmacy.code && row.flagged).length
      + compliance.filter((row) => row?.pharmacyCode === pharmacy.code && row?.flagged).length;
    const revenue = money(sum(pairs.map((row) => row.remit)));
    const modeledAcquisition = money(sum(pairs.map((row) => row.acquisition)));
    const grossProfit = money(sum(pairs.map((row) => row.grossProfit)));
    const sdraCollectibleGap = money(sum(sdraRows
      .filter((row) => row.claim.inventoryGroup === 'RX')
      .map((row) => positiveShortfall(row.expected - row.actual))));
    const improper340BExposure = money(sum(sdraRows
      .filter((row) => /340B paid and should not have been|Unexpected 340B payment value/.test(row.status))
      .map((row) => Math.max(row.rawActual || row.actual || 0, 0))));
    const weightedNdcSavings = money(sum(ndcOptimization
      .filter((row) => row.pharmacyCode === pharmacy.code)
      .map((row) => row.weightedSavingsTotal || 0)));
    const b340SavingsTotal = money(sum(b340Savings
      .filter((row) => row.pharmacyCode === pharmacy.code)
      .map((row) => row.savings || 0)));
    const directToPatientAffordability = money(sum(affordability
      .filter((row) => row.pharmacyCode === pharmacy.code)
      .map((row) => row.affordabilityApplied || 0)));
    return {
      pharmacyCode: pharmacy.code,
      pharmacyName: pharmacy.name,
      pharmacyColor: pharmacy.color,
      claimCount: claims.length,
      revenue,
      modeledAcquisition,
      grossProfit,
      grossMargin: percent(grossProfit, revenue),
      sdraCollectibleGap,
      improper340BExposure,
      b340SavingsTotal,
      directToPatientAffordability,
      weightedNdcSavings,
      flaggedActions,
    };
  });

  const financeSummary = {
    recordedRevenue: money(sum(pairedFinancials.map((row) => row.remit))),
    modeledAcquisition: money(sum(pairedFinancials.map((row) => row.acquisition))),
    grossProfit: money(sum(pairedFinancials.map((row) => row.grossProfit))),
    grossMargin: percent(money(sum(pairedFinancials.map((row) => row.grossProfit))), money(sum(pairedFinancials.map((row) => row.remit)))),
    sdraCollectibleGap: money(sum(sdraResults
      .filter((row) => row.claim.inventoryGroup === 'RX')
      .map((row) => positiveShortfall(row.expected - row.actual)))),
    improper340BExposure: money(sum(sdraResults
      .filter((row) => /340B paid and should not have been|Unexpected 340B payment value/.test(row.status))
      .map((row) => Math.max(row.rawActual || row.actual || 0, 0)))),
    b340SavingsTotal: money(sum(b340Savings.map((row) => row.savings || 0))),
    directToPatientAffordability: money(sum(affordability.map((row) => row.affordabilityApplied || 0))),
    weightedNdcSavings: ndcSummary.totalWeightedSavings,
    sameGroupSavings: ndcSummary.totalSameGroupSavings,
    totalInventoryValue: kpi.totalInventoryValue,
    byPharmacy: financeByPharmacy,
  };

  const iraClaims = activeClaimsOnly(scopedPioneerClaims.filter((claim) => claimInDateRange(claim, iraStartDate, iraEndDate)))
    .filter((claim) => claim.payerType === 'Med D' && sdraMap.has(cleanNdc(claim.ndc)));
  const iraComparisonBase = [2025, 2026].map((year) => {
    const yearClaims = iraClaims.filter((claim) => claimYear(claim) === year);
    const claimPairs = yearClaims
      .map((claim) => ({ claim, tuple: grossProfitTuple(claim, priceMaps) }))
      .filter((row) => Boolean(row.tuple)) as Array<{ claim: PioneerClaim; tuple: { remit:number; acquisition:number; grossProfit:number } }>;
    const totalRevenue = money(sum(claimPairs.map((row) => row.tuple.remit)));
    const totalAcquisition = money(sum(claimPairs.map((row) => row.tuple.acquisition)));
    const grossProfit = money(sum(claimPairs.map((row) => row.tuple.grossProfit)));
    return {
      id: `ira-comparison-${year}`,
      year,
      claimCount: yearClaims.length,
      modeledClaims: claimPairs.length,
      totalRevenue,
      totalAcquisition,
      grossProfit,
      grossMargin: percent(grossProfit, totalRevenue),
      note: year === 2025
        ? '2025 IRA claims are baseline only and excluded from SDRA totals.'
        : '2026 IRA claims are compared against 2025 baseline.',
      details: {
        columns: ['Fill date', 'Claim date', 'Pharmacy', 'Rx', 'Drug', 'Revenue', 'Acquisition', 'Gross profit'],
        rows: claimPairs.map((row) => [
          row.claim.fillDate || '',
          row.claim.claimDate || '',
          row.claim.pharmacyName || row.claim.pharmacyCode,
          row.claim.rxNumber,
          row.claim.drugName,
          money(row.tuple.remit),
          money(row.tuple.acquisition),
          money(row.tuple.grossProfit),
        ])
      }
    };
  });
  const baseline2025 = iraComparisonBase.find((row) => row.year === 2025);
  const iraYearComparison = iraComparisonBase.map((row) => ({
    ...row,
    revenueDeltaVs2025: !baseline2025 || row.year === 2025 ? 0 : money((row.totalRevenue || 0) - (baseline2025.totalRevenue || 0)),
    grossProfitDeltaVs2025: !baseline2025 || row.year === 2025 ? 0 : money((row.grossProfit || 0) - (baseline2025.grossProfit || 0)),
    grossMarginDeltaVs2025: !baseline2025 || row.year === 2025 ? 0 : Number(((row.grossMargin || 0) - (baseline2025.grossMargin || 0)).toFixed(4)),
  }));

  const staffing = buildStaffingState(pioneerClaims);

  const pharmacyCardsEnhanced = pharmacyCards.map((card) => ({
    ...card,
    ...financeByPharmacy.find((row) => row.pharmacyCode === card.code),
    staffing: staffing.byPharmacy.find((row) => row.pharmacyCode === card.code) || null,
  }));

  return {
    kpi,
    pharmacyCards: pharmacyCardsEnhanced,
    financeSummary,
    staffing,
    sdraDashboardByPharmacy,
    sdraResults,
    sdraSummary,
    iraYearComparison,
    unmatchedMtf,
    claimsAnalysis,
    claimsSummary,
    flaggedClaims,
    thirdParty,
    thirdPartySummary,
    inventoryManagement,
    inventorySummary,
    ndcOptimization,
    ndcSummary,
    compliance,
    complianceSummary,
    b340Savings,
    b340SavingsSummary: {
      claims: b340Savings.length,
      modeledClaims: b340Savings.filter((row) => row.savings != null).length,
      totalSavings: money(sum(b340Savings.map((row) => row.savings || 0))),
      negativeSavingsClaims: b340Savings.filter((row) => (row.savings || 0) < 0).length,
    },
    affordability,
    affordabilitySummary: {
      rows: affordability.length,
      matchedClaims: affordability.filter((row) => row.affordabilityApplied > 0).length,
      totalAffordability: money(sum(affordability.map((row) => row.affordabilityApplied || 0))),
      residualExposure: money(sum(affordability.map((row) => row.uncoveredAfterAssistance || 0))),
      uploadedPlans: db.patientAssistanceRows.length,
    },
    uploads,
    users: db.users
  };
}
