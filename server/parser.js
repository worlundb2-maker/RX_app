import fs from 'node:fs';
import xlsx from 'xlsx';
import { randomUUID } from 'node:crypto';
import { pharmacyByCode, readDb, resolvePharmacy, writeDb } from './data.js';
const HEADER_GROUPS = {
    pioneer: {
        minScore: 4,
        groups: [
            ['rxnumber', 'rxnum', 'prescriptionnumber', 'scriptnumber', 'rx#', 'rxno'],
            ['ndc', 'ndc11', 'drugndc', 'productndc', 'ndcnumber'],
            ['filldate', 'datefilled', 'servicedate', 'claimdate'],
            ['quantity', 'qty', 'dispensedqty', 'dispensedquantity'],
            ['primarypayer', 'thirdpartyname', 'payer', 'payor', 'insurance'],
            ['inventorygroup', 'invgroup', 'inventory'],
            ['store', 'pharmacyname', 'npi', 'pharmacynpi', 'storenpi'],
        ],
    },
    mtf: {
        minScore: 4,
        groups: [
            ['rxnum', 'rxnumber', 'prescriptionnumber', 'rx#'],
            ['mfrpaymentamount', 'paymentamount', 'paidamount', 'amount'],
            ['icn', 'claimnumber', 'claim#'],
            ['servicedate', 'filldate'],
            ['ndc', 'ndc11'],
            ['pricingmethod', 'paymentissuedate', 'mtfreceiptdate'],
        ],
    },
    mtf_adjustment: {
        minScore: 3,
        groups: [
            ['rxnum', 'rxnumber', 'prescriptionnumber', 'rx#'],
            ['amount', 'adjustmentamount', 'creditamount'],
            ['icn', 'claimnumber', 'claim#'],
            ['paymentissuedate', 'adjustmentdate', 'date'],
            ['npi', 'npistoredba', 'storenpi'],
        ],
    },
    inventory: {
        minScore: 4,
        groups: [
            ['ndc', 'ndc11'],
            ['name', 'drugname', 'description'],
            ['inventorygroup', 'invgroup'],
            ['inventorygrouponhand', 'inventoryonhand', 'onhand'],
            ['lastcostpaid', 'cost'],
            ['stocksize', 'packagesize'],
        ],
    },
    price_rx: {
        minScore: 3,
        groups: [
            ['ndc', 'ndc11'],
            ['propercontractprice', 'acquisitioncost', 'cost', 'lastcostpaid', 'nadac'],
            ['selldescription', 'drugname', 'description', 'name'],
            ['gcn', 'genericname', 'manufacturer'],
        ],
    },
    price_340b: {
        minScore: 3,
        groups: [
            ['ndc', 'ndc11'],
            ['propercontractprice', 'acquisitioncost', 'cost', 'lastcostpaid', 'nadac'],
            ['selldescription', 'drugname', 'description', 'name'],
            ['gcn', 'genericname', 'manufacturer'],
        ],
    },
};
function normalizeKey(value) {
    return String(value ?? '')
        .replace(/^\ufeff/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}
function asHeaderArray(row) {
    return row.map((value) => String(value ?? '').trim()).filter((value) => value !== '');
}
function headerMatches(headers, alias) {
    const normalizedAlias = normalizeKey(alias);
    return headers.some((header) => {
        const normalizedHeader = normalizeKey(header);
        return normalizedHeader === normalizedAlias || normalizedHeader.includes(normalizedAlias) || normalizedAlias.includes(normalizedHeader);
    });
}
function headerScore(headers, type) {
    const normalizedHeaders = headers.map((header) => normalizeKey(header)).filter(Boolean);
    const groups = HEADER_GROUPS[type].groups;
    return groups.reduce((score, aliases) => score + (aliases.some((alias) => headerMatches(normalizedHeaders, alias)) ? 1 : 0), 0);
}
function countSourceRows(rows, headerIndex) {
    return rows.slice(headerIndex + 1).filter((row) => row.some((value) => value != null && String(value).trim() !== '')).length;
}
function scanWorkbook(workbook, type) {
    const candidates = [];
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, {
            header: 1,
            defval: null,
            raw: false,
            blankrows: false,
        });
        const sampleWindow = Math.min(rows.length, 30);
        for (let headerIndex = 0; headerIndex < sampleWindow; headerIndex++) {
            const headers = asHeaderArray(rows[headerIndex] ?? []);
            if (headers.length < 2)
                continue;
            const score = headerScore(headers, type);
            const sourceRows = countSourceRows(rows, headerIndex);
            candidates.push({ sheetName, headerIndex, headers, score, sourceRows, rows });
        }
    }
    const ranked = candidates.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        if (b.sourceRows !== a.sourceRows)
            return b.sourceRows - a.sourceRows;
        return a.headerIndex - b.headerIndex;
    });
    return ranked[0] ?? null;
}
function pickBestSheet(workbooks, type) {
    const specs = workbooks.map((workbook) => scanWorkbook(workbook, type)).filter(Boolean);
    const winner = specs.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        if (b.sourceRows !== a.sourceRows)
            return b.sourceRows - a.sourceRows;
        return a.headerIndex - b.headerIndex;
    })[0];
    if (!winner) {
        throw new Error('The workbook did not contain any readable rows.');
    }
    const requiredScore = HEADER_GROUPS[type].minScore;
    if (winner.score < requiredScore) {
        throw new Error(`Unable to identify a ${type} sheet. Best match was sheet "${winner.sheetName}" with score ${winner.score}/${HEADER_GROUPS[type].groups.length}.`);
    }
    return winner;
}
function valueMap(row) {
    const out = new Map();
    for (const [key, value] of Object.entries(row))
        out.set(normalizeKey(key), value);
    return out;
}
function findValue(row, candidates) {
    const map = valueMap(row);
    for (const candidate of candidates) {
        const value = map.get(normalizeKey(candidate));
        if (value !== undefined && value !== null && String(value).trim() !== '')
            return value;
    }
    for (const candidate of candidates) {
        const normalizedCandidate = normalizeKey(candidate);
        for (const [normalizedKey, value] of map.entries()) {
            if (value === undefined || value === null || String(value).trim() === '')
                continue;
            if (normalizedKey.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedKey)) {
                return value;
            }
        }
    }
    return null;
}
function findValueStrict(row, candidates) {
    const map = valueMap(row);
    for (const candidate of candidates) {
        const value = map.get(normalizeKey(candidate));
        if (value !== undefined && value !== null && String(value).trim() !== '')
            return value;
    }
    return null;
}
function asText(value) {
    if (value == null)
        return '';
    return String(value).trim();
}
function cleanNdc(value) {
    return asText(value).replace(/[^0-9]/g, '');
}
function asNumber(value) {
    if (value == null || value === '')
        return null;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    const raw = String(value)
        .replace(/\$/g, '')
        .replace(/,/g, '')
        .replace(/\(([^)]+)\)/, '-$1')
        .trim();
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}
function asDate(value) {
    if (value == null || value === '')
        return null;
    if (value instanceof Date && !Number.isNaN(value.getTime()))
        return value.toISOString().slice(0, 10);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function normalizeClaimLifecycle(claimTypeValue, currentStatusValue) {
    const claimType = asText(claimTypeValue).toUpperCase();
    const currentStatus = asText(currentStatusValue).toLowerCase();
    if (claimType === 'B2' || /reversal|reversed/.test(currentStatus))
        return 'reversed';
    if (/transfer|transferred/.test(currentStatus))
        return 'transferred';
    if (/cancel/.test(currentStatus) && !claimType)
        return 'rejected_on_hold';
    if (/reject|on hold|hold/.test(currentStatus))
        return 'rejected_on_hold';
    if (/cancel/.test(currentStatus))
        return 'cancelled';
    if (claimType === 'B1' || /complete|completed|paid|sold|adjudicated/.test(currentStatus))
        return 'active';
    return currentStatus ? 'other_inactive' : 'active';
}
function pioneerClaimKey(claim) {
    return [claim.pharmacyCode, claim.rxNumber, claim.fillNumber, cleanNdc(claim.ndc)].join('|');
}
function mtfClaimKey(claim) {
    return [claim.sourceType, claim.pharmacyCode, claim.rxNumber || '', claim.fillNumber, cleanNdc(claim.ndc), claim.icn || '', claim.receiptDate || '', claim.rawPaymentAmount ?? ''].join('|');
}
function mergeByKey(existing, incoming, keyFn) {
    const incomingKeys = new Set(incoming.map(keyFn));
    return [...existing.filter((row) => !incomingKeys.has(keyFn(row))), ...incoming];
}
function inventoryGroup(value) {
    return String(value ?? '').toUpperCase().includes('340') ? '340B' : 'RX';
}
function payerTypeFromNames(...names) {
    const combined = names.join(' ').toLowerCase();
    if (!combined)
        return 'Other';
    if (combined.includes('cash') || combined.includes('self-pay') || combined.includes('rx cash'))
        return 'Cash';
    if (combined.includes('medicaid') || combined.includes('soonercare') || combined.includes('welfare') || combined.includes('ohca')
        || combined.includes('aetna better health of oklahoma medicaid mco')
        || combined.includes('oklahoma complete health (centene) medicaid mco 2hfa')
        || combined.includes('humana health horizons ok medicaid mco 1a791'))
        return 'Medicaid';
    if (combined.includes('pdp') || combined.includes('med d') || combined.includes('part d') || combined.includes('mapd') || combined.includes('medicare'))
        return 'Med D';
    if (combined.includes('commercial') || combined.includes('standard') || combined.includes('coupon') || combined.includes('340b'))
        return 'Commercial';
    return 'Commercial';
}
function rowsFromFile(filePath, type) {
    const fileBuffer = fs.readFileSync(filePath);
    const workbooks = [];
    try {
        workbooks.push(xlsx.read(fileBuffer, { type: 'buffer', cellDates: true, raw: false, codepage: 65001 }));
    }
    catch {
        // fall through to text parse
    }
    const fileText = fileBuffer.toString('utf8');
    if (fileText.includes(',') && fileText.includes('\n')) {
        try {
            workbooks.push(xlsx.read(fileText, { type: 'string', cellDates: true, raw: false, codepage: 65001 }));
        }
        catch {
            // ignore text parse failures for binary workbooks
        }
    }
    if (!workbooks.length) {
        throw new Error('The uploaded file could not be parsed as Excel or CSV.');
    }
    const spec = pickBestSheet(workbooks, type);
    const dataRows = spec.rows.slice(spec.headerIndex + 1);
    const objects = dataRows.map((row) => {
        const obj = {};
        spec.headers.forEach((header, idx) => {
            if (header)
                obj[header] = row[idx] ?? null;
        });
        return obj;
    }).filter((row) => Object.values(row).some((value) => value != null && String(value).trim() !== ''));
    return {
        rows: objects,
        meta: {
            sheetName: spec.sheetName,
            headerIndex: spec.headerIndex,
            sourceRows: objects.length,
        },
    };
}
function amountFromMtf(row, type) {
    const exactCandidates = type === 'mtf_adjustment'
        ? ['Adjustment Amount', 'Credit Amount', 'Payment Amount', 'Paid Amount', 'MFR Payment Amount', 'Net Payment', 'Net Amount Paid']
        : ['MFR Payment Amount', 'Payment Amount', 'Paid Amount', 'Net Payment', 'Net Amount Paid', 'Remit Amount'];
    const fallbackCandidates = type === 'mtf_adjustment'
        ? ['Adjustment Amount', 'Credit Amount', 'Payment Amount', 'Paid Amount', 'MFR Payment Amount', 'Net Payment', 'Net Amount Paid']
        : ['MFR Payment Amount', 'Payment Amount', 'Paid Amount', 'Net Payment', 'Net Amount Paid', 'Remit Amount'];
    const raw = asNumber(findValueStrict(row, exactCandidates) ?? findValue(row, fallbackCandidates));
    const sdra = asNumber(findValueStrict(row, ['SDRA', 'Standard Default Refund Amount']) ?? findValue(row, ['SDRA', 'Standard Default Refund Amount']));
    if (raw == null)
        return { normalized: null, raw: null, unexpected: false, reason: null };
    const absolute = Math.abs(raw);
    const sanityLimit = Math.max(2500, Math.abs(sdra || 0) * 12 + 250);
    if (!Number.isFinite(raw) || absolute > sanityLimit) {
        return {
            normalized: 0,
            raw,
            unexpected: true,
            reason: `Payment amount ${raw} exceeded sanity limit ${sanityLimit}`,
        };
    }
    return { normalized: raw, raw, unexpected: false, reason: null };
}
function parsePriceRow(row, group) {
    const ndc = cleanNdc(findValue(row, ['NDC', 'NDC11', 'NDC Number']));
    if (!ndc)
        return null;
    return {
        id: randomUUID(),
        ndc,
        itemNumber: asText(findValue(row, ['ItemNumber', 'Item Number'])) || null,
        gcn: asText(findValue(row, ['GCN', 'Generic Code Number'])) || undefined,
        drugName: asText(findValue(row, ['SellDescription', 'Drug Name', 'Name', 'Description'])) || ndc,
        genericName: asText(findValue(row, ['GenericName', 'Generic Name'])) || null,
        strength: asText(findValue(row, ['DoseStrengthDescriptionName', 'Strength'])) || null,
        manufacturer: asText(findValue(row, ['Manufacturer', 'Manufacturer Name'])) || null,
        acquisitionCost: asNumber(findValue(row, ['ProperContractPrice', 'Acquisition Cost', 'Cost', 'Last Cost Paid', 'NADAC'])),
        packageSize: asNumber(findValue(row, ['PackageSize', 'Package Size', 'Pack Size'])),
        unit: asText(findValue(row, ['RetailSellUnitCode', 'Unit'])) || null,
        inventoryGroup: group,
    };
}
function chosenPharmacy(requestedPharmacy, row) {
    return pharmacyByCode(requestedPharmacy)
        || resolvePharmacy({
            pharmacyCode: requestedPharmacy,
            npi: asText(findValue(row, ['NPI', 'NPI (Store DBA)', 'Pharmacy NPI', 'Store NPI', 'Billing NPI'])),
            store: asText(findValue(row, ['Store', 'Store Number', 'Store ID'])),
            pharmacyName: asText(findValue(row, ['PharmacyName', 'Pharmacy Name', 'Store Name', 'Store DBA'])),
        });
}
function finalizeResult(rows, meta, impactedPharmacies) {
    const rejectedRows = Math.max(meta.sourceRows - rows, 0);
    if (rows === 0 && meta.sourceRows > 0) {
        throw new Error(`Detected ${meta.sourceRows} source rows on sheet "${meta.sheetName}" but parsed 0 usable rows. The workbook layout did not map cleanly to the selected upload type.`);
    }
    return {
        rows,
        sourceRows: meta.sourceRows,
        rejectedRows,
        impactedPharmacies,
        sheetName: meta.sheetName,
    };
}
export function ingestUpload(filePath, type, requestedPharmacy) {
    const parsed = rowsFromFile(filePath, type);
    const rows = parsed.rows;
    const db = readDb();
    if (type === 'pioneer') {
        const claims = rows.map((row) => {
            const pharmacy = chosenPharmacy(requestedPharmacy, row);
            if (!pharmacy)
                return null;
            const rxNumber = asText(findValue(row, ['RxNumber', 'Rx Num', 'RX Number', 'Prescription Number', 'Rx #', 'Rx#', 'RX#', 'Script Number', 'Rx No', 'RxNo'])).replace(/^0+/, '');
            const ndc = cleanNdc(findValue(row, ['NDC', 'NDC11', 'Drug NDC', 'Product NDC', 'NDC Number']));
            if (!rxNumber || !ndc)
                return null;
            const primaryPayer = asText(findValue(row, ['PrimaryPayer', 'Primary Payer', 'Third Party Name', 'Payor', 'Payer', 'Insurance']));
            const primaryPlanType = asText(findValue(row, ['PrimaryPlanType', 'Primary Plan Type', 'Plan Type'])) || null;
            const secondaryPayer = asText(findValue(row, ['SecondaryPayer', 'Secondary Payer'])) || null;
            const secondaryPlanType = asText(findValue(row, ['SecondaryPlanType', 'Secondary Plan Type'])) || null;
            const thirdPartyName = asText(findValue(row, ['ThirdPartyName', 'Third Party Name', 'Primary Payer Name', 'Payer', 'Payor', 'Insurance'])) || primaryPayer || null;
            const rawClaimStatus = asText(findValue(row, ['ClaimStatus', 'Claim Status', 'ClaimType', 'Transaction Type']));
            const claimStatus = rawClaimStatus || '';
            const currentTransactionStatus = asText(findValue(row, ['CurrentTransactionStatus', 'Current Transaction Status', 'Current Status', 'Transaction Status'])) || null;
            return {
                id: randomUUID(),
                pharmacyCode: pharmacy.code,
                pharmacyNpi: pharmacy.npi,
                pharmacyName: pharmacy.name,
                rxNumber,
                fillNumber: Number(asNumber(findValue(row, ['FillNumber', 'Fill Num', 'Fill Number', 'Refill', 'Refill Number'])) ?? 0),
                fillDate: asDate(findValue(row, ['FillDate', 'Service Date', 'Date Filled', 'Fill Date'])),
                claimDate: asDate(findValue(row, ['ClaimDate', 'Claim Date', 'Transaction Date', 'Service Date'])),
                inventoryGroup: inventoryGroup(findValue(row, ['InventoryGroup', 'Inventory Group', 'Inv Group', 'Inventory'])),
                prescriberCategory: asText(findValue(row, ['PrescriberCategory', 'Prescriber Category', 'Provider Category'])),
                ndc,
                drugName: asText(findValue(row, ['DrugName', 'Drug Name', 'Medication', 'Drug'])) || ndc,
                quantity: Number(asNumber(findValue(row, ['Quantity', 'Qty', 'Dispensed Qty', 'Dispensed Quantity'])) ?? 0),
                daysSupply: asNumber(findValue(row, ['DaysSupply', 'Days Supply', 'Day Supply'])),
                primaryPayer,
                primaryPlanType,
                secondaryPayer,
                secondaryPlanType,
                payerType: payerTypeFromNames(primaryPayer, thirdPartyName || '', primaryPlanType || '', secondaryPlanType || ''),
                claimStatus,
                currentTransactionStatus,
                normalizedClaimLifecycle: normalizeClaimLifecycle(rawClaimStatus, currentTransactionStatus),
                totalPricePaid: asNumber(findValue(row, ['TotalPricePaid', 'Total Price Paid', 'Paid Amount', 'Gross Amount'])),
                primaryRemitAmount: asNumber(findValue(row, ['PrimaryRemit', 'PrimaryRemitAmount', 'Primary Remit', 'Primary Remit Amount', 'Remit Amount', 'Net Paid'])),
                secondaryRemitAmount: asNumber(findValue(row, ['SecondaryRemit', 'SecondaryRemitAmount', 'Secondary Remit', 'Secondary Remit Amount'])),
                patientPayAmount: asNumber(findValue(row, ['PatientPayAmount', 'Patient Pay Amount', 'Copay', 'Patient Responsibility'])),
                acquisitionCost: asNumber(findValue(row, ['AcquisitionCost', 'Acquisition Cost', 'Cost of Goods', 'Drug Cost'])),
                bin: asText(findValue(row, ['BIN', 'Processor BIN', 'PrimayThirdParty BIN', 'Primary BIN', 'Primary BIN/Processor'])) || null,
                pcn: asText(findValue(row, ['PCN', 'PrimaryPCN', 'Primary PCN'])) || null,
                groupNumber: asText(findValue(row, ['GroupNumber', 'Group Number', 'Group', 'PrimaryGroup', 'Primary Group'])) || null,
                thirdPartyName,
                brandGeneric: asText(findValue(row, ['BrandGeneric', 'Brand/Generic', 'Brand Generic', 'B/G'])) || null,
                sig: asText(findValue(row, ['SIG', 'Sig', 'Directions'])) || null,
            };
        }).filter(Boolean);
        const impacted = [...new Set(claims.map((claim) => claim.pharmacyCode))];
        db.pioneerClaims = mergeByKey(db.pioneerClaims, claims, pioneerClaimKey);
        writeDb(db);
        return finalizeResult(claims.length, parsed.meta, impacted);
    }
    if (type === 'mtf' || type === 'mtf_adjustment') {
        const claims = rows.map((row) => {
            const pharmacy = chosenPharmacy(requestedPharmacy, row);
            if (!pharmacy)
                return null;
            const rxNumber = asText(findValue(row, ['Rx Num', 'RxNumber', 'RX Number', 'Prescription Number', 'Rx #', 'Rx#'])).replace(/^0+/, '');
            const icn = asText(findValue(row, ['ICN', 'Claim Number', 'Claim #'])) || null;
            const payment = amountFromMtf(row, type);
            if (!rxNumber && !icn)
                return null;
            if (payment.raw == null)
                return null;
            if (type === 'mtf_adjustment' && payment.raw >= 0)
                return null;
            return {
                id: randomUUID(),
                pharmacyCode: pharmacy.code,
                pharmacyNpi: pharmacy.npi,
                rxNumber,
                fillNumber: Number(asNumber(findValue(row, ['Fill Num', 'FillNumber', 'Fill Number', 'Refill', 'Refill Number'])) ?? 0),
                serviceDate: asDate(findValue(row, ['Service Date', 'FillDate', 'Fill Date', 'Date Filled'])),
                receiptDate: asDate(findValue(row, ['MTF Receipt Date', 'MRA Receipt Date', 'Payment Date', 'Date Paid', 'Payment Issue Date', 'Adjustment Date'])),
                ndc: cleanNdc(findValue(row, ['NDC', 'NDC11', 'Drug NDC'])),
                drugName: asText(findValue(row, ['Drug Name', 'DrugName', 'Drug', 'Medication'])) || '',
                quantity: asNumber(findValue(row, ['Qty', 'Quantity', 'Dispensed Qty'])),
                sdra: asNumber(findValue(row, ['SDRA', 'Standard Default Refund Amount'])),
                manufacturerPaymentAmount: payment.normalized ?? 0,
                rawPaymentAmount: payment.raw,
                unexpectedPayment: payment.unexpected,
                unexpectedReason: payment.reason,
                icn,
                pricingMethod: asText(findValue(row, ['Pricing Method'])) || (type === 'mtf_adjustment' ? 'ADJUSTMENT' : ''),
                sourceType: type,
            };
        }).filter(Boolean);
        const impacted = [...new Set(claims.map((claim) => claim.pharmacyCode))];
        db.mtfClaims = mergeByKey(db.mtfClaims, claims, mtfClaimKey);
        writeDb(db);
        return finalizeResult(claims.length, parsed.meta, impacted);
    }
    if (type === 'inventory') {
        const pharmacy = pharmacyByCode(requestedPharmacy);
        if (!pharmacy)
            throw new Error('Inventory uploads require a pharmacy selection');
        const items = rows.map((row) => {
            const ndc = cleanNdc(findValue(row, ['NDC', 'NDC11', 'NDC Number']));
            if (!ndc)
                return null;
            const brandOrGeneric = String(findValue(row, ['Brand or Generic', 'Brand/Generic']) || '').toLowerCase().includes('brand') ? 'Brand' : 'Generic';
            return {
                id: randomUUID(),
                pharmacyCode: pharmacy.code,
                ndc,
                drugName: asText(findValue(row, ['Name', 'Drug Name', 'Description'])) || ndc,
                strength: asText(findValue(row, ['Strength'])) || null,
                inventoryGroup: inventoryGroup(findValue(row, ['Inventory Group', 'InventoryGroup', 'Inv Group'])),
                stockSize: asNumber(findValue(row, ['Stock Size', 'Package Size'])),
                onHand: Number(asNumber(findValue(row, ['Inventory Group On Hand', 'Inventory On Hand', 'On Hand'])) ?? 0),
                lastCostPaid: asNumber(findValue(row, ['Last Cost Paid', 'Cost'])),
                reorderPoint: asNumber(findValue(row, ['Reorder Point'])),
                brandOrGeneric,
                dispensingUnit: asText(findValue(row, ['Dispensing Unit'])) || null,
                lastFillDate: asDate(findValue(row, ['Last Fill Date'])),
                lastReceivedDate: asDate(findValue(row, ['Last Received Date'])),
                awp: asNumber(findValue(row, ['AWP'])),
                wac: asNumber(findValue(row, ['WAC'])),
                nadac: asNumber(findValue(row, ['NADAC'])),
                mac: asNumber(findValue(row, ['MAC'])),
            };
        }).filter(Boolean);
        db.inventoryRows = db.inventoryRows.filter((row) => row.pharmacyCode !== pharmacy.code);
        db.inventoryRows.push(...items);
        writeDb(db);
        return finalizeResult(items.length, parsed.meta, [pharmacy.code]);
    }
    if (type === 'price_rx' || type === 'price_340b') {
        const group = type === 'price_rx' ? 'RX' : '340B';
        const priceRows = rows.map((row) => parsePriceRow(row, group)).filter(Boolean);
        db.priceRows = db.priceRows.filter((row) => row.inventoryGroup !== group);
        db.priceRows.push(...priceRows);
        writeDb(db);
        return finalizeResult(priceRows.length, parsed.meta, []);
    }
    return finalizeResult(0, parsed.meta, []);
}
