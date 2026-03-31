import { PHARMACIES } from './data';
import type { PharmacyCode, PioneerClaim } from './types';

export type StaffingRoleKey = 'pharmacist' | 'technician' | 'clerk' | 'driver' | 'misc';

export type StaffingRoleProfile = {
  key: StaffingRoleKey;
  label: string;
  rxRange?: string;
  allocated: number;
  currentFilled: number;
  temporary?: number;
  transitioningIn?: number;
  transitioningOut?: number;
  shared?: number;
  names: string[];
  notes?: string[];
};

export type StaffingPharmacyProfile = {
  pharmacyCode: PharmacyCode;
  pharmacyName: string;
  pharmacyColor: string;
  roles: StaffingRoleProfile[];
  dashboardNote?: string;
};

const roleOrder: StaffingRoleKey[] = ['pharmacist', 'technician', 'clerk', 'driver', 'misc'];

export const STAFFING_PROFILE: StaffingPharmacyProfile[] = [
  {
    pharmacyCode: 'ARLINGTON',
    pharmacyName: 'Arlington',
    pharmacyColor: '#dc2626',
    dashboardNote: 'Arlington has a clerk-to-tech transition in progress and shared driver support with Monte Vista.',
    roles: [
      {
        key: 'pharmacist',
        label: 'Pharmacist',
        rxRange: '150–200 RX / day',
        allocated: 2,
        currentFilled: 2,
        names: ['Carty Collins', 'Levi Trimmel'],
        notes: ['Compounding support is carried separately as misc support.'],
      },
      {
        key: 'technician',
        label: 'Technician',
        rxRange: '100–150 RX / day',
        allocated: 4,
        currentFilled: 3,
        transitioningIn: 1,
        names: ['Cheryl Strickland', 'Keila Salgado', 'Jordan Brewer'],
        notes: ['Sommer Krause is transferring into technician coverage.'],
      },
      {
        key: 'clerk',
        label: 'Clerk',
        rxRange: '200–300 RX / day',
        allocated: 3,
        currentFilled: 3,
        transitioningOut: 1,
        names: ['Sommer Krause', 'Allison Wilson', 'Alyssa Bullington'],
        notes: ['One clerk seat becomes exposed after the Sommer transfer completes.'],
      },
      {
        key: 'driver',
        label: 'Driver / Billing',
        allocated: 0.5,
        currentFilled: 0,
        shared: 0.5,
        names: ['Louie Hatler (shared with Monte Vista)'],
      },
      {
        key: 'misc',
        label: 'Misc Support',
        allocated: 1,
        currentFilled: 1,
        names: ['Carl Denson (Compounding RPH)'],
      },
    ],
  },
  {
    pharmacyCode: 'KONAWA',
    pharmacyName: 'Konawa',
    pharmacyColor: '#eab308',
    dashboardNote: 'Konawa is fully staffed to the current allocation profile.',
    roles: [
      {
        key: 'pharmacist',
        label: 'Pharmacist',
        rxRange: '150–200 RX / day',
        allocated: 2,
        currentFilled: 2,
        names: ['Ginger Emrich', 'Christy Gregory'],
      },
      {
        key: 'technician',
        label: 'Technician',
        rxRange: '100–150 RX / day',
        allocated: 3,
        currentFilled: 3,
        names: ['Sarah Madinger', 'Shanna Ridley', 'Emileigh Palmer'],
      },
      {
        key: 'clerk',
        label: 'Clerk',
        rxRange: '200–300 RX / day',
        allocated: 1,
        currentFilled: 1,
        names: ['Shelby Bowles'],
      },
      {
        key: 'driver',
        label: 'Driver / Billing',
        allocated: 0,
        currentFilled: 0,
        names: [],
      },
    ],
  },
  {
    pharmacyCode: 'MONTE_VISTA',
    pharmacyName: 'Monte Vista',
    pharmacyColor: '#2563eb',
    dashboardNote: 'Monte Vista pharmacist coverage currently relies on a temporary PIC assignment.',
    roles: [
      {
        key: 'pharmacist',
        label: 'Pharmacist',
        rxRange: '150–200 RX / day',
        allocated: 2,
        currentFilled: 1,
        temporary: 1,
        names: ['Mercedes Coster', 'OPEN PIC (Kody Stewart - Temporary)'],
        notes: ['One pharmacist seat is temporarily covered by Kody Stewart.'],
      },
      {
        key: 'technician',
        label: 'Technician',
        rxRange: '100–150 RX / day',
        allocated: 4,
        currentFilled: 4,
        names: ['Brandi McWethy', 'Katelyn Roe', 'Shannon Stewart', 'Stephanie Doughty'],
      },
      {
        key: 'clerk',
        label: 'Clerk',
        rxRange: '200–300 RX / day',
        allocated: 3,
        currentFilled: 3,
        names: ['Breana Burkhead', 'Lynette Martin', 'Ty Behara'],
      },
      {
        key: 'driver',
        label: 'Driver / Billing',
        allocated: 0.5,
        currentFilled: 0,
        shared: 0.5,
        names: ['Louie Hatler (shared with Arlington)'],
      },
    ],
  },
  {
    pharmacyCode: 'SEMINOLE',
    pharmacyName: 'Seminole',
    pharmacyColor: '#16a34a',
    dashboardNote: 'Seminole has a half-driver allocation and full pharmacist / technician / clerk coverage.',
    roles: [
      {
        key: 'pharmacist',
        label: 'Pharmacist',
        rxRange: '150–200 RX / day',
        allocated: 2,
        currentFilled: 2,
        names: ['Chad Thomas', 'Andrew Sanders'],
      },
      {
        key: 'technician',
        label: 'Technician',
        rxRange: '100–150 RX / day',
        allocated: 2,
        currentFilled: 2,
        names: ['Lauren Keene', 'Hannah Heard'],
      },
      {
        key: 'clerk',
        label: 'Clerk',
        rxRange: '200–300 RX / day',
        allocated: 2,
        currentFilled: 2,
        names: ['Brandy Grant', 'Krystal Khalil'],
      },
      {
        key: 'driver',
        label: 'Driver / Billing',
        allocated: 0.5,
        currentFilled: 0.5,
        names: ['David Hagans'],
      },
    ],
  },
];

