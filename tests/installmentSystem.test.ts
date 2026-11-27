import assert from 'node:assert/strict';
import {
  calculateInstallmentSchedule,
  clampInstallmentDuration,
  maskNidNumber,
  recomputeAgreementFromPayments,
  roundMoney,
} from '../src/utils/installmentUtils';
import {
  buildInstallmentReceiptHtml,
  buildInstallmentSlipHtml,
} from '../src/utils/installmentSlipExport';
import {
  cancelActivePrintJob,
  isPrintJobPreparing,
  printDocument,
  scopeFallbackPrintCss,
} from '../src/utils/printEngine';
import {
  Branch,
  Customer,
  InstallmentAgreement,
  InstallmentPaymentRecord,
  ShopSettings,
} from '../src/types';

// Mock localStorage/window for node test environment
const memoryStorage = new Map<string, string>();
if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryStorage.set(k, String(v));
    },
    removeItem: (k: string) => {
      memoryStorage.delete(k);
    },
    clear: () => {
      memoryStorage.clear();
    },
  };
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    localStorage: (globalThis as any).localStorage,
  };
}

// 1. Duration Clamping (1..6 Months strictly) & Exact Sum Reconciliation
assert.equal(clampInstallmentDuration(0), 1);
assert.equal(clampInstallmentDuration(-5), 1);
assert.equal(clampInstallmentDuration(3), 3);
assert.equal(clampInstallmentDuration(6), 6);
assert.equal(clampInstallmentDuration(12), 6);

// Example A: 6,000 / 6 = 1,000 x 6
const sched6000 = calculateInstallmentSchedule(6000, 6, '2026-01-10');
assert.equal(sched6000.schedule.length, 6);
assert.equal(sched6000.monthlyInstallment, 1000);
assert.equal(
  roundMoney(sched6000.schedule.reduce((s, r) => s + r.amount, 0)),
  6000
);

// Example B: 10,000 total - 2,000 down = 8,000 over 6 months (1333*5 + 1335 === 8000)
const sched8000 = calculateInstallmentSchedule(8000, 6, '2026-01-10');
assert.equal(sched8000.schedule.length, 6);
assert.equal(sched8000.monthlyInstallment, 1333);
assert.equal(sched8000.schedule[5].amount, 1335);
assert.equal(
  roundMoney(sched8000.schedule.reduce((s, r) => s + r.amount, 0)),
  8000
);
assert.equal(sched8000.schedule[0].dueDate, '2026-01-10');
assert.equal(sched8000.schedule[1].dueDate, '2026-02-10');
assert.equal(sched8000.schedule[5].dueDate, '2026-06-10');

// Example C: 6,500 / 6 months (1083*5 + 1085 === 6500)
const sched6500 = calculateInstallmentSchedule(6500, 6, '2026-01-10');
assert.equal(sched6500.monthlyInstallment, 1083);
assert.equal(sched6500.schedule[5].amount, 1085);
assert.equal(
  roundMoney(sched6500.schedule.reduce((s, r) => s + r.amount, 0)),
  6500
);

// Month-end date clamping (Jan 31 -> Feb 28)
const schedJan31 = calculateInstallmentSchedule(3000, 3, '2026-01-31');
assert.equal(schedJan31.schedule[1].dueDate, '2026-02-28');
assert.equal(schedJan31.schedule[2].dueDate, '2026-03-31');

// 2. Payment Allocation, Overdue Computation & Immutable Reversal
const baseAgreement: InstallmentAgreement = {
  id: 'ag-1',
  businessId: 'biz-1',
  branchId: 'br-main',
  agreementCode: 'INS-0001',
  saleId: 'sale-1',
  invoiceNumber: 'INV-2026-0001',
  customerId: 'cust-1',
  customerCode: 'CUST-01',
  customerName: 'Kamrul Hasan',
  customerMobile: '01811-000111',
  customerAddress: 'Mirpur-10, Dhaka',
  customerPhotoUrl: 'data:image/png;base64,CUSTPHOTO',
  customerNidNumber: '1990123456789',
  hasIdentityDocuments: true,
  items: [
    { productName: 'Formal Blazer', size: 'L', color: 'Navy', quantity: 1, unitPrice: 6500, totalPrice: 6500 },
    { productName: 'Cotton Shirt', size: 'L', color: 'White', quantity: 1, unitPrice: 3500, totalPrice: 3500 },
  ],
  totalPurchaseAmount: 10000,
  downPayment: 2000,
  installmentBalance: 8000,
  durationMonths: 6,
  monthlyInstallment: 1333,
  firstDueDate: '2026-01-10',
  agreementDate: '2025-12-10',
  status: 'unpaid',
  installmentsPaid: 0,
  totalPaidAmount: 2000,
  remainingDue: 8000,
  overdueAmount: 0,
  schedule: sched8000.schedule,
  createdAt: '2025-12-10T10:00:00Z',
  updatedAt: '2025-12-10T10:00:00Z',
};

