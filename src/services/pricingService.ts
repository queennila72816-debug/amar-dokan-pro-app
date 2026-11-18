import {
  ProductCostingSheet,
  DirectPurchaseCostBreakdown,
  MonthlyOperatingBudget,
  ExpenseAllocationMethod,
  QualityTier,
} from '../types';

export const defaultMonthlyBudget: MonthlyOperatingBudget = {
  shopRent: 15000,
  electricity: 2500,
  staffSalaries: 20000,
  internetAndMobile: 1200,
  transportGeneral: 1500,
  packagingGeneral: 1000,
  maintenance: 800,
  otherExpenses: 1000,
  expectedMonthlyUnitsSold: 1000,
  expectedMonthlyRevenue: 500000,
  allocationMethod: 'units_sold',
};

export const pricingService = {
  /**
   * Calculate Total Direct Costs and Landed Cost Per Unit for a batch
   */
  calculateLandedCost(
    batchQuantity: number,
    unitPurchasePrice: number,
    directCosts: DirectPurchaseCostBreakdown
  ): {
    totalPurchaseAmount: number;
    totalDirectCosts: number;
    landedCost: number;
    landedCostPerUnit: number;
  } {
    const qty = Math.max(1, Number(batchQuantity) || 1);
    const unitPrice = Math.max(0, Number(unitPurchasePrice) || 0);
    const totalPurchaseAmount = qty * unitPrice;

    const transport = Math.max(0, Number(directCosts.transport) || 0);
    const loading = Math.max(0, Number(directCosts.loading) || 0);
    const packaging = Math.max(0, Number(directCosts.packaging) || 0);
    const other = Math.max(0, Number(directCosts.other) || 0);

    const totalDirectCosts = transport + loading + packaging + other;
    const landedCost = totalPurchaseAmount + totalDirectCosts;
    const landedCostPerUnit = Math.round((landedCost / qty) * 100) / 100;

    return {
      totalPurchaseAmount,
      totalDirectCosts,
      landedCost,
      landedCostPerUnit,
    };
  },

  /**
   * Calculate Allocated Operating Expense Per Unit using selected allocation method
   */
  calculateAllocatedOpEx(
    budget: MonthlyOperatingBudget,
    method: ExpenseAllocationMethod = budget.allocationMethod,
    unitCost: number = 0,
    categoryWeight: number = 1.0,
    manualOpExPerUnit: number = 0
  ): {
    totalMonthlyOpEx: number;
    allocatedOpExPerUnit: number;
    explanation: string;
  } {
    const totalMonthlyOpEx =
      (Number(budget.shopRent) || 0) +
      (Number(budget.electricity) || 0) +
      (Number(budget.staffSalaries) || 0) +
      (Number(budget.internetAndMobile) || 0) +
      (Number(budget.transportGeneral) || 0) +
      (Number(budget.packagingGeneral) || 0) +
      (Number(budget.maintenance) || 0) +
      (Number(budget.otherExpenses) || 0);

    let allocatedOpExPerUnit = 0;
    let explanation = '';

    if (method === 'manual') {
      allocatedOpExPerUnit = Math.max(0, Number(manualOpExPerUnit) || 0);
      explanation = `Fixed manual allocation of ৳${allocatedOpExPerUnit} per unit.`;
    } else if (method === 'revenue_percent') {
      const expRevenue = Math.max(1, Number(budget.expectedMonthlyRevenue) || 1);
      const opexRate = (totalMonthlyOpEx / expRevenue) * 100;
      // Allocated based on unit cost times overhead percentage
      allocatedOpExPerUnit = Math.round((unitCost * (opexRate / 100)) * 100) / 100;
      explanation = `Operating overhead is ${opexRate.toFixed(1)}% of revenue (৳${totalMonthlyOpEx.toLocaleString()} on ৳${expRevenue.toLocaleString()}).`;
    } else if (method === 'category') {
      const expectedUnits = Math.max(1, Number(budget.expectedMonthlyUnitsSold) || 1);
      const basePerUnit = totalMonthlyOpEx / expectedUnits;
      const weighted = basePerUnit * (categoryWeight || 1.0);
      allocatedOpExPerUnit = Math.round(weighted * 100) / 100;
      explanation = `Category weight ${(categoryWeight || 1.0)}x applied to base overhead of ৳${(basePerUnit).toFixed(1)}/unit.`;
    } else {
      // Default: units_sold
      const expectedUnits = Math.max(1, Number(budget.expectedMonthlyUnitsSold) || 1);
      allocatedOpExPerUnit = Math.round((totalMonthlyOpEx / expectedUnits) * 100) / 100;
      explanation = `Total monthly OpEx ৳${totalMonthlyOpEx.toLocaleString()} ÷ ${expectedUnits.toLocaleString()} expected units sold.`;
    }

    return {
      totalMonthlyOpEx,
      allocatedOpExPerUnit,
      explanation,
    };
  },

  /**
   * Run full transparent pricing calculation
   */
  computeFullPricing(params: {
    batchQuantity: number;
    unitPurchasePrice: number;
    directCosts: DirectPurchaseCostBreakdown;
    monthlyBudget: MonthlyOperatingBudget;
    allocationMethod?: ExpenseAllocationMethod;
    categoryWeight?: number;
    manualOpExPerUnit?: number;
    profitMethod: 'margin_percentage' | 'markup_percentage' | 'fixed_amount';
    profitValue: number;
    vatRate?: number;
    paymentFeeRate?: number;
    localMarketPrice?: number;
    competitorPrice?: number;
    qualityTier?: QualityTier;
    targetSellingPrice?: number;
  }): ProductCostingSheet {
    const {
      totalPurchaseAmount,
      totalDirectCosts,
      landedCost,
      landedCostPerUnit,
    } = this.calculateLandedCost(
      params.batchQuantity,
      params.unitPurchasePrice,
      params.directCosts
    );

    const { allocatedOpExPerUnit } = this.calculateAllocatedOpEx(
      params.monthlyBudget,
      params.allocationMethod || params.monthlyBudget.allocationMethod,
      landedCostPerUnit,
      params.categoryWeight,
      params.manualOpExPerUnit
    );

    // Total Unit Cost = Real Break-even Cost per piece
    const totalUnitCost = Math.round((landedCostPerUnit + allocatedOpExPerUnit) * 100) / 100;

    let preTaxSellingPrice = totalUnitCost;
    let desiredProfitPerUnit = 0;

    if (params.profitMethod === 'fixed_amount') {
      desiredProfitPerUnit = Math.max(0, Number(params.profitValue) || 0);
      preTaxSellingPrice = totalUnitCost + desiredProfitPerUnit;
    } else if (params.profitMethod === 'markup_percentage') {
      const markupPercent = Math.max(0, Number(params.profitValue) || 0);
      desiredProfitPerUnit = Math.round((totalUnitCost * (markupPercent / 100)) * 100) / 100;
      preTaxSellingPrice = totalUnitCost + desiredProfitPerUnit;
    } else {
      // margin_percentage: Profit is a percentage of selling price!
      // Price = Cost / (1 - Margin%)
      const marginPercent = Math.min(95, Math.max(0, Number(params.profitValue) || 0));
      if (marginPercent < 100) {
        preTaxSellingPrice = Math.round((totalUnitCost / (1 - marginPercent / 100)) * 100) / 100;
        desiredProfitPerUnit = Math.round((preTaxSellingPrice - totalUnitCost) * 100) / 100;
      } else {
        desiredProfitPerUnit = totalUnitCost;
        preTaxSellingPrice = totalUnitCost * 2;
      }
    }

    const vatRate = Math.max(0, Number(params.vatRate) || 0);
    const vatAmount = Math.round(((preTaxSellingPrice * vatRate) / 100) * 100) / 100;

    const paymentFeeRate = Math.max(0, Number(params.paymentFeeRate) || 0);
    const paymentFeeAmount = Math.round(((preTaxSellingPrice * paymentFeeRate) / 100) * 100) / 100;

    const recommendedSellingPrice = Math.round(preTaxSellingPrice + vatAmount + paymentFeeAmount);

    // Minimum safe break-even selling price
    const minSafeSellingPrice = Math.ceil(totalUnitCost);

    // Maximum safe discount without making an operational loss
    const maxDiscountAmount = Math.max(0, recommendedSellingPrice - minSafeSellingPrice);
    const maxDiscountPercent =
      recommendedSellingPrice > 0
        ? Math.floor((maxDiscountAmount / recommendedSellingPrice) * 100)
        : 0;

    return {
      batchQuantity: params.batchQuantity,
      unitPurchasePrice: params.unitPurchasePrice,
      totalPurchaseAmount,
      directCosts: params.directCosts,
      totalDirectCosts,
      landedCost,
      landedCostPerUnit,
      allocatedOpExPerUnit,
      totalUnitCost,
      profitMethod: params.profitMethod,
      profitValue: params.profitValue,
      desiredProfitPerUnit,
      preTaxSellingPrice,
      vatRate,
      vatAmount,
      paymentFeeRate,
      paymentFeeAmount,
      recommendedSellingPrice,
      minSafeSellingPrice,
      maxDiscountPercent,
      localMarketPrice: params.localMarketPrice,
      competitorPrice: params.competitorPrice,
      qualityTier: params.qualityTier || 'standard',
    };
  },

  /**
   * Evaluate Market Comparison
   */
  evaluateComparison(
    recommendedPrice: number,
    marketPrice?: number,
    competitorPrice?: number,
    totalUnitCost: number = 0,
    plannedPrice?: number
  ): {
    status: 'fair_value' | 'competitive' | 'premium' | 'loss_warning';
    marketDifference: number;
    competitorDifference: number;
    summary: string;
    isLossMaking: boolean;
  } {
    const effectivePrice = plannedPrice || recommendedPrice;
    const isLossMaking = effectivePrice < totalUnitCost;

    let marketDifference = 0;
    if (marketPrice && marketPrice > 0) {
      marketDifference = effectivePrice - marketPrice;
    }

    let competitorDifference = 0;
    if (competitorPrice && competitorPrice > 0) {
      competitorDifference = effectivePrice - competitorPrice;
    }

    if (isLossMaking) {
      return {
        status: 'loss_warning',
        marketDifference,
        competitorDifference,
        summary: `WARNING: Selling price (৳${effectivePrice}) is below Total Unit Cost (৳${totalUnitCost}). Every sale will cause an operational loss of ৳${(totalUnitCost - effectivePrice).toFixed(1)} per piece!`,
        isLossMaking: true,
      };
    }

    if (marketDifference < -20) {
      return {
        status: 'competitive',
        marketDifference,
        competitorDifference,
        summary: `Highly competitive! Priced ৳${Math.abs(marketDifference)} lower than local market average while preserving full operating profit.`,
        isLossMaking: false,
      };
    }

    if (marketDifference > 50) {
      return {
        status: 'premium',
        marketDifference,
        competitorDifference,
        summary: `Priced ৳${marketDifference} higher than local market. Ensure superior product fabric/durability or packaging justifies the premium.`,
        isLossMaking: false,
      };
    }

    return {
      status: 'fair_value',
      marketDifference,
      competitorDifference,
      summary: `Balanced & fair market price. Provides sustainable shop profitability with fair value for customers.`,
      isLossMaking: false,
    };
  },
};