export const ADMIN_SUPPORT = {
  pharmacistSupport: ['Kody Stewart', 'Blake Worlund'],
  billingSupport: ['Virginia Becklelhimer'],
};

function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function money(value: number) {
  return Number(value.toFixed(2));
}

function weekdayFromDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 3000) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getUTCDay();
}

function weekdayWeight(weekday: number | null) {
  if (weekday == null) return 0;
  if (weekday >= 1 && weekday <= 4) return 1;
  if (weekday === 5) return 0.5;
  return 0;
}

function operatingDayWeight(dateValue: string | null | undefined) {
  if (!dateValue) return 0;
  const normalized = String(dateValue).trim();
  if (!normalized) return 0;

  // Parse date-only values explicitly to avoid timezone shifts.
  const isoDateMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  if (isoDateMatch) {
    const year = Number(isoDateMatch[1]);
    const month = Number(isoDateMatch[2]);
    const day = Number(isoDateMatch[3]);
    return weekdayWeight(weekdayFromDateParts(year, month, day));
  }

  // Support common US date format exports (MM/DD/YYYY).
  const usDateMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usDateMatch) {
    const month = Number(usDateMatch[1]);
    const day = Number(usDateMatch[2]);
    const year = Number(usDateMatch[3]);
    return weekdayWeight(weekdayFromDateParts(year, month, day));
  }

  // Unknown date format intentionally resolves to no weighted day so ambiguous parsing cannot skew staffing rates.
  return 0;
}

function safeCeil(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value);
}

function capacityStatus(available: number, stretchNeed: number, preferredNeed: number) {
  if (preferredNeed === 0) return 'No demand observed';
  if (available >= preferredNeed) return 'At or above preferred coverage';
  if (available >= stretchNeed) return 'Within stretch range';
  if (available > 0) return 'Below minimum coverage';
  return 'Open coverage needed';
}

function pressureLevel(status: string) {
  if (/below minimum|open coverage/i.test(status)) return 'high';
  if (/stretch/i.test(status)) return 'medium';
  return 'low';
}

function staffingNeed(avgRxPerWeightedDay: number, role: StaffingRoleKey) {
  if (role === 'pharmacist') {
    return { stretchNeed: safeCeil(avgRxPerWeightedDay / 200), preferredNeed: safeCeil(avgRxPerWeightedDay / 150) };
  }
  if (role === 'technician') {
    return { stretchNeed: safeCeil(avgRxPerWeightedDay / 150), preferredNeed: safeCeil(avgRxPerWeightedDay / 100) };
  }
  if (role === 'clerk') {
    return { stretchNeed: safeCeil(avgRxPerWeightedDay / 300), preferredNeed: safeCeil(avgRxPerWeightedDay / 200) };
  }
  return { stretchNeed: 0, preferredNeed: 0 };
}