const payments: InstallmentPaymentRecord[] = [
  {
    id: 'pmt-1',
    businessId: 'biz-1',
    agreementId: 'ag-1',
    agreementCode: 'INS-0001',
    customerId: 'cust-1',
    customerName: 'Kamrul Hasan',
    receiptNumber: 'RCP-260110-1001',
    paymentDate: '2026-01-10',
    amount: 1333,
    paymentMethod: 'cash',
    accountId: 'acc-cash',
    accountName: 'Cash in Hand',
    collectedBy: 'Admin',
    status: 'posted',
    createdAt: '2026-01-10T11:00:00Z',
  },
  {
    id: 'pmt-2',
    businessId: 'biz-1',
    agreementId: 'ag-1',
    agreementCode: 'INS-0001',
    customerId: 'cust-1',
    customerName: 'Kamrul Hasan',
    receiptNumber: 'RCP-260210-1002',
    paymentDate: '2026-02-12',
    amount: 1333,
    paymentMethod: 'bkash',
    accountId: 'acc-bkash',
    accountName: 'bKash Merchant',
    collectedBy: 'Cashier',
    status: 'posted',
    createdAt: '2026-02-12T12:00:00Z',
  },
];

// Recompute as of 2026-03-15 (installment #3 due 2026-03-10 is overdue!)
const afterTwoPayments = recomputeAgreementFromPayments(baseAgreement, payments, '2026-03-15');
assert.equal(afterTwoPayments.installmentsPaid, 2666);
assert.equal(afterTwoPayments.totalPaidAmount, 4666); // downPayment 2000 + installmentsPaid 2666
assert.equal(afterTwoPayments.remainingDue, 5334);
assert.equal(afterTwoPayments.status, 'partial');
assert.equal(afterTwoPayments.lastPaymentDate, '2026-02-12');
assert.equal(afterTwoPayments.nextDueDate, '2026-03-10');
assert.equal(afterTwoPayments.overdueAmount, 1333);
assert.equal(afterTwoPayments.schedule[0].status, 'paid');
assert.equal(afterTwoPayments.schedule[1].status, 'paid');
assert.equal(afterTwoPayments.schedule[2].status, 'overdue');

// Reverse pmt-2 (immutable: payment record remains with status === 'reversed')
const withReversed = payments.map(p =>
  p.id === 'pmt-2' ? { ...p, status: 'reversed' as const, reversalReason: 'Wrong customer entry' } : p
);
const afterReversal = recomputeAgreementFromPayments(baseAgreement, withReversed, '2026-03-15');
assert.equal(afterReversal.installmentsPaid, 1333);
assert.equal(afterReversal.totalPaidAmount, 3333);
assert.equal(afterReversal.remainingDue, 6667);
assert.equal(afterReversal.lastPaymentDate, '2026-01-10');
assert.equal(afterReversal.nextDueDate, '2026-02-10');
assert.equal(afterReversal.overdueAmount, 2666); // Feb + Mar overdue

// Full payoff test
const fullPayment: InstallmentPaymentRecord[] = [
  {
    id: 'pmt-full',
    businessId: 'biz-1',
    agreementId: 'ag-1',
    agreementCode: 'INS-0001',
    customerId: 'cust-1',
    customerName: 'Kamrul Hasan',
    receiptNumber: 'RCP-FULL',
    paymentDate: '2026-01-15',
    amount: 8000,
    paymentMethod: 'cash',
    accountId: 'acc-cash',
    collectedBy: 'Admin',
    status: 'posted',
    createdAt: '2026-01-15T10:00:00Z',
  },
];
const paidFull = recomputeAgreementFromPayments(baseAgreement, fullPayment, '2026-03-15');
assert.equal(paidFull.status, 'paid');
assert.equal(paidFull.remainingDue, 0);
assert.equal(paidFull.overdueAmount, 0);
assert.equal(paidFull.nextDueDate, undefined);
assert.equal(paidFull.installmentsPaid, 8000);
assert.equal(paidFull.totalPaidAmount, 10000);
assert.equal(paidFull.schedule.filter(r => r.status === 'paid').length, 6);

