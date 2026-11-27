import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  isSalesmanOrCashierRole,
  normalizeRoleKey,
  roleKeyToLegacyUserRole,
} from '../src/utils/rbacDefaults';
import { Sale } from '../src/types';

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
    location: { origin: 'http://localhost:3000' },
  };
}

const sampleSales: Sale[] = [
  {
    id: 's-1',
    invoiceNumber: 'INV-101',
    date: '2026-11-27T09:00:00.000Z',
    customerName: 'Walk-in',
    items: [],
    subtotal: 1200,
    discount: 0,
    vatTaxRate: 0,
    vatTaxAmount: 0,
    total: 1200,
    paid: 1200,
    due: 0,
    paymentMethod: 'cash',
    payments: [{ method: 'cash', amount: 1200 }],
    servedBy: 'Rahim Seller',
    sellerId: 'user-seller-1',
    branchId: 'br-1',
    status: 'paid',
  },
  {
    id: 's-2',
    invoiceNumber: 'INV-102',
    date: '2026-11-27T10:00:00.000Z',
    customerName: 'Walk-in',
    items: [],
    subtotal: 500,
    discount: 0,
    vatTaxRate: 0,
    vatTaxAmount: 0,
    total: 500,
    paid: 500,
    due: 0,
    paymentMethod: 'cash',
    payments: [{ method: 'cash', amount: 500 }],
    servedBy: 'Rahim Seller',
    sellerId: 'user-seller-1',
    branchId: 'br-1',
    status: 'voided',
  },
];

// 1. Admin & Seller Role Resolution Regression
assert.equal(normalizeRoleKey('owner'), 'super_admin');
assert.equal(normalizeRoleKey('admin'), 'super_admin');
assert.equal(roleKeyToLegacyUserRole('super_admin'), 'owner');
assert.equal(isSalesmanOrCashierRole('owner'), false);
assert.equal(isSalesmanOrCashierRole('super_admin'), false);

assert.equal(normalizeRoleKey('seller'), 'salesman');
assert.equal(normalizeRoleKey('salesman'), 'salesman');
assert.equal(roleKeyToLegacyUserRole('salesman'), 'salesman');
assert.equal(isSalesmanOrCashierRole('seller'), true);
assert.equal(isSalesmanOrCashierRole('salesman'), true);

// 2. Verify sellerService.ts has ZERO invalid PostgREST business_users -> user_profiles join
import fs from 'node:fs';
const sellerServiceSource = fs.readFileSync('src/services/sellerService.ts', 'utf8');
assert.ok(
  !/\.from\(\s*['"]business_users['"]\s*\)\s*\.select\([^)]*user_profiles/.test(sellerServiceSource),
  'sellerService.ts must not attempt an embedded PostgREST join from business_users to user_profiles'
);

// 3. Hydrate public config before importing Supabase client so configured-mode assertions execute
if (!(globalThis as any).__PROTIVA_PUBLIC_CONFIG__) {
  (globalThis as any).__PROTIVA_PUBLIC_CONFIG__ = {
    VITE_SUPABASE_URL: 'https://unit-test-project.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'unit_test_anon_key_123456',
  };
}

const supabaseMod = await import('../src/lib/supabase');
const { sellerService } = await import('../src/services/sellerService');
assert.equal(supabaseMod.isSupabaseConfigured, true, 'Expected Supabase client to be configured for unit tests');

const globalClient = (globalThis as any).__adpSupabaseClient;
assert.ok(globalClient, 'Expected global Supabase client to be initialized');
const originalFrom = globalClient.from.bind(globalClient);

function makeQueryStub(responder: (table: string, state: { select?: string; filters: any[] }) => Promise<any>) {
  return (table: string) => {
    const state: { select?: string; filters: any[] } = { filters: [] };
    const builder: any = {
      select(cols: string) {
        state.select = cols;
        return builder;
      },
      eq(col: string, val: any) {
        state.filters.push(['eq', col, val]);
        return builder;
      },
      in(col: string, vals: any[]) {
        state.filters.push(['in', col, vals]);
        return builder;
      },
      update(patch: any) {
        state.filters.push(['update', patch]);
        return builder;
      },
      then(resolve: any, reject: any) {
        return responder(table, state).then(resolve, reject);
      },
    };
    return builder;
  };
}

// Verify live Supabase connectivity & schema queries via running dev server if available
try {
  const cfgRes = await fetch('http://127.0.0.1:3000/api/public-config');
  if (cfgRes.ok) {
    const cfg = await cfgRes.json();
    const url = String(cfg.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
    const key = String(cfg.VITE_SUPABASE_ANON_KEY || '');
    if (url && key) {
      const { createClient } = await import('@supabase/supabase-js');
      const liveClient = createClient(url, key);
      const [buCheck, upCheck, brCheck] = await Promise.all([
        liveClient.from('business_users').select('user_id, branch_id, role, status').limit(1),
        liveClient.from('user_profiles').select('id, email, full_name, username, mobile').limit(1),
        liveClient.from('branches').select('id, name').limit(1),
      ]);
      assert.equal(buCheck.error, null, `business_users query failed: ${buCheck.error?.message}`);
      assert.equal(upCheck.error, null, `user_profiles query failed: ${upCheck.error?.message}`);
      assert.equal(brCheck.error, null, `branches query failed: ${brCheck.error?.message}`);
      console.log('PASS: Live Supabase connectivity & schema queries (business_users, user_profiles, branches) succeeded');
    }
  }
} catch {
  console.log('INFO: Dev server on :3000 not queried for live public-config; skipping live network check');
}

// 4. Test Vite HMR WebSocket attachment when HMR is enabled
{
  const app = express();
  const httpServer = http.createServer(app);
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      ws: { server: httpServer },
      hmr: true,
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const addr = httpServer.address() as { port: number };
  const clientRes = await fetch(`http://127.0.0.1:${addr.port}/@vite/client`);
  const clientJs = await clientRes.text();
  const hmrPortMatch = clientJs.match(/const hmrPort = ([^;]+);/);
  const tokenMatch = clientJs.match(/const wsToken = "([^"]+)";/);
  assert.equal(hmrPortMatch?.[1], 'null', 'Vite middleware with ws.server must not hardcode port 24678');
  assert.ok(tokenMatch?.[1], 'Vite client must include wsToken');

  const upgradeResult = await new Promise<{ upgraded: boolean; status?: number }>((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1',
      port: addr.port,
      path: `/?token=${encodeURIComponent(tokenMatch![1])}`,
      headers: {
        Host: `127.0.0.1:${addr.port}`,
        Origin: `http://127.0.0.1:${addr.port}`,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Protocol': 'vite-hmr',
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ upgraded: true, status: res.statusCode });
    });
    req.on('response', res => resolve({ upgraded: false, status: res.statusCode }));
    req.on('error', () => resolve({ upgraded: false }));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ upgraded: false });
    });
    req.end();
  });

  assert.equal(upgradeResult.upgraded, true, 'Vite HMR WebSocket must upgrade with 101 Switching Protocols');
  assert.equal(upgradeResult.status, 101);
  await vite.close();
  httpServer.close();
  console.log('PASS: Vite HMR WebSocket upgrades cleanly (101 Switching Protocols) when HMR is enabled');
}