export function buildStaffingState(pioneerClaims: PioneerClaim[]) {
  const rawWeightedOperatingByPharmacy: number[] = [];
  const perPharmacy = STAFFING_PROFILE.map((profile) => {
    const claims = pioneerClaims.filter((claim) => claim.pharmacyCode === profile.pharmacyCode);
    const operatingDates = [...new Set(claims.map((claim) => claim.fillDate || claim.claimDate).filter(Boolean) as string[])];
    const rawWeightedOperatingDays = operatingDates.reduce((sum, date) => sum + operatingDayWeight(date), 0);
    rawWeightedOperatingByPharmacy.push(rawWeightedOperatingDays);
    const weightedOperatingDays = round(rawWeightedOperatingDays);
    const rawAvgRxPerWeightedDay = rawWeightedOperatingDays > 0 ? claims.length / rawWeightedOperatingDays : claims.length;
    const avgRxPerWeightedDay = round(rawAvgRxPerWeightedDay);
    const medDClaims = claims.filter((claim) => claim.payerType === 'Med D').length;

    const roleRows = profile.roles
      .slice()
      .sort((a, b) => roleOrder.indexOf(a.key) - roleOrder.indexOf(b.key))
      .map((role) => {
        const temporary = role.temporary ?? 0;
        const transitioningIn = role.transitioningIn ?? 0;
        const transitioningOut = role.transitioningOut ?? 0;
        const shared = role.shared ?? 0;
        const availableCoverage = round(role.currentFilled + temporary + transitioningIn + shared - transitioningOut, 1);
        const openPositions = Math.max(round(role.allocated - availableCoverage, 1), 0);
        const needs = staffingNeed(rawAvgRxPerWeightedDay, role.key);
        const status = capacityStatus(availableCoverage, needs.stretchNeed, needs.preferredNeed);
        return {
          ...role,
          temporary,
          transitioningIn,
          transitioningOut,
          shared,
          availableCoverage,
          openPositions,
          stretchNeed: needs.stretchNeed,
          preferredNeed: needs.preferredNeed,
          status,
          pressureLevel: pressureLevel(status),
        };
      });

    const capacityRoles = roleRows.filter((role) => role.key === 'pharmacist' || role.key === 'technician' || role.key === 'clerk');
    const pressurePoints = capacityRoles.filter((role) => role.pressureLevel !== 'low');
    const filledCoreFte = money(roleRows.reduce((sum, role) => sum + role.currentFilled + role.temporary + role.shared, 0));
    const allocatedFte = money(roleRows.reduce((sum, role) => sum + role.allocated, 0));
    const openExposure = roleRows.some((role) => role.openPositions > 0 || role.temporary > 0 || role.transitioningOut > 0);

    return {
      pharmacyCode: profile.pharmacyCode,
      pharmacyName: profile.pharmacyName,
      pharmacyColor: profile.pharmacyColor,
      observedRx: claims.length,
      medDClaims,
      weightedOperatingDays,
      avgRxPerWeightedDay,
      allocatedFte,
      filledCoreFte,
      openFte: money(Math.max(allocatedFte - filledCoreFte, 0)),
      pressurePoints: pressurePoints.length,
      openExposure,
      staffingStatus: pressurePoints.some((role) => role.pressureLevel === 'high')
        ? 'High pressure'
        : openExposure
          ? 'Open exposure'
          : pressurePoints.length
            ? 'Monitor'
            : 'Stable',
      dashboardNote: profile.dashboardNote,
      roles: roleRows,
      roster: profile.roles.reduce<Record<string, string[]>>((acc, role) => {
        acc[role.label] = role.names;
        return acc;
      }, {}),
      actionItems: [...pressurePoints.map((role) => `${role.label}: ${role.status}`), ...roleRows.filter((role) => role.openPositions > 0 || role.temporary > 0 || role.transitioningOut > 0).map((role) => `${role.label}: transition or coverage exposure`)],
    };
  });

  const overallObservedRx = perPharmacy.reduce((sum, item) => sum + item.observedRx, 0);
  const overallWeightedDaysRaw = rawWeightedOperatingByPharmacy.reduce((sum, value) => sum + value, 0);
  const overallWeightedDays = round(overallWeightedDaysRaw);
  const overallAvgRxPerWeightedDay = overallWeightedDays > 0 ? round(overallObservedRx / overallWeightedDays) : overallObservedRx;

  return {
    byPharmacy: perPharmacy,
    summary: {
      totalObservedRx: overallObservedRx,
      totalWeightedOperatingDays: overallWeightedDays,
      overallAvgRxPerWeightedDay,
      pharmaciesWithPressure: perPharmacy.filter((item) => item.pressurePoints > 0 || item.openExposure).length,
      totalAllocatedFte: money(perPharmacy.reduce((sum, item) => sum + item.allocatedFte, 0)),
      totalFilledFte: money(perPharmacy.reduce((sum, item) => sum + item.filledCoreFte, 0)),
      totalOpenFte: money(perPharmacy.reduce((sum, item) => sum + item.openFte, 0)),
      adminSupport: ADMIN_SUPPORT,
    },
  };
}

export function pharmacyColorMap() {
  return PHARMACIES.reduce<Record<string, string>>((acc, pharmacy) => {
    acc[pharmacy.code] = pharmacy.color;
    return acc;
  }, {});
}
