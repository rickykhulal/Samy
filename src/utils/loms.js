// src/utils/loms.js
// License Operations Management System — Core Utilities

// ─── Admin IDs ────────────────────────────────────────────────
export const OWNER_ID     = '768020734231969793';
export const MOD_ID       = '1190844956395446397';
export const ADMIN_IDS    = [OWNER_ID, MOD_ID];

// ─── DB Key Factories ─────────────────────────────────────────
export const DB = {
    // Products
    products:      ()              => `loms:products`,

    // Users
    user:          (uid)           => `loms:user:${uid}`,

    // Credits
    credits:       (uid)           => `loms:credits:${uid}`,

    // Key pool (product-specific)
    pool:          (productCode)   => `loms:pool:${productCode}`,
    usedKeys:      (productCode)   => `loms:used:${productCode}`,

    // Custom requests
    request:       (reqId)         => `loms:request:${reqId}`,
    requestList:   ()              => `loms:requests`,

    // Logs
    auditLog:      ()              => `loms:audit`,
    creditLog:     ()              => `loms:creditlog`,
    keyLog:        ()              => `loms:keylog`,
};

// ─── Request Statuses ─────────────────────────────────────────
export const STATUS = {
    PENDING_APPROVAL: 'PENDING_APPROVAL',
    APPROVED:         'APPROVED',
    KEY_ASSIGNED:     'KEY_ASSIGNED',
    DENIED:           'DENIED',
    EXPIRED:          'EXPIRED',
    CANCELLED:        'CANCELLED',
};

// ─── In-Memory Pending Requests (for 2-min timeout) ──────────
export const pendingApprovals = new Map();

// ─────────────────────────────────────────────────────────────
//  PRODUCT HELPERS
// ─────────────────────────────────────────────────────────────

export async function getProducts(client) {
    const val = await client.db.get(DB.products());
    if (Array.isArray(val) && val.length > 0) return val;

    // Default products
    const defaults = [
        { id: 'uid_bypass',         name: 'UID Bypass',         active: true,  createdAt: new Date().toISOString() },
        { id: 'external_exclusive', name: 'External Exclusive', active: true,  createdAt: new Date().toISOString() },
    ];
    await client.db.set(DB.products(), defaults);
    return defaults;
}

export async function getActiveProducts(client) {
    const all = await getProducts(client);
    return all.filter(p => p.active);
}

export async function addProduct(client, id, name) {
    const products = await getProducts(client);
    if (products.find(p => p.id === id)) return { success: false, error: 'Product already exists' };
    products.push({ id, name, active: true, createdAt: new Date().toISOString() });
    await client.db.set(DB.products(), products);
    return { success: true };
}

export async function toggleProduct(client, id, active) {
    const products = await getProducts(client);
    const idx = products.findIndex(p => p.id === id);
    if (idx < 0) return false;
    products[idx].active = active;
    await client.db.set(DB.products(), products);
    return true;
}

// ─────────────────────────────────────────────────────────────
//  USER / ACCESS HELPERS
// ─────────────────────────────────────────────────────────────

export async function getUser(client, userId) {
    if (ADMIN_IDS.includes(userId)) {
        return { userId, isAdmin: true, products: [], credits: 999999 };
    }
    const val = await client.db.get(DB.user(userId));
    return val || null;
}

export async function getAllUsers(client) {
    const val = await client.db.get('loms:userlist');
    return Array.isArray(val) ? val : [];
}

export async function grantAccess(client, userId, credits, productIds) {
    const existing = await client.db.get(DB.user(userId)) || {
        userId,
        isAdmin:   false,
        products:  [],
        credits:   0,
        grantedAt: new Date().toISOString(),
    };

    // Merge products
    const merged = [...new Set([...existing.products, ...productIds])];
    existing.products  = merged;
    existing.credits   = (existing.credits || 0) + credits;
    existing.updatedAt = new Date().toISOString();

    await client.db.set(DB.user(userId), existing);

    // Track user list
    const userList = await getAllUsers(client);
    if (!userList.includes(userId)) {
        userList.push(userId);
        await client.db.set('loms:userlist', userList);
    }

    return existing;
}

export async function revokeAccess(client, userId) {
    await client.db.delete(DB.user(userId));
    const userList = await getAllUsers(client);
    await client.db.set('loms:userlist', userList.filter(id => id !== userId));
}

export async function hasProductAccess(client, userId, productId) {
    if (ADMIN_IDS.includes(userId)) return true;
    const user = await getUser(client, userId);
    return user?.products?.includes(productId) ?? false;
}

