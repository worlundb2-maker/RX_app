export type PharmacyCode = 'KONAWA' | 'MONTE_VISTA' | 'ARLINGTON' | 'SEMINOLE';
export type UploadType = 'pioneer' | 'mtf' | 'mtf_adjustment' | 'inventory' | 'price_rx' | 'price_340b';
export type InventoryGroup = 'RX' | '340B';
export type UserRole = 'admin' | 'analyst' | 'viewer';
export type ReviewLabel = 'flag' | 'do_not_flag' | 'resolved';

export interface PharmacyConfig {
  code: PharmacyCode;
  name: string;
  color: string;
  npi: string;
  ncpdp: string;
  aliases?: {
    npi?: string[];
    names?: string[];
    storeNumbers?: string[];
  };
}

export interface UploadRecord {
  id: string;
  type: UploadType;
  pharmacyCode?: PharmacyCode | 'ALL';
  impactedPharmacies: PharmacyCode[];
  originalName: string;
  storedName: string;
  uploadedAt: string;
  rows: number;
  sourceRows: number;
  rejectedRows: number;
  sheetName?: string;
}

export interface PioneerClaim {
  id: string;
  pharmacyCode: PharmacyCode;
  pharmacyNpi: string;
  pharmacyName: string;
  rxNumber: string;
  fillNumber: number;
  fillDate: string | null;
  claimDate: string | null;
  inventoryGroup: InventoryGroup;
  prescriberCategory: string;
  ndc: string;
  drugName: string;
  quantity: number;
  daysSupply: number | null;
  primaryPayer: string;
  primaryPlanType: string | null;
  secondaryPayer: string | null;
  secondaryPlanType: string | null;
  payerType: 'Med D' | 'Medicaid' | 'Commercial' | 'Cash' | 'Other';
  claimStatus: string;
  currentTransactionStatus: string | null;
  normalizedClaimLifecycle: 'active' | 'reversed' | 'cancelled' | 'rejected_on_hold' | 'transferred' | 'other_inactive';
  totalPricePaid: number | null;
  primaryRemitAmount: number | null;
  secondaryRemitAmount: number | null;
  patientPayAmount: number | null;
  acquisitionCost: number | null;
  bin: string | null;
  pcn: string | null;
  groupNumber: string | null;
  thirdPartyName: string | null;
  brandGeneric: string | null;
  sig: string | null;
}

export interface MtfClaim {
  id: string;
  pharmacyCode: PharmacyCode;
  pharmacyNpi: string;
  rxNumber: string;
  fillNumber: number;
  serviceDate: string | null;
  receiptDate: string | null;
  ndc: string;
  drugName: string;
  quantity: number | null;
  sdra: number | null;
  manufacturerPaymentAmount: number;
  rawPaymentAmount?: number | null;
  unexpectedPayment?: boolean;
  unexpectedReason?: string | null;
  icn: string | null;
  pricingMethod: string;
  sourceType: 'mtf' | 'mtf_adjustment';
}

export interface InventoryRow {
  id: string;
  pharmacyCode: PharmacyCode;
  ndc: string;
  drugName: string;
  strength: string | null;
  inventoryGroup: InventoryGroup;
  stockSize: number | null;
  onHand: number;
  lastCostPaid: number | null;
  reorderPoint: number | null;
  brandOrGeneric: 'Brand' | 'Generic';
  dispensingUnit: string | null;
  lastFillDate: string | null;
  lastReceivedDate: string | null;
  awp: number | null;
  wac: number | null;
  nadac: number | null;
  mac: number | null;
}

export interface PriceRow {
  id: string;
  ndc: string;
  itemNumber: string | null;
  gcn?: string;
  drugName: string;
  genericName: string | null;
  strength: string | null;
  manufacturer: string | null;
  acquisitionCost: number | null;
  packageSize: number | null;
  unit: string | null;
  inventoryGroup: InventoryGroup;
}

export interface UserRecord {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  displayName: string;
}

export interface ReviewDecision {
  id: string;
  targetKey: string;
  label: ReviewLabel;
  updatedAt: string;
}

export interface AppDb {
  schemaVersion: number;
  users: UserRecord[];
  uploads: UploadRecord[];
  pioneerClaims: PioneerClaim[];
  mtfClaims: MtfClaim[];
  inventoryRows: InventoryRow[];
  priceRows: PriceRow[];
  reviewDecisions: ReviewDecision[];
}
