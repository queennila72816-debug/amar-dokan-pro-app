import {
  InstallmentAgreement,
  InstallmentAgreementStatus,
  InstallmentDurationMonths,
  InstallmentPaymentRecord,
  InstallmentProductItem,
  InstallmentScheduleItem,
  InstallmentSlipLanguage,
} from '../types';

export const roundMoney = (n: number): number =>
  Math.round((Number(n) || 0) * 100) / 100;

export function clampInstallmentDuration(months: number): InstallmentDurationMonths {
  const n = Math.round(Number(months) || 1);
  if (n <= 1) return 1;
  if (n >= 6) return 6;
  return n as InstallmentDurationMonths;
}

export function getTodayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addMonthsKeepingAnchor(dateStr: string, monthsToAdd: number): string {
  const clean = (dateStr || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  const now = new Date();
  const baseYear = match ? Number(match[1]) : now.getFullYear();
  const baseMonthIndex = match ? Number(match[2]) - 1 : now.getMonth();
  const baseDay = match ? Number(match[3]) : now.getDate();

  const totalMonths = baseYear * 12 + baseMonthIndex + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12;

  const daysInTargetMonth = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const clampedDay = Math.min(baseDay, daysInTargetMonth);

  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function getDefaultFirstDueDate(agreementDate?: string): string {
  const base = agreementDate ? agreementDate.slice(0, 10) : getTodayIsoDate();
  return addMonthsKeepingAnchor(base, 1);
}

const ORDINAL_EN = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const ORDINAL_BN = ['১ম', '২য়', '৩য়', '৪র্থ', '৫ম', '৬ষ্ঠ'];

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBnDigits(value: string | number): string {
  return String(value).replace(/\d/g, d => BN_DIGITS[Number(d)] ?? d);
}

export function formatSlipCurrency(amount: number, lang: InstallmentSlipLanguage): string {
  const rounded = roundMoney(amount);
  const hasDecimals = Math.abs(rounded - Math.round(rounded)) > 0.001;
  const formatted = rounded.toLocaleString('en-US', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  });
  if (lang === 'bn') {
    return `৳${toBnDigits(formatted)}`;
  }
  return `৳${formatted}`;
}

export function formatSlipNumber(val: number | string, lang: InstallmentSlipLanguage): string {
  const str = String(val);
  return lang === 'bn' ? toBnDigits(str) : str;
}

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

export function formatSlipDate(dateStr: string | undefined, lang: InstallmentSlipLanguage): string {
  if (!dateStr) return lang === 'bn' ? 'নির্ধারিত নয়' : 'N/A';
  const clean = dateStr.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  let y: number;
  let moIdx: number;
  let d: number;
  if (m) {
    y = Number(m[1]);
    moIdx = Number(m[2]) - 1;
    d = Number(m[3]);
  } else {
    const dt = new Date(dateStr);
    if (Number.isNaN(dt.getTime())) return dateStr;
    y = dt.getFullYear();
    moIdx = dt.getMonth();
    d = dt.getDate();
  }

  const enStr = `${d} ${MONTHS_EN[moIdx] || ''} ${y}`;
  const bnStr = `${toBnDigits(d)} ${MONTHS_BN[moIdx] || ''} ${toBnDigits(y)}`;
  if (lang === 'bn') return bnStr;
  if (lang === 'both') return `${bnStr} (${enStr})`;
  return enStr;
}

export function maskNidNumber(nid?: string | null): string {
  const raw = (nid || '').trim();
  if (!raw) return '';
  if (raw.length <= 4) return '*'.repeat(raw.length);
  const visibleTail = raw.slice(-4);
  return `${'*'.repeat(Math.max(4, raw.length - 4))}${visibleTail}`;
}

export interface ScheduleCalculationResult {
  durationMonths: InstallmentDurationMonths;
  installmentBalance: number;
  monthlyInstallment: number; // Base monthly installment
  lastInstallmentAmount: number;
  schedule: InstallmentScheduleItem[];
}

/**
 * Generates exact 1..6 monthly installment rows.
 * Base installment = integer floor (or 2-decimal floor when balance has fractions),
 * and any remainder is adjusted on the final installment so SUM(schedule) === installmentBalance ALWAYS.
 */
export function calculateInstallmentSchedule(
  installmentBalanceRaw: number,
  durationMonthsRaw: number,
  firstDueDateRaw: string
): ScheduleCalculationResult {
  const durationMonths = clampInstallmentDuration(durationMonthsRaw);
  const installmentBalance = roundMoney(Math.max(0, installmentBalanceRaw));
  const firstDue = firstDueDateRaw ? firstDueDateRaw.slice(0, 10) : getDefaultFirstDueDate();

  if (installmentBalance <= 0) {
    const zeroRows: InstallmentScheduleItem[] = Array.from({ length: durationMonths }, (_, idx) => ({
      installmentNumber: idx + 1,
      labelEn: `${ORDINAL_EN[idx] || `${idx + 1}th`} Installment`,
      labelBn: `${ORDINAL_BN[idx] || `${toBnDigits(idx + 1)}তম`} কিস্তি`,
      dueDate: addMonthsKeepingAnchor(firstDue, idx),
      amount: 0,
      paidAmount: 0,
      status: 'paid',
    }));
    return {
      durationMonths,
      installmentBalance: 0,
      monthlyInstallment: 0,
      lastInstallmentAmount: 0,
      schedule: zeroRows,
    };
  }

  const isWholeBalance = Math.abs(installmentBalance - Math.round(installmentBalance)) < 0.001;
  const baseAmount = isWholeBalance
    ? Math.floor(installmentBalance / durationMonths)
    : Math.floor((installmentBalance * 100) / durationMonths) / 100;

  let runningSum = 0;
  const schedule: InstallmentScheduleItem[] = [];
  for (let idx = 0; idx < durationMonths; idx++) {
    const isLast = idx === durationMonths - 1;
    const amount = isLast
      ? roundMoney(installmentBalance - runningSum)
      : roundMoney(baseAmount);
    runningSum = roundMoney(runningSum + amount);

    schedule.push({
      installmentNumber: idx + 1,
      labelEn: `${ORDINAL_EN[idx] || `${idx + 1}th`} Installment`,
      labelBn: `${ORDINAL_BN[idx] || `${toBnDigits(idx + 1)}তম`} কিস্তি`,
      dueDate: addMonthsKeepingAnchor(firstDue, idx),
      amount,
      paidAmount: 0,
      status: 'due',
    });
  }

  return {
    durationMonths,
    installmentBalance,
    monthlyInstallment: roundMoney(baseAmount),
    lastInstallmentAmount: schedule[schedule.length - 1]?.amount ?? roundMoney(baseAmount),
    schedule,
  };
}

/**
 * Recomputes paid totals, FIFO schedule row statuses, nextDueDate, lastPaymentDate,
 * overdueAmount, and agreement status from posted payments.
 */
export function recomputeAgreementFromPayments(
  agreement: InstallmentAgreement,
  payments: InstallmentPaymentRecord[],
  todayIso: string = getTodayIsoDate()
): InstallmentAgreement {
  const agreementPayments = payments
    .filter(p => p.agreementId === agreement.id && p.status === 'posted')
    .sort((a, b) => {
      const dateCmp = a.paymentDate.localeCompare(b.paymentDate);
      if (dateCmp !== 0) return dateCmp;
      return a.createdAt.localeCompare(b.createdAt);
    });

  const installmentsPaid = roundMoney(
    agreementPayments.reduce((sum, p) => sum + Math.max(0, Number(p.amount) || 0), 0)
  );
  const installmentBalance = roundMoney(
    Math.max(0, agreement.totalPurchaseAmount - agreement.downPayment)
  );
  const remainingDue = roundMoney(Math.max(0, installmentBalance - installmentsPaid));
  const totalPaidAmount = roundMoney(agreement.downPayment + installmentsPaid);

  const lastPaymentDate =
    agreementPayments.length > 0
      ? agreementPayments[agreementPayments.length - 1].paymentDate
      : undefined;

  // Rebuild clean base schedule if needed and allocate installmentsPaid FIFO
  const baseSchedule =
    agreement.schedule && agreement.schedule.length === agreement.durationMonths
      ? agreement.schedule
      : calculateInstallmentSchedule(
          installmentBalance,
          agreement.durationMonths,
          agreement.firstDueDate
        ).schedule;

  let pool = installmentsPaid;
  let overdueAmount = 0;
  let nextDueDate: string | undefined = undefined;

  const updatedSchedule: InstallmentScheduleItem[] = baseSchedule.map(row => {
    const dueAmt = roundMoney(Math.max(0, row.amount));
    const allocated = dueAmt <= 0 ? 0 : roundMoney(Math.min(dueAmt, pool));
    pool = roundMoney(Math.max(0, pool - allocated));

    const isPaid = allocated >= dueAmt - 0.001;
    const isOverdue = !isPaid && row.dueDate < todayIso;

    let status: InstallmentScheduleItem['status'] = 'due';
    if (isPaid) {
      status = 'paid';
    } else if (isOverdue) {
      status = 'overdue';
    } else if (allocated > 0) {
      status = 'partial';
    }

    if (!isPaid && !nextDueDate) {
      nextDueDate = row.dueDate;
    }
    if (!isPaid && row.dueDate < todayIso) {
      overdueAmount = roundMoney(overdueAmount + (dueAmt - allocated));
    }

    return {
      ...row,
      paidAmount: allocated,
      status,
      paidDate: isPaid
        ? row.paidDate || lastPaymentDate
        : undefined,
    };
  });

  let agreementStatus: InstallmentAgreementStatus = 'unpaid';
  if (remainingDue <= 0.001) {
    agreementStatus = 'paid';
  } else if (totalPaidAmount > 0.001) {
    agreementStatus = 'partial';
  }

  return {
    ...agreement,
    installmentBalance,
    installmentsPaid,
    totalPaidAmount,
    remainingDue,
    lastPaymentDate,
    nextDueDate,
    overdueAmount,
    status: agreementStatus,
    schedule: updatedSchedule,
  };
}

export function generateAgreementCode(existingCount: number): string {
  const num = existingCount + 1;
  return `INS-${String(num).padStart(4, '0')}`;
}

export function generateInstallmentReceiptNumber(): string {
  const d = new Date();
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `RCP-${y}${m}${day}-${rand}`;
}

export function buildInstallmentItemsFromSaleItems(
  saleItems: {
    productId?: string;
    productName: string;
    variantDetails?: string;
    colorName?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[]
): InstallmentProductItem[] {
  return saleItems.map(it => {
    let size: string | undefined;
    let color: string | undefined = it.colorName;
    if (it.variantDetails) {
      const parts = it.variantDetails.split('/').map(s => s.trim()).filter(Boolean);
      if (parts.length === 2) {
        if (!color) color = parts[0];
        size = parts[1];
      } else if (parts.length === 1) {
        size = parts[0];
      }
    }
    return {
      productId: it.productId,
      productName: it.productName,
      size: size || '—',
      color: color || '—',
      quantity: Number(it.quantity) || 1,
      unitPrice: roundMoney(it.unitPrice),
      totalPrice: roundMoney(it.total),
    };
  });
}

export async function compressKycImageFile(
  file: File,
  maxDimension = 720,
  quality = 0.82
): Promise<string> {
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('Only image files (JPG, PNG, WebP) are supported.');
  }
  if (file.size > 6 * 1024 * 1024) {
    throw new Error('Image size must be 6MB or smaller.');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

  if (typeof document === 'undefined') {
    return rawDataUrl;
  }

  return new Promise<string>(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height, 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