export async function updateUserProducts(client, userId, productIds) {
    const user = await client.db.get(DB.user(userId));
    if (!user) return false;
    user.products  = productIds;
    user.updatedAt = new Date().toISOString();
    await client.db.set(DB.user(userId), user);
    return true;
}

// ─────────────────────────────────────────────────────────────
//  CREDIT HELPERS
// ─────────────────────────────────────────────────────────────

export async function getCredits(client, userId) {
    if (ADMIN_IDS.includes(userId)) return 999999;
    const user = await getUser(client, userId);
    return user?.credits ?? 0;
}

export async function addCredits(client, userId, amount, reason = 'Manual add', adminId = null) {
    const user = await client.db.get(DB.user(userId));
    if (!user) return { success: false, error: 'User not found' };
    const before       = user.credits;
    user.credits       = (user.credits || 0) + amount;
    user.updatedAt     = new Date().toISOString();
    await client.db.set(DB.user(userId), user);
    await appendLog(client, DB.creditLog(), { type: 'ADD', userId, amount, before, after: user.credits, reason, adminId, ts: new Date().toISOString() });
    return { success: true, before, after: user.credits };
}

export async function removeCredits(client, userId, amount, reason = 'Manual remove', adminId = null) {
    const user = await client.db.get(DB.user(userId));
    if (!user) return { success: false, error: 'User not found' };
    const before   = user.credits;
    user.credits   = Math.max(0, (user.credits || 0) - amount);
    user.updatedAt = new Date().toISOString();
    await client.db.set(DB.user(userId), user);
    await appendLog(client, DB.creditLog(), { type: 'REMOVE', userId, amount, before, after: user.credits, reason, adminId, ts: new Date().toISOString() });
    return { success: true, before, after: user.credits };
}

export async function deductCredit(client, userId, reason = 'Key request', adminId = null) {
    return removeCredits(client, userId, 1, reason, adminId);
}

export async function refundCredit(client, userId, reason = 'Request denied/expired') {
    return addCredits(client, userId, 1, reason);
}

// ─────────────────────────────────────────────────────────────
//  KEY POOL HELPERS
// ─────────────────────────────────────────────────────────────

export async function getPool(client, productId) {
    const val = await client.db.get(DB.pool(productId));
    const now = Date.now();
    const pool = Array.isArray(val) ? val : [];
    // Auto-expire keys past their date
    return pool.filter(k => k.status === 'available' && (!k.expiresAt || new Date(k.expiresAt).getTime() > now));
}

export async function getRawPool(client, productId) {
    const val = await client.db.get(DB.pool(productId));
    return Array.isArray(val) ? val : [];
}

export async function addKeyToPool(client, productId, keyValue, durationDays, addedBy) {
    const raw  = await getRawPool(client, productId);
    if (raw.find(k => k.key === keyValue)) return { success: false, error: 'Duplicate key' };

    const entry = {
        id:          `k_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        product:     productId,
        key:         keyValue,
        durationDays,
        status:      'available',
        addedBy,
        addedAt:     new Date().toISOString(),
        usedBy:      null,
        usedAt:      null,
    };
    raw.push(entry);
    await client.db.set(DB.pool(productId), raw);
    return { success: true, entry };
}

export async function bulkAddKeys(client, productId, keys, durationDays, addedBy) {
    const raw = await getRawPool(client, productId);
    const existing = new Set(raw.map(k => k.key));
    let added = 0, skipped = 0;

    for (const keyValue of keys) {
        const trimmed = keyValue.trim();
        if (!trimmed || existing.has(trimmed)) { skipped++; continue; }
        raw.push({
            id:          `k_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
            product:     productId,
            key:         trimmed,
            durationDays,
            status:      'available',
            addedBy,
            addedAt:     new Date().toISOString(),
            usedBy:      null,
            usedAt:      null,
        });
        existing.add(trimmed);
        added++;
    }

    await client.db.set(DB.pool(productId), raw);
    return { added, skipped };
}

export async function removeKeyFromPool(client, productId, keyValue) {
    const raw      = await getRawPool(client, productId);
    const filtered = raw.filter(k => k.key !== keyValue);
    if (filtered.length === raw.length) return false;
    await client.db.set(DB.pool(productId), filtered);
    return true;
}

/**
 * Find best matching key from pool for a product + desired days.
 * Returns { key, exact } or null.
 */
export async function findBestKey(client, productId, desiredDays) {
    const pool = await getPool(client, productId);
    if (pool.length === 0) return null;

    // Exact match first
    const exact = pool.find(k => k.durationDays === desiredDays);
    if (exact) return { key: exact, exact: true };

    // Nearest match (sorted by proximity)
    const sorted = [...pool].sort((a, b) =>
        Math.abs(a.durationDays - desiredDays) - Math.abs(b.durationDays - desiredDays)
    );

    // Return top 2 nearest for user to choose
    return { key: sorted[0], nearest: sorted.slice(0, 2), exact: false };
}

