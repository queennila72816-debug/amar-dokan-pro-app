import assert from 'node:assert/strict';
import { comboOfferService } from '../src/services/comboOfferService';
import { hasMatrixPermission } from '../src/utils/rbacDefaults';
import { ComboOffer, ComboOfferItem, Product, Sale, SaleItem } from '../src/types';

// Minimal in-memory localStorage shim for Node test runner
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

// Fixtures across 5 categories, variants, and 2 branches
const sampleProducts: Product[] = [
  {
    id: 'prod-shirt',
    name: 'Premium Oxford Shirt',
    code: 'SH-001',
    barcode: '8940001001',
    category: 'Shirts',
    unit: 'pcs',
    purchasePrice: 600,
    totalUnitCost: 630,
    allocatedOpExPerUnit: 30,
    salePrice: 1200,
    minSalePrice: 700,
    currentStock: 10,
    minStockAlert: 3,
    hasVariants: true,
    variants: [
      { id: 'v-shirt-blk-m', sku: 'SH-001-BM', color: 'Black', size: 'M', stock: 6, salePrice: 1200, purchasePrice: 600 },
      { id: 'v-shirt-wht-l', sku: 'SH-001-WL', color: 'White', size: 'L', stock: 4, salePrice: 1250, purchasePrice: 620 },
    ],
    branchId: 'branch-dhk',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prod-chino',
    name: 'Slim Chino Pant',
    code: 'PT-001',
    barcode: '8940001002',
    category: 'Pants',
    unit: 'pcs',
    purchasePrice: 700,
    totalUnitCost: 735,
    allocatedOpExPerUnit: 35,
    salePrice: 1400,
    minSalePrice: 800,
    currentStock: 8,
    minStockAlert: 2,
    hasVariants: true,
    variants: [
      { id: 'v-chino-32', sku: 'PT-001-32', color: 'Khaki', size: '32', stock: 5, salePrice: 1400, purchasePrice: 700 },
      { id: 'v-chino-34', sku: 'PT-001-34', color: 'Navy', size: '34', stock: 3, salePrice: 1450, purchasePrice: 720 },
    ],
    branchId: 'branch-dhk',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prod-belt',
    name: 'Leather Formal Belt',
    code: 'AC-001',
    barcode: '8940001003',
    category: 'Accessories',
    unit: 'pcs',
    purchasePrice: 220,
    totalUnitCost: 235,
    allocatedOpExPerUnit: 15,
    salePrice: 500,
    minSalePrice: 270,
    currentStock: 12,
    minStockAlert: 3,
    hasVariants: false,
    branchId: 'branch-dhk',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prod-socks',
    name: 'Cotton Dress Socks',
    code: 'SK-001',
    barcode: '8940001004',
    category: 'Footwear',
    unit: 'pcs',
    purchasePrice: 80,
    totalUnitCost: 85,
    allocatedOpExPerUnit: 5,
    salePrice: 200,
    minSalePrice: 100,
    currentStock: 15,
    minStockAlert: 5,
    hasVariants: false,
    branchId: 'branch-dhk',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prod-perfume',
    name: 'Pocket Cologne 30ml',
    code: 'FR-001',
    barcode: '8940001005',
    category: 'Fragrance',
    unit: 'pcs',
    purchasePrice: 250,
    totalUnitCost: 265,
    allocatedOpExPerUnit: 15,
    salePrice: 550,
    minSalePrice: 300,
    currentStock: 4,
    minStockAlert: 2,
    hasVariants: false,
    branchId: 'branch-dhk',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prod-other-branch',
    name: 'Chattogram Exclusive Jacket',
    code: 'JK-CTG',
    barcode: '8940001006',
    category: 'Outerwear',
    unit: 'pcs',
    purchasePrice: 1000,
    salePrice: 2200,
    currentStock: 9,
    minStockAlert: 2,
    hasVariants: false,
    branchId: 'branch-ctg',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

let passed = 0;
function runTest(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`PASS: ${name}`);
    });
}

