import { Product } from '../types';

export const DEFAULT_TRIP_PENALTY_EUR = 2.5;

export interface StoreAssignment {
  store: string;
  items: Array<{ name: string; price: number; onSale: boolean; regularPrice?: number }>;
  totalPrice: number;
  totalSavings: number;
}

export interface ShoppingPlan {
  stores: StoreAssignment[];
  totalPrice: number;
  tripPenalty: number;
  grandTotal: number;
  singleStorePrice: number | null;
  singleStoreName: string | null;
  savingsVsSingleStore: number;
  storeCount: number;
}

interface PriceOption {
  store: string;
  price: number;
  onSale: boolean;
  regularPrice?: number;
}

interface ItemToOptimize {
  name: string;
  options: PriceOption[];
}

function buildStoreAssignments(
  items: ItemToOptimize[],
  selectedStores: Set<string>
): StoreAssignment[] {
  const byStore = new Map<string, StoreAssignment>();

  for (const item of items) {
    const eligible = item.options
      .filter((o) => selectedStores.has(o.store))
      .sort((a, b) => a.price - b.price);

    if (eligible.length === 0) continue;

    const best = eligible[0];
    if (!byStore.has(best.store)) {
      byStore.set(best.store, {
        store: best.store,
        items: [],
        totalPrice: 0,
        totalSavings: 0,
      });
    }

    const entry = byStore.get(best.store)!;
    entry.items.push({
      name: item.name,
      price: best.price,
      onSale: best.onSale,
      regularPrice: best.regularPrice,
    });
    entry.totalPrice += best.price;
    if (best.onSale && best.regularPrice) {
      entry.totalSavings += best.regularPrice - best.price;
    }
  }

  return Array.from(byStore.values()).sort((a, b) => a.store.localeCompare(b.store));
}

function computeSingleStoreBest(items: ItemToOptimize[]): { price: number; store: string } | null {
  const storeTotals = new Map<string, number>();

  for (const item of items) {
    for (const option of item.options) {
      const current = storeTotals.get(option.store) ?? 0;
      storeTotals.set(option.store, current + option.price);
    }
  }

  const storesWithAllItems = Array.from(storeTotals.entries()).filter(([store]) =>
    items.every((item) => item.options.some((o) => o.store === store))
  );

  if (storesWithAllItems.length === 0) return null;

  storesWithAllItems.sort((a, b) => a[1] - b[1]);
  return { store: storesWithAllItems[0][0], price: storesWithAllItems[0][1] };
}

/**
 * Find a shopping plan that balances item savings against extra store visits.
 */
export function optimizeShoppingPlan(
  items: ItemToOptimize[],
  tripPenalty = DEFAULT_TRIP_PENALTY_EUR
): ShoppingPlan | null {
  if (items.length === 0) return null;

  const allStores = Array.from(
    new Set(items.flatMap((item) => item.options.map((o) => o.store)))
  );

  if (allStores.length === 0) return null;

  const singleStore = computeSingleStoreBest(items);

  let bestPlan: ShoppingPlan | null = null;

  const storeCount = allStores.length;
  const maxMask = 1 << storeCount;

  for (let mask = 1; mask < maxMask; mask++) {
    const selected = new Set<string>();
    for (let i = 0; i < storeCount; i++) {
      if (mask & (1 << i)) selected.add(allStores[i]);
    }

    const stores = buildStoreAssignments(items, selected);
    if (stores.length === 0) continue;

    const coversAll = items.every((item) =>
      item.options.some((o) => selected.has(o.store))
    );
    if (!coversAll) continue;

    const totalPrice = stores.reduce((sum, s) => sum + s.totalPrice, 0);
    const tripCost = Math.max(0, stores.length - 1) * tripPenalty;
    const grandTotal = totalPrice + tripCost;

    const candidate: ShoppingPlan = {
      stores,
      totalPrice,
      tripPenalty: tripCost,
      grandTotal,
      singleStorePrice: singleStore?.price ?? null,
      singleStoreName: singleStore?.store ?? null,
      savingsVsSingleStore:
        singleStore && grandTotal < singleStore.price
          ? singleStore.price - grandTotal
          : 0,
      storeCount: stores.length,
    };

    if (!bestPlan || candidate.grandTotal < bestPlan.grandTotal) {
      bestPlan = candidate;
    }
  }

  return bestPlan;
}

export function productSavings(product: Product): number {
  return Math.max(0, product.originalPrice - product.effectivePrice);
}