export async function consumeKey(client, productId, keyId, userId, requestId) {
    const raw = await getRawPool(client, productId);
    const idx = raw.findIndex(k => k.id === keyId);
    if (idx < 0) return false;

    raw[idx].status    = 'used';
    raw[idx].usedBy    = userId;
    raw[idx].usedAt    = new Date().toISOString();
    raw[idx].requestId = requestId;

    await client.db.set(DB.pool(productId), raw);

    // Archive to used log
    const used = await client.db.get(DB.usedKeys(productId)) || [];
    used.unshift(raw[idx]);
    await client.db.set(DB.usedKeys(productId), used);

    return true;
}

export async function getUsedKeys(client, productId) {
    const val = await client.db.get(DB.usedKeys(productId));
    return Array.isArray(val) ? val : [];
}

// ─────────────────────────────────────────────────────────────
//  CUSTOM REQUEST HELPERS
// ─────────────────────────────────────────────────────────────

export function generateRequestId() {
    const ts   = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `REQ-${ts}-${rand}`;
}

export async function createRequest(client, data) {
    const reqId = generateRequestId();
    const request = {
        requestId:    reqId,
        status:       STATUS.PENDING_APPROVAL,
        userId:       data.userId,
        userTag:      data.userTag,
        guildId:      data.guildId,
        channelId:    data.channelId,
        productId:    data.productId,
        productName:  data.productName,
        licenseName:  data.licenseName,
        duration:     data.duration,
        creditsAtReq: data.creditsAtReq,
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
        approvedBy:   null,
        approvedAt:   null,
        deniedBy:     null,
        deniedAt:     null,
        denyReason:   null,
        assignedKey:  null,
        assignedBy:   null,
        assignedAt:   null,
    };

    await client.db.set(DB.request(reqId), request);

    // Add to list
    const list = await client.db.get(DB.requestList()) || [];
    list.unshift(reqId);
    await client.db.set(DB.requestList(), list);

    await appendLog(client, DB.auditLog(), {
        type: 'REQUEST_CREATED', reqId, userId: data.userId,
        productId: data.productId, ts: new Date().toISOString(),
    });

    return request;
}

export async function updateRequest(client, reqId, updates) {
    const req = await client.db.get(DB.request(reqId));
    if (!req) return null;
    const updated = { ...req, ...updates, updatedAt: new Date().toISOString() };
    await client.db.set(DB.request(reqId), updated);
    return updated;
}

export async function getRequest(client, reqId) {
    return client.db.get(DB.request(reqId));
}

export async function getRequestsByStatus(client, status) {
    const list    = await client.db.get(DB.requestList()) || [];
    const results = [];
    for (const id of list) {
        const req = await client.db.get(DB.request(id));
        if (req && (!status || req.status === status)) results.push(req);
    }
    return results;
}

// ─────────────────────────────────────────────────────────────
//  LOG HELPERS
// ─────────────────────────────────────────────────────────────

export async function appendLog(client, key, entry) {
    try {
        const log = await client.db.get(key) || [];
        log.unshift(entry);
        // Keep last 500 entries
        if (log.length > 500) log.splice(500);
        await client.db.set(key, log);
    } catch (_) {}
}

// ─────────────────────────────────────────────────────────────
//  EMBED BUILDER HELPERS
// ─────────────────────────────────────────────────────────────

export function statusBadge(status) {
    const map = {
        [STATUS.PENDING_APPROVAL]: '⏳ PENDING',
        [STATUS.APPROVED]:         '✅ APPROVED',
        [STATUS.KEY_ASSIGNED]:     '🔑 KEY ASSIGNED',
        [STATUS.DENIED]:           '❌ DENIED',
        [STATUS.EXPIRED]:          '⌛ EXPIRED',
        [STATUS.CANCELLED]:        '🚫 CANCELLED',
    };
    return map[status] || status;
}

export function statusColor(status) {
    const map = {
        [STATUS.PENDING_APPROVAL]: 0xF1C40F,
        [STATUS.APPROVED]:         0x2ECC71,
        [STATUS.KEY_ASSIGNED]:     0x3498DB,
        [STATUS.DENIED]:           0xED4245,
        [STATUS.EXPIRED]:          0x95A5A6,
        [STATUS.CANCELLED]:        0x95A5A6,
    };
    return map[status] || 0x95A5A6;
}