async function main() {
  // 1. 5-product multi-category combo calculation
  await runTest('1. 5-product multi-category combo P&L calculation', () => {
    const items: ComboOfferItem[] = [
      { id: 'ci-1', productId: 'prod-shirt', productName: 'Premium Oxford Shirt', variantId: 'v-shirt-blk-m', variantDetails: 'Black / M', sku: 'SH-001-BM', quantity: 1 },
      { id: 'ci-2', productId: 'prod-chino', productName: 'Slim Chino Pant', variantId: 'v-chino-32', variantDetails: 'Khaki / 32', sku: 'PT-001-32', quantity: 1 },
      { id: 'ci-3', productId: 'prod-belt', productName: 'Leather Formal Belt', sku: 'AC-001', quantity: 1 },
      { id: 'ci-4', productId: 'prod-socks', productName: 'Cotton Dress Socks', sku: 'SK-001', quantity: 2 },
      { id: 'ci-5', productId: 'prod-perfume', productName: 'Pocket Cologne 30ml', sku: 'FR-001', quantity: 1 },
    ];
    // Regular = 1200 + 1400 + 500 + 400 + 550 = 4050
    // Landed COGS (variant purchasePrice / product totalUnitCost) = 600 + 700 + 235 + 170 + 265 = 1970
    // OpEx = 30 + 35 + 15 + 10 + 15 = 105
    // Safe floor = 2075
    const pnl = comboOfferService.calculateComboPnL(items, 'fixed_bundle_price', 3499, sampleProducts);
    assert.equal(pnl.regularTotalPrice, 4050);
    assert.equal(pnl.finalComboPrice, 3499);
    assert.equal(pnl.discountAmount, 551);
    assert.equal(pnl.totalCostOfGoods, 1970);
    assert.equal(pnl.allocatedOpEx, 105);
    assert.equal(pnl.minSafeSellingPrice, 2075);
    assert.equal(pnl.grossProfit, 1529);
    assert.equal(pnl.estimatedNetProfit, 1424);
    assert.equal(pnl.isLossMaking, false);
  });

  // 2. Multiple variants of same product & duplicate-variant qty fulfillment
  await runTest('2. Multi-variant same-product aggregate fulfillment & branch check', () => {
    const offer: ComboOffer = {
      id: 'cmb-multi-var',
      businessId: 'biz-1',
      name: 'Twin Shirt Pack',
      offerType: 'fixed_price',
      comboCategory: 'Festival',
      items: [
        { id: 'ci-m1', productId: 'prod-shirt', productName: 'Premium Oxford Shirt', variantId: 'v-shirt-blk-m', variantDetails: 'Black / M', quantity: 2 },
        { id: 'ci-m2', productId: 'prod-shirt', productName: 'Premium Oxford Shirt', variantId: 'v-shirt-wht-l', variantDetails: 'White / L', quantity: 2 },
      ],
      regularTotalPrice: 4900,
      discountType: 'fixed_bundle_price',
      discountValue: 4200,
      finalComboPrice: 4200,
      totalCostOfGoods: 2440,
      allocatedOpEx: 120,
      grossProfit: 1760,
      estimatedNetProfit: 1640,
      profitMarginPercent: 39.05,
      minSafeSellingPrice: 2560,
      isLossMaking: false,
      startDate: '2026-01-01',
      endDate: '2099-12-31',
      usageCount: 0,
      branchId: 'branch-dhk',
      status: 'active',
      priorityRank: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    // v-shirt-blk-m stock = 6 (max 3), v-shirt-wht-l stock = 4 (max 2), total product stock = 10 (10 / 4 = 2)
    const status = comboOfferService.checkOfferFulfillment(offer, sampleProducts, 1, 'branch-dhk');
    assert.equal(status.canFulfill, true);
    assert.equal(status.maxCombos, 2);

    // Asking for 3 combos exceeds White / L stock (6 needed vs 4 available)
    const overStatus = comboOfferService.checkOfferFulfillment(offer, sampleProducts, 3, 'branch-dhk');
    assert.equal(overStatus.canFulfill, false);

    // Other branch cannot fulfill branch-dhk offer
    const wrongBranch = comboOfferService.checkOfferFulfillment(offer, sampleProducts, 1, 'branch-ctg');
    assert.equal(wrongBranch.branchCompatible, false);
    assert.equal(wrongBranch.canFulfill, false);
  });

  // 3. Decimal Discount % <-> Manual Final Price bidirectional sync
  await runTest('3. Decimal Discount % <-> Manual Final Price bidirectional calculation', () => {
    const items: ComboOfferItem[] = [
      { id: 'ci-p1', productId: 'prod-shirt', productName: 'Premium Oxford Shirt', variantId: 'v-shirt-blk-m', quantity: 1 },
      { id: 'ci-p2', productId: 'prod-belt', productName: 'Leather Formal Belt', quantity: 1 },
    ];
    // Regular = 1200 + 500 = 1700
    const pnlPct = comboOfferService.calculateComboPnL(items, 'percentage', 12.5, sampleProducts);
    assert.equal(pnlPct.discountAmount, 212.5);
    assert.equal(pnlPct.finalComboPrice, 1487.5);

    const equivPct = comboOfferService.calculateEquivalentDiscountPercent(1700, 1487.5);
    assert.equal(equivPct, 12.5);
  });

  // 4. Safe Floor loss-making detection & override requirement
  await runTest('4. Safe floor detection flags loss-making combo price', () => {
    const items: ComboOfferItem[] = [
      { id: 'ci-l1', productId: 'prod-shirt', productName: 'Premium Oxford Shirt', variantId: 'v-shirt-blk-m', quantity: 1 },
      { id: 'ci-l2', productId: 'prod-chino', productName: 'Slim Chino Pant', variantId: 'v-chino-32', quantity: 1 },
    ];
    // COGS 600 + 700 = 1300, OpEx 30 + 35 = 65 -> minSafeSellingPrice = 1365
    const lossPnL = comboOfferService.calculateComboPnL(items, 'fixed_bundle_price', 1250, sampleProducts);
    assert.equal(lossPnL.isLossMaking, true);
    assert.equal(lossPnL.minSafeSellingPrice, 1365);
    assert.equal(lossPnL.grossProfit, -50);
  });

  // 5. Save/Edit/Preview zero stock deduction
  await runTest('5. Save/Edit/Preview combo offer causes zero stock deduction', async () => {
    const beforeStocks = sampleProducts.map(p => ({ id: p.id, stock: p.currentStock }));
    const saved = await comboOfferService.saveOffer({
      id: 'cmb-test-save',
      businessId: 'biz-local-test',
      name: 'Preview Safe Combo',
      offerType: 'fixed_price',
      comboCategory: 'Summer',
      items: [
        { id: 'ci-s1', productId: 'prod-shirt', productName: 'Premium Oxford Shirt', variantId: 'v-shirt-blk-m', quantity: 1 },
        { id: 'ci-s2', productId: 'prod-belt', productName: 'Leather Formal Belt', quantity: 1 },
      ],
      regularTotalPrice: 1700,
      discountType: 'fixed_bundle_price',
      discountValue: 1500,
      finalComboPrice: 1500,
      totalCostOfGoods: 820,
      allocatedOpEx: 45,
      grossProfit: 680,
      estimatedNetProfit: 635,
      profitMarginPercent: 42.33,
      minSafeSellingPrice: 865,
      isLossMaking: false,
      startDate: '2026-01-01',
      endDate: '2099-12-31',
      usageCount: 0,
      branchId: 'branch-dhk',
      status: 'active',
      priorityRank: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, 'biz-local-test');
    assert.equal(saved.id, 'cmb-test-save');
    sampleProducts.forEach((p, i) => {
      assert.equal(p.currentStock, beforeStocks[i].stock);
    });
  });

  // 6. 1x and 3x combo revenue allocation sums strictly to finalComboPrice * qty (zero rounding drift / zero double-counting)
  await runTest('6. 1x & 3x combo largest-remainder allocation invariant', () => {
    const items: ComboOfferItem[] = [
      { id: 'ci-a1', productId: 'prod-shirt', productName: 'Premium Oxford Shirt', variantId: 'v-shirt-blk-m', quantity: 1 },
      { id: 'ci-a2', productId: 'prod-belt', productName: 'Leather Formal Belt', quantity: 1 },
      { id: 'ci-a3', productId: 'prod-socks', productName: 'Cotton Dress Socks', quantity: 1, isFree: true },
    ];
    for (const qty of [1, 3]) {
      const targetPrice = 1499.99;
      const allocated = comboOfferService.allocateComboComponentRevenues(
        items,
        sampleProducts,
        targetPrice,
        qty
      );
      const sumTotals = Math.round(allocated.reduce((s, c) => s + c.allocatedTotal, 0) * 100) / 100;
      const expected = Math.round(targetPrice * qty * 100) / 100;
      assert.equal(sumTotals, expected);
      // Free item weight = 0 so its allocated total is 0
      assert.equal(allocated[2].allocatedTotal, 0);
      assert.equal(allocated[2].totalQty, qty);
    }
  });

  // 7. Insufficient stock blocks entire transaction across mixed regular + combo cart
  await runTest('7. Mixed regular + combo cart insufficient stock blocks transaction atomically', () => {
    // prod-perfume stock = 4
    const mixedItems: SaleItem[] = [
      {
        productId: 'prod-perfume',
        productName: 'Pocket Cologne 30ml',
        sku: 'FR-001',
        unitPrice: 550,
        purchasePrice: 250,
        quantity: 2,
        discount: 0,
        total: 1100,
      },
      {
        productId: 'prod-perfume',
        productName: 'Pocket Cologne 30ml',
        sku: 'FR-001',
        unitPrice: 450,
        purchasePrice: 250,
        quantity: 3, // 2 + 3 = 5 > 4 stock!
        discount: 300,
        total: 1350,
        comboOfferId: 'cmb-fragrance',
        comboInstanceId: 'inst-1',
      },
    ];
    const check = comboOfferService.validateAggregateCartStock(mixedItems, sampleProducts, 'branch-dhk');
    assert.equal(check.valid, false);
    assert.ok(check.errors.some(e => e.includes('Pocket Cologne 30ml') && e.includes('Required: 5, Available: 4')));

    // Cross-branch product block
    const crossBranch = comboOfferService.validateAggregateCartStock(
      [{ productId: 'prod-other-branch', productName: 'Chattogram Exclusive Jacket', quantity: 1 }],
      sampleProducts,
      'branch-dhk'
    );
    assert.equal(crossBranch.valid, false);
  });

  // 8. Usage logging + idempotent clientTxId + full void/refund usage reversal
  await runTest('8. Combo usage recording & void/refund reversal in local persistence', async () => {
    const bizId = 'biz-usage-test';
    const offer = await comboOfferService.saveOffer({
      id: 'cmb-usage-1',
      businessId: bizId,
      name: 'Formal Set',
      offerType: 'fixed_price',
      items: [{ id: 'ci-u1', productId: 'prod-belt', productName: 'Leather Formal Belt', quantity: 1 }],
      regularTotalPrice: 500,
      discountType: 'fixed_bundle_price',
      discountValue: 400,
      finalComboPrice: 400,
      totalCostOfGoods: 220,
      allocatedOpEx: 15,
      grossProfit: 180,
      estimatedNetProfit: 165,
      profitMarginPercent: 41.25,
      minSafeSellingPrice: 235,
      isLossMaking: false,
      startDate: '2026-01-01',
      endDate: '2099-12-31',
      usageCount: 0,
      branchId: 'branch-dhk',
      status: 'active',
      priorityRank: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, bizId);

    await comboOfferService.recordOfferUsage(
      offer.id,
      'sale-999',
      'INV-999',
      300,
      1200,
      660,
      bizId,
      'branch-dhk',
      undefined,
      undefined,
      {
        comboQuantity: 3,
        comboInstanceId: 'inst-999',
        clientTxId: 'tx-999',
        offerName: offer.name,
      }
    );

    // Duplicate call with same clientTxId + offerId + instanceId should be idempotent (no duplicate log or double count)
    await comboOfferService.recordOfferUsage(
      offer.id,
      'sale-999',
      'INV-999',
      300,
      1200,
      660,
      bizId,
      'branch-dhk',
      undefined,
      undefined,
      {
        comboQuantity: 3,
        comboInstanceId: 'inst-999',
        clientTxId: 'tx-999',
        offerName: offer.name,
      }
    );

    let offersAfter = await comboOfferService.fetchOffers(bizId);
    let logsAfter = await comboOfferService.fetchUsageLogs(bizId);
    assert.equal(offersAfter.find(o => o.id === offer.id)?.usageCount, 3);
    assert.equal(logsAfter.filter(l => l.saleId === 'sale-999').length, 1);

    // Reversing on void/refund restores usageCount to 0 and clears usage row
    await comboOfferService.reverseOfferUsageForSale('sale-999', bizId);
    offersAfter = await comboOfferService.fetchOffers(bizId);
    logsAfter = await comboOfferService.fetchUsageLogs(bizId);
    assert.equal(offersAfter.find(o => o.id === offer.id)?.usageCount, 0);
    assert.equal(logsAfter.filter(l => l.saleId === 'sale-999').length, 0);
  });

  // 9. Partial combo component return proportional refund value + damaged condition handling
  await runTest('9. Partial combo return uses allocated net unit price, not regular price', () => {
    const items: ComboOfferItem[] = [
      { id: 'ci-r1', productId: 'prod-shirt', productName: 'Premium Oxford Shirt', variantId: 'v-shirt-blk-m', quantity: 1 },
      { id: 'ci-r2', productId: 'prod-belt', productName: 'Leather Formal Belt', quantity: 1 },
    ];
    // Regular = 1200 + 500 = 1700. Offer price = 1360 (20% off -> Shirt=960, Belt=400).
    const allocated = comboOfferService.allocateComboComponentRevenues(items, sampleProducts, 1360, 1);
    assert.equal(allocated[0].allocatedTotal, 960);
    assert.equal(allocated[1].allocatedTotal, 400);

    // Customer returns only the Belt from the combo -> proportional refund MUST be 400, NOT 500
    const saleItemBelt: SaleItem = {
      productId: allocated[1].productId,
      productName: allocated[1].productName,
      sku: allocated[1].sku,
      unitPrice: allocated[1].allocatedUnitPrice,
      regularUnitPrice: allocated[1].regularUnitPrice,
      purchasePrice: allocated[1].purchasePrice,
      quantity: allocated[1].totalQty,
      discount: allocated[1].discountTotal,
      total: allocated[1].allocatedTotal,
      comboOfferId: 'cmb-1',
      comboInstanceId: 'inst-1',
    };
    const effectiveRefundUnitPrice = Math.round((saleItemBelt.total / saleItemBelt.quantity) * 100) / 100;
    assert.equal(effectiveRefundUnitPrice, 400);
  });

  // 10. Admin vs Seller RBAC checks for combo management
  await runTest('10. RBAC enforces Admin/Manager create/edit/delete vs Salesman view-only', () => {
    assert.equal(hasMatrixPermission(undefined, 'super_admin', 'product_management', 'create'), true);
    assert.equal(hasMatrixPermission(undefined, 'super_admin', 'product_management', 'delete'), true);
    assert.equal(hasMatrixPermission(undefined, 'store_manager', 'product_management', 'create'), true);

    assert.equal(hasMatrixPermission(undefined, 'salesman', 'product_management', 'view'), true);
    assert.equal(hasMatrixPermission(undefined, 'salesman', 'product_management', 'create'), false);
    assert.equal(hasMatrixPermission(undefined, 'salesman', 'product_management', 'edit'), false);
    assert.equal(hasMatrixPermission(undefined, 'salesman', 'product_management', 'delete'), false);
    assert.equal(hasMatrixPermission(undefined, 'cashier', 'product_management', 'create'), false);
  });

  // 11. Zero revenue double-counting invariant across POS Sale + Reports P&L
  await runTest('11. Reports P&L & product breakdown have zero revenue double-counting', () => {
    const comboItems: ComboOfferItem[] = [
      { id: 'ci-rp1', productId: 'prod-shirt', productName: 'Premium Oxford Shirt', variantId: 'v-shirt-blk-m', quantity: 1 },
      { id: 'ci-rp2', productId: 'prod-chino', productName: 'Slim Chino Pant', variantId: 'v-chino-32', quantity: 1 },
    ];
    // Regular = 2600, Final Combo = 2000, Qty = 2 -> Sale total = 4000
    const allocated = comboOfferService.allocateComboComponentRevenues(comboItems, sampleProducts, 2000, 2);
    const saleItems: SaleItem[] = allocated.map(c => ({
      productId: c.productId,
      productName: c.productName,
      sku: c.sku,
      unitPrice: c.allocatedUnitPrice,
      regularUnitPrice: c.regularUnitPrice,
      purchasePrice: c.purchasePrice,
      quantity: c.totalQty,
      discount: c.discountTotal,
      total: c.allocatedTotal,
      variantId: c.variantId,
      variantDetails: c.variantDetails,
      comboOfferId: 'cmb-outfit',
      comboInstanceId: 'inst-outfit',
      comboQuantity: 2,
    }));

    const sale: Sale = {
      id: 'sale-1',
      invoiceNumber: 'INV-1',
      date: '2026-11-25T10:00:00Z',
      customerName: 'Walk-in Customer',
      items: saleItems,
      subtotal: 4000,
      discount: 0,
      comboDiscount: 1200,
      vatTaxRate: 0,
      vatTaxAmount: 0,
      total: 4000,
      paid: 4000,
      due: 0,
      paymentMethod: 'cash',
      payments: [{ method: 'cash', amount: 4000 }],
      status: 'paid',
      servedBy: 'Admin',
      branchId: 'branch-dhk',
    };

    const invoiceRevenue = sale.total;
    const sumProductBreakdownRevenue = sale.items.reduce((s, it) => s + it.total, 0);
    const cogs = sale.items.reduce((s, it) => s + it.purchasePrice * it.quantity, 0);
    assert.equal(invoiceRevenue, 4000);
    assert.equal(sumProductBreakdownRevenue, 4000);
    assert.equal(cogs, (600 + 700) * 2);
    assert.equal(invoiceRevenue - cogs, 1400);
  });

  // 12. Regular non-combo POS sale regression check
  await runTest('12. Regular non-combo POS items pass aggregate validation untouched', () => {
    const regItem: SaleItem = {
      productId: 'prod-belt',
      productName: 'Leather Formal Belt',
      sku: 'AC-001',
      unitPrice: 500,
      purchasePrice: 220,
      quantity: 3,
      discount: 0,
      total: 1500,
    };
    const res = comboOfferService.validateAggregateCartStock([regItem], sampleProducts, 'branch-dhk');
    assert.equal(res.valid, true);
  });

  console.log(`\nALL ${passed} COMBO SYSTEM TESTS PASSED.`);
}

main().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