// 3. NID Masking & Optional Missing Photo/NID Safety
assert.equal(maskNidNumber('1990123456789'), '*********6789');
assert.equal(maskNidNumber(''), '');

// 4. Dynamic Shop Profile + Language Modes + STRICT Customer Copy Rules
const realShopSettings: ShopSettings = {
  shopName: 'Dhanmondi Heritage Tailors',
  tagline: 'Crafted Elegance Since 2012',
  address: 'Shop 44, Satmasjid Road, Dhanmondi, Dhaka',
  mobile: '01999-887766',
  email: 'heritage.tailors@gmail.com',
  logoUrl: 'data:image/png;base64,REALSHOPLOGO',
  vatTaxRate: 0,
  invoiceFormat: 'a4',
  businessType: 'clothing',
  currency: 'BDT (৳)',
  financialYear: '2026-2027',
  language: 'bn',
  uiMode: 'advanced',
};

const sampleBranch: Branch = {
  id: 'br-main',
  name: 'Main Showroom',
  location: 'Satmasjid Road, Dhaka',
  mobile: '01999-887766',
  isMain: true,
};

const customerWithFullKyc: Customer = {
  id: 'cust-1',
  customerCode: 'CUST-01',
  name: 'Kamrul Hasan',
  mobile: '01811-000111',
  address: 'Mirpur-10, Dhaka',
  customerType: 'retail',
  openingDue: 0,
  totalPurchase: 10000,
  totalPaid: 4666,
  currentDue: 5334,
  creditLimit: 50000,
  photoUrl: 'data:image/png;base64,CUSTPHOTO',
  nidNumber: '1990123456789',
  nidFrontUrl: 'data:image/png;base64,SECRET_NID_FRONT_IMAGE',
  nidBackUrl: 'data:image/png;base64,SECRET_NID_BACK_IMAGE',
  createdAt: '2025-12-10',
};

const bnHtml = buildInstallmentSlipHtml({
  agreement: afterTwoPayments,
  settings: realShopSettings,
  activeBranch: sampleBranch,
  customer: customerWithFullKyc,
  language: 'bn',
});

// Verify dynamic shop info & NO hardcoded sample data
assert.ok(bnHtml.includes('Dhanmondi Heritage Tailors'));
assert.ok(bnHtml.includes('01999-887766'));
assert.ok(bnHtml.includes('heritage.tailors@gmail.com'));
assert.ok(bnHtml.includes('REALSHOPLOGO'));
assert.ok(!bnHtml.includes('Protiva Fashion'));
assert.ok(!bnHtml.includes('01712-345678'));
assert.ok(!bnHtml.includes('Rahim Hossain'));

// Verify NID masking & NO raw NID card images leaked onto Customer Copy
assert.ok(bnHtml.includes('*********6789'));
assert.ok(!bnHtml.includes('1990123456789'));
assert.ok(!bnHtml.includes('SECRET_NID_FRONT_IMAGE'));
assert.ok(!bnHtml.includes('SECRET_NID_BACK_IMAGE'));

// Verify STRICT §4 & §8 rule: NO Last Payment Date & NO Remaining Due on Customer Copy
for (const langMode of ['bn', 'en', 'both'] as const) {
  const html = buildInstallmentSlipHtml({
    agreement: afterTwoPayments,
    settings: realShopSettings,
    activeBranch: sampleBranch,
    customer: customerWithFullKyc,
    language: langMode,
  });
  assert.ok(!html.includes('Last Payment Date'), `Last Payment Date must not appear in ${langMode} slip`);
  assert.ok(!html.includes('সর্বশেষ পেমেন্ট'), `Bangla Last Payment Date must not appear in ${langMode} slip`);
  assert.ok(!html.includes('Remaining Due'), `Remaining Due must not appear in ${langMode} slip`);
  assert.ok(!html.includes('বর্তমান বাকি'), `Bangla Remaining Due must not appear in ${langMode} slip`);
  // Verify original saved customer & product names remain intact
  assert.ok(html.includes('Kamrul Hasan'));
  assert.ok(html.includes('Formal Blazer'));
}