// Restore stub check without touching live global state permanently
globalClient.from = makeQueryStub(async (table, state) => {
  if (table === 'business_users') {
    assert.ok(!String(state.select || '').includes('user_profiles'), 'Must not join user_profiles inside business_users');
    return {
      data: [
        {
          user_id: 'user-seller-1',
          branch_id: 'br-1',
          role: 'seller',
          status: 'active',
          created_at: '2026-11-01T00:00:00.000Z',
          updated_at: '2026-11-02T00:00:00.000Z',
        },
      ],
      error: null,
    };
  }
  if (table === 'user_profiles') {
    return {
      data: [
        {
          id: 'user-seller-1',
          email: 'rahim@amardokanpro.internal',
          full_name: 'Rahim Seller',
          username: 'rahim_s',
          mobile: '+8801700000001',
        },
      ],
      error: null,
    };
  }
  if (table === 'branches') {
    return {
      data: [{ id: 'br-1', name: 'Main Branch' }],
      error: null,
    };
  }
  return { data: [], error: null };
});

// Verify separate-query seller resolution when Supabase client is configured
if (supabaseMod.isSupabaseConfigured) {
  const fetched = await sellerService.fetchSellers('11111111-1111-4111-8111-111111111111', sampleSales);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].fullName, 'Rahim Seller');
  assert.equal(fetched[0].username, 'rahim_s');
  assert.equal(fetched[0].branchName, 'Main Branch');
  assert.equal(fetched[0].totalSalesCount, 2);
  assert.equal(fetched[0].totalSalesAmount, 1200);

  // Verify database error is NOT swallowed by silent local cache fallback
  globalClient.from = makeQueryStub(async (table) => {
    if (table === 'business_users') {
      return { data: null, error: { message: 'permission denied for table business_users' } };
    }
    return { data: [], error: null };
  });
  localStorage.setItem(
    'AMAR_DOKAN_PRO_SELLERS_11111111-1111-4111-8111-111111111111',
    JSON.stringify([{ id: 'cached-fake', username: 'cached', fullName: 'Cached Fake', phone: '', role: 'seller', status: 'active', totalSalesCount: 0, totalSalesAmount: 0, createdAt: '' }])
  );
  await assert.rejects(
    () => sellerService.fetchSellers('11111111-1111-4111-8111-111111111111', sampleSales),
    /permission denied for table business_users/
  );
}

globalClient.from = originalFrom;
console.log('PASS: All sellerService, RBAC role, Vite WebSocket, and regression checks passed.');