// Customer WITHOUT optional photo or NID renders cleanly
const customerNoKyc: Customer = {
  ...customerWithFullKyc,
  photoUrl: undefined,
  nidNumber: undefined,
  nidFrontUrl: undefined,
  nidBackUrl: undefined,
};
const agreementNoKyc: InstallmentAgreement = {
  ...afterTwoPayments,
  customerPhotoUrl: undefined,
  customerNidNumber: undefined,
  hasIdentityDocuments: false,
};
const noKycEnHtml = buildInstallmentSlipHtml({
  agreement: agreementNoKyc,
  settings: realShopSettings,
  customer: customerNoKyc,
  language: 'en',
});
assert.ok(noKycEnHtml.includes('Optional · Not Provided'));
assert.ok(noKycEnHtml.includes('No Photo'));

// 4. Print Layout Isolation & CSS Reset Regression Tests
// 4a. Slip & Receipt HTML must NEVER emit bare unscoped `html, body { width: 210mm }` or bare `* {` rules
assert.ok(!/^\s*\*\s*\{/m.test(bnHtml), 'Slip CSS must scope universal reset inside .slip-sheet');
assert.ok(!/^\s*html,\s*body\s*\{/m.test(bnHtml), 'Slip CSS must scope html, body selector');
assert.ok(bnHtml.includes('.slip-sheet'), 'Slip wrapper .slip-sheet must remain intact');
assert.ok(bnHtml.includes('width: 210mm;'), 'A4 210mm width remains on .slip-sheet');

const receiptHtml = buildInstallmentReceiptHtml({
  payment: payments[0],
  agreement: afterTwoPayments,
  settings: realShopSettings,
  activeBranch: sampleBranch,
});
assert.ok(!/^\s*body\s*\{/m.test(receiptHtml), 'Receipt CSS must scope body styles to .receipt-sheet');
assert.ok(receiptHtml.includes('.receipt-sheet'));

// 4b. Fallback CSS scoper must isolate @media screen & bare html/body/* selectors inside @media print + #root
const scopedFallback = scopeFallbackPrintCss(
  `
  @page { size: A4 portrait; margin: 0; }
  * { margin: 0; padding: 0; }
  html, body { width: 210mm; background: #fff; }
  @media screen { body { background: red; } }
  .slip-sheet { width: 210mm; }
  `,
  'amar-dokan-print-root'
);
assert.ok(!scopedFallback.includes('background: red'), 'Screen rules must be stripped from fallback print CSS');
assert.ok(!/\bhtml\b|\bbody\b/.test(scopedFallback), 'Bare html/body selectors must be rewritten to #amar-dokan-print-root');
assert.ok(scopedFallback.includes('#amar-dokan-print-root .slip-sheet'));
assert.ok(scopedFallback.includes('@media print'));

// 4c. Simulated DOM test: 6 consecutive Print + Cancel/afterprint cycles using isolated iframe
{
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;

  const winListeners = new Map<string, Set<Function>>();
  const headChildren: any[] = [];
  const bodyChildren: any[] = [];
  let iframePrintCalls = 0;
  let hostPrintCalls = 0;

  const makeMockElement = (tagName: string) => {
    const el: any = {
      tagName: tagName.toUpperCase(),
      id: '',
      tabIndex: 0,
      innerHTML: '',
      textContent: '',
      attributes: new Map<string, string>(),
      style: { cssText: '' },
      parentNode: null,
      setAttribute: (k: string, v: string) => el.attributes.set(k, v),
      getAttribute: (k: string) => el.attributes.get(k) ?? null,
      offsetHeight: 1123,
    };
    if (tagName.toLowerCase() === 'iframe') {
      const iframeListeners = new Map<string, Set<Function>>();
      let writtenHtml = '';
      const iframeDoc: any = {
        title: '',
        body: { offsetHeight: 1123 },
        open: () => {
          writtenHtml = '';
        },
        write: (html: string) => {
          writtenHtml += html;
        },
        close: () => {},
        get writtenHtml() {
          return writtenHtml;
        },
      };
      const iframeWin: any = {
        document: iframeDoc,
        focus: () => {},
        print: () => {
          iframePrintCalls += 1;
        },
        addEventListener: (ev: string, fn: Function) => {
          if (!iframeListeners.has(ev)) iframeListeners.set(ev, new Set());
          iframeListeners.get(ev)!.add(fn);
        },
        removeEventListener: (ev: string, fn: Function) => {
          iframeListeners.get(ev)?.delete(fn);
        },
        dispatchEvent: (ev: { type: string }) => {
          for (const fn of Array.from(iframeListeners.get(ev.type) || [])) {
            fn(ev);
          }
        },
        get listenerCount() {
          let total = 0;
          iframeListeners.forEach(set => (total += set.size));
          return total;
        },
      };
      el.contentDocument = iframeDoc;
      el.contentWindow = iframeWin;
    }
    return el;
  };

  const mockDocument: any = {
    title: 'PROTIVA Retail ERP',
    documentElement: { className: '', style: { cssText: '' } },
    head: {
      children: headChildren,
      appendChild: (node: any) => {
        node.parentNode = mockDocument.head;
        headChildren.push(node);
        return node;
      },
      removeChild: (node: any) => {
        const idx = headChildren.indexOf(node);
        if (idx !== -1) headChildren.splice(idx, 1);
        node.parentNode = null;
      },
    },
    body: {
      className: '',
      style: { cssText: '' },
      children: bodyChildren,
      appendChild: (node: any) => {
        node.parentNode = mockDocument.body;
        bodyChildren.push(node);
        return node;
      },
      removeChild: (node: any) => {
        const idx = bodyChildren.indexOf(node);
        if (idx !== -1) bodyChildren.splice(idx, 1);
        node.parentNode = null;
      },
    },
    createElement: (tag: string) => makeMockElement(tag),
    getElementById: (id: string) =>
      [...headChildren, ...bodyChildren].find(n => n.id === id) ?? null,
  };

  const mockWindow: any = {
    localStorage: (globalThis as any).localStorage,
    setTimeout,
    clearTimeout,
    print: () => {
      hostPrintCalls += 1;
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: (ev: string, fn: Function) => {
        if (!winListeners.has(`mql:${ev}`)) winListeners.set(`mql:${ev}`, new Set());
        winListeners.get(`mql:${ev}`)!.add(fn);
      },
      removeEventListener: (ev: string, fn: Function) => {
        winListeners.get(`mql:${ev}`)?.delete(fn);
      },
    }),
    addEventListener: (ev: string, fn: Function) => {
      if (!winListeners.has(ev)) winListeners.set(ev, new Set());
      winListeners.get(ev)!.add(fn);
    },
    removeEventListener: (ev: string, fn: Function) => {
      winListeners.get(ev)?.delete(fn);
    },
    dispatchEvent: (ev: { type: string }) => {
      for (const fn of Array.from(winListeners.get(ev.type) || [])) {
        fn(ev);
      }
    },
  };

  (globalThis as any).window = mockWindow;
  (globalThis as any).document = mockDocument;

  try {
    for (let cycle = 1; cycle <= 6; cycle++) {
      const res = printDocument(bnHtml, `Installment Slip - INS-0001`);
      assert.equal(res.opened, true, `Cycle ${cycle}: print should open`);
      assert.equal(isPrintJobPreparing(), false, `Cycle ${cycle}: printing flag must reset cleanly`);
      assert.equal(headChildren.length, 0, `Cycle ${cycle}: host document.head must receive ZERO injected styles`);
      assert.equal(bodyChildren.length, 1, `Cycle ${cycle}: exactly one isolated print iframe mounted`);
      assert.equal(bodyChildren[0].id, 'amar-dokan-print-iframe');
      assert.equal(mockDocument.title, 'PROTIVA Retail ERP', `Cycle ${cycle}: host document title restored`);
      assert.equal(mockDocument.documentElement.style.cssText, '');
      assert.equal(mockDocument.body.style.cssText, '');
      assert.equal(mockDocument.documentElement.className, '');
      assert.equal(mockDocument.body.className, '');

      // Alternate between afterprint (normal close) and cancelActivePrintJob (modal close / cancel)
      if (cycle % 2 === 1) {
        mockWindow.dispatchEvent({ type: 'afterprint' });
      } else {
        cancelActivePrintJob();
      }

      assert.equal(bodyChildren.length, 0, `Cycle ${cycle}: print iframe must be cleaned up after print/cancel`);
      assert.equal(headChildren.length, 0, `Cycle ${cycle}: host head must remain empty`);
      assert.equal(winListeners.get('afterprint')?.size ?? 0, 0, `Cycle ${cycle}: no leaked afterprint listeners`);
      assert.equal(winListeners.get('focus')?.size ?? 0, 0, `Cycle ${cycle}: no leaked focus listeners`);
      assert.equal(winListeners.get('mql:change')?.size ?? 0, 0, `Cycle ${cycle}: no leaked matchMedia listeners`);
    }

    assert.equal(iframePrintCalls, 6);
    assert.equal(hostPrintCalls, 0);
  } finally {
    cancelActivePrintJob();
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
  }
}

console.log('✅ All installmentSystem.test.ts assertions passed!');
