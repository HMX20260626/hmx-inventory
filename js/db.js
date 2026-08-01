// ============================================================
// 数据层 — 本地 IndexedDB（替代 Supabase，零费用、纯前端）
// 所有函数签名与返回结构与 Supabase 版本保持一致，供 ui.js / v2.js / logs.js / drawing 复用
// ============================================================

// 跨标签页同步（同浏览器多标签页实时刷新）
const _sync = ('BroadcastChannel' in window) ? new BroadcastChannel('hmx_inventory_sync') : null;
function notifyChange() {
  if (_sync) _sync.postMessage({ ts: Date.now() });
  // 触发 GitHub 共享同步（防抖推送）
  if (typeof Sync !== 'undefined' && Sync.enabled && Sync.enabled()) Sync.schedulePush();
}

function uid() { return LocalDB.uid(); }
function nowISO() { return new Date().toISOString(); }
function normCat(c) {
  return (c === 'standard' || c === 'custom' || c === 'connector') ? c : 'standard';
}

function wrapSupabaseError(error) {
  const msg = (error && error.message) ? error.message : String(error || '本地数据操作失败');
  return new Error(msg);
}

// ============================================================
// 库存 CRUD
// ============================================================
async function loadInventory() {
  try {
    const rows = await LocalDB.getAll('inventory_items');
    rows.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    return rows.map(mapItem);
  } catch (e) {
    console.error('加载库存失败:', e);
    return [];
  }
}

async function saveItem(itemData) {
  const dbData = {
    category: normCat(itemData.category),
    sub_category: itemData.sub_category || null,
    name: itemData.name,
    spec: itemData.spec || '',
    unit: itemData.unit || '',
    quantity: Number(itemData.quantity) || 0,
    unit_price: Number(itemData.unit_price) || 0,
    alert_threshold: Number(itemData.alert_qty) || 0,  // 兼容前端 alert_qty
    min_order_qty: Number(itemData.min_order_qty) || 0,
    batch_no: itemData.batch_no || null,
    expiry_date: itemData.expiry_date || null,
    wip_qty: Number(itemData.wip_qty) || 0,
    project_no: itemData.project_no || null,
    supplier: itemData.supplier || '',
    location: itemData.location || '',
    remark: itemData.remark || '',
  };

  if (itemData.id) {
    const existing = await LocalDB.get('inventory_items', itemData.id);
    dbData.id = itemData.id;
    dbData.created_at = existing ? existing.created_at : nowISO();
    dbData.updated_at = nowISO();
    await LocalDB.put('inventory_items', dbData);
  } else {
    dbData.id = uid();
    dbData.created_at = nowISO();
    dbData.updated_at = nowISO();
    await LocalDB.put('inventory_items', dbData);
  }
  notifyChange();
}

async function deleteItemById(id) {
  await LocalDB.del('inventory_items', id);
  if (typeof Sync !== 'undefined') Sync.markDeleted(id);
  notifyChange();
}

// ============================================================
// 出入库操作（直接本地表操作）
// ============================================================
async function performStockOperation(itemId, stockType, quantityChange, reason) {
  const item = await LocalDB.get('inventory_items', itemId);
  if (!item) throw new Error('物品不存在');

  let newQty;
  if (stockType === '入库') {
    newQty = Number(item.quantity) + Number(quantityChange);
  } else if (stockType === '出库') {
    newQty = Number(item.quantity) - Number(quantityChange);
    if (newQty < 0) throw new Error('出库数量超过当前库存');
  } else {
    newQty = Number(quantityChange); // 调整模式直接设值
  }

  await LocalDB.put('inventory_items', { ...item, quantity: newQty, updated_at: nowISO() });

  await LocalDB.put('stock_records', {
    id: uid(),
    item_id: itemId,
    item_name: item.name,
    stock_type: stockType,
    quantity_change: quantityChange,
    reason: reason || '',
    created_at: nowISO(),
  });
  notifyChange();
}

// ============================================================
// 出入库记录
// ============================================================
async function loadRecords() {
  try {
    const rows = await LocalDB.getAll('stock_records');
    rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const limited = rows.slice(0, 200);
    return limited.map((r) => ({
      recordId: r.id, record_id: r.id,
      itemId: r.item_id, item_id: r.item_id,
      itemName: r.item_name, item_name: r.item_name,
      type: r.stock_type,
      quantity: r.quantity_change,
      reason: r.reason,
      timestamp: r.created_at, created_at: r.created_at,
      operatorId: r.operator_id,
    }));
  } catch (e) {
    console.error('加载记录失败:', e);
    return [];
  }
}

async function clearAllRecords() {
  await LocalDB.clear('stock_records');
  if (typeof Sync !== 'undefined') Sync.markCleared('stock_records');
  notifyChange();
}

// ============================================================
// 批量导入（事务性批量插入）
// ============================================================
async function batchImportItems(items) {
  const dbData = items.map((item) => ({
    id: uid(),
    category: normCat(item.category || 'standard'),
    sub_category: item.sub_category || null,
    name: item.name,
    spec: item.spec || '',
    unit: item.unit || '件',
    quantity: Number(item.quantity) || 0,
    unit_price: Number(item.unit_price ?? item.unitPrice) || 0,
    alert_threshold: Number(item.alert_qty ?? item.alertThreshold) || 0,
    min_order_qty: Number(item.min_order_qty) || 0,
    batch_no: item.batch_no || null,
    expiry_date: item.expiry_date || null,
    wip_qty: Number(item.wip_qty) || 0,
    project_no: item.project_no || null,
    supplier: item.supplier || '',
    location: item.location || '',
    remark: item.remark || '',
    created_at: nowISO(),
    updated_at: nowISO(),
  }));

  await LocalDB.bulkPut('inventory_items', dbData);
  notifyChange();
}

// ============================================================
// 跨标签页同步（替代 Supabase Realtime）
// ============================================================
function subscribeToRealtime() {
  if (_sync) {
    _sync.onmessage = () => {
      const active = document.querySelector('.tab-content.active');
      if (active) handleRealtimeChange('*');
    };
  }
}

function handleRealtimeChange(eventType) {
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab) return;

  if (activeTab.id === 'tab-dashboard') {
    refreshDashboard();
  } else if (activeTab.id === 'tab-inventory') {
    renderInventoryTable();
    renderAlertBanner();
  } else if (activeTab.id === 'tab-purchase') {
    renderPurchaseTable();
  } else if (activeTab.id === 'tab-records') {
    renderRecords();
  } else if (activeTab.id === 'tab-logs' && typeof renderLogs === 'function') {
    renderLogs();
  }
}

// ============================================================
// 数据格式转换（数据库 → 前端统一使用下划线命名）
// ============================================================
function mapItem(row) {
  return {
    id: row.id,
    category: row.category,
    itemClass: row.category,   // 三类代码：standard / custom / connector
    sub_category: row.sub_category || '',
    name: row.name,
    spec: row.spec,
    unit: row.unit,
    quantity: Number(row.quantity),
    wip_qty: Number(row.wip_qty ?? 0),     // 在制量（定制件）
    project_no: row.project_no || '',       // 项目号（定制件）
    unit_price: Number(row.unit_price),
    alert_qty: Number(row.alert_qty ?? row.alert_threshold ?? 0),
    min_order_qty: Number(row.min_order_qty ?? 0),
    batch_no: row.batch_no || '',
    expiry_date: row.expiry_date || '',
    supplier: row.supplier,
    location: row.location,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// ============================================================
// 缓存（离线兜底）
// ============================================================
const CACHE_KEYS = {
  inventory: 'pwa_inventory_cache',
  records: 'pwa_records_cache',
  timestamp: 'pwa_cache_ts',
};

function cacheData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(CACHE_KEYS.timestamp, Date.now().toString());
  } catch (e) { /* quota exceeded, ignore */ }
}

function getCachedData(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function getCacheAge() {
  const ts = localStorage.getItem(CACHE_KEYS.timestamp);
  return ts ? Date.now() - parseInt(ts) : Infinity;
}

// ============================================================
// v2 扩展：套餐 / 出库 / 盘点
// ============================================================

// ---------- 套餐（BOM） ----------
async function loadPackages() {
  const rows = await LocalDB.getAll('packages');
  rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return rows;
}

async function loadPackageItems(packageId) {
  const rows = await LocalDB.queryByIndex('package_items', 'package_id', packageId);
  const out = [];
  for (const r of rows) {
    const item = await LocalDB.get('inventory_items', r.item_id);
    out.push({
      id: r.id, package_id: r.package_id, item_id: r.item_id, qty: r.qty,
      item: item ? { id: item.id, name: item.name, spec: item.spec, unit: item.unit, quantity: item.quantity } : null,
    });
  }
  return out;
}

async function savePackage(pkg, items) {
  let pkgId = pkg.id;
  if (pkgId) {
    const existing = await LocalDB.get('packages', pkgId);
    await LocalDB.put('packages', {
      ...existing, name: pkg.name, description: pkg.description || '', updated_at: nowISO(),
    });
    await LocalDB.deleteByIndex('package_items', 'package_id', pkgId);
  } else {
    pkgId = uid();
    await LocalDB.put('packages', {
      id: pkgId, name: pkg.name, description: pkg.description || '',
      created_at: nowISO(), updated_at: nowISO(),
    });
  }
  const rows = (items || []).map((it) => ({
    id: uid(), package_id: pkgId, item_id: it.item_id, qty: Number(it.qty) || 1,
  }));
  if (rows.length) await LocalDB.bulkPut('package_items', rows);
  notifyChange();
}

async function deletePackage(id) {
  const pitems = await LocalDB.queryByIndex('package_items', 'package_id', id);
  await LocalDB.deleteByIndex('package_items', 'package_id', id);
  await LocalDB.del('packages', id);
  if (typeof Sync !== 'undefined') Sync.markDeleted(pitems.map((p) => p.id).concat(id));
  notifyChange();
}

// ---------- 出库（套餐组合 + 个性化追加） ----------
async function createOutbound(lines, meta) {
  const prev = {};
  const outId = uid();
  try {
    await LocalDB.put('stock_out', {
      id: outId,
      type: meta.type || 'single',
      package_id: meta.packageId || null,
      sets: meta.sets || null,
      operator: meta.operator || null,
      created_at: nowISO(),
    });
    for (const l of lines) {
      const item = await LocalDB.get('inventory_items', l.itemId);
      if (!item) throw new Error('物品不存在：' + l.itemId);
      const prevQty = Number(item.quantity);
      prev[l.itemId] = prevQty;
      const newQty = prevQty - Number(l.qty);
      if (newQty < 0) throw new Error('出库数量超过当前库存：' + item.name);
      await LocalDB.put('inventory_items', { ...item, quantity: newQty, updated_at: nowISO() });
      await LocalDB.put('stock_out_items', {
        id: uid(), out_id: outId, item_id: l.itemId, qty: Number(l.qty), is_custom_add: !!l.isCustomAdd,
      });
      await LocalDB.put('stock_records', {
        id: uid(), item_id: l.itemId, item_name: item.name,
        stock_type: '出库', quantity_change: Number(l.qty), reason: meta.reason || '出库', created_at: nowISO(),
      });
    }
    notifyChange();
    return outId;
  } catch (e) {
    // 回滚库存
    for (const [id, q] of Object.entries(prev)) {
      const it = await LocalDB.get('inventory_items', id);
      if (it) await LocalDB.put('inventory_items', { ...it, quantity: q, updated_at: nowISO() });
    }
    await LocalDB.del('stock_out', outId).catch(() => {});
    throw e;
  }
}

async function loadOutbounds(limit = 50) {
  const rows = await LocalDB.getAll('stock_out');
  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const limited = rows.slice(0, limit);
  const out = [];
  for (const so of limited) {
    let pkgName = null;
    if (so.package_id) {
      const p = await LocalDB.get('packages', so.package_id);
      pkgName = p ? p.name : null;
    }
    const items = await LocalDB.queryByIndex('stock_out_items', 'out_id', so.id);
    const itemDetails = [];
    for (const si of items) {
      const it = await LocalDB.get('inventory_items', si.item_id);
      itemDetails.push({
        id: si.id, item_id: si.item_id, qty: si.qty, is_custom_add: si.is_custom_add,
        item: it ? { name: it.name, unit: it.unit } : null,
      });
    }
    out.push({ ...so, package: pkgName ? { name: pkgName } : null, items: itemDetails });
  }
  return out;
}

// ---------- 盘点（生成 → 录入 → 过账） ----------
async function generateStocktake() {
  const inv = await LocalDB.getAll('inventory_items');
  const stId = uid();
  await LocalDB.put('stocktake', {
    id: stId,
    operator: (Auth && Auth.getCurrentUser) ? Auth.getCurrentUser() : 'system',
    status: 'open',
    created_at: nowISO(),
  });
  const rows = inv.map((i) => ({
    id: uid(), take_id: stId, item_id: i.id, system_qty: Number(i.quantity), actual_qty: null,
  }));
  if (rows.length) await LocalDB.bulkPut('stocktake_items', rows);
  if (typeof Logs !== 'undefined') await Logs.write('CREATE', 'STOCKTAKE', stId, '新建盘点单', { count: inv.length });
  notifyChange();
  return stId;
}

async function loadStocktakeItems(takeId) {
  const rows = await LocalDB.queryByIndex('stocktake_items', 'take_id', takeId);
  const out = [];
  for (const r of rows) {
    const item = await LocalDB.get('inventory_items', r.item_id);
    out.push({
      id: r.id, take_id: r.take_id, item_id: r.item_id,
      system_qty: r.system_qty, actual_qty: r.actual_qty,
      item: item ? { name: item.name, spec: item.spec, unit: item.unit, category: item.category } : null,
    });
  }
  return out;
}

async function saveStocktakeActual(takeId, actualMap) {
  const rows = await LocalDB.queryByIndex('stocktake_items', 'take_id', takeId);
  for (const r of rows) {
    if (!(r.item_id in actualMap)) continue;
    const val = (actualMap[r.item_id] === '' || actualMap[r.item_id] == null) ? null : Number(actualMap[r.item_id]);
    await LocalDB.put('stocktake_items', { ...r, actual_qty: val });
  }
  notifyChange();
}

async function postStocktake(takeId) {
  const items = await LocalDB.queryByIndex('stocktake_items', 'take_id', takeId);
  const inv = await LocalDB.getAll('inventory_items');
  const byId = {};
  inv.forEach((i) => { byId[i.id] = i; });

  const updated = [];
  for (const it of items) {
    if (it.actual_qty === null || it.actual_qty === '') continue;
    const cur = byId[it.item_id];
    if (!cur) continue;
    const actual = Number(it.actual_qty);
    if (actual === Number(cur.quantity)) continue;
    await LocalDB.put('inventory_items', { ...cur, quantity: actual, updated_at: nowISO() });
    await LocalDB.put('stock_records', {
      id: uid(), item_id: it.item_id, item_name: cur.name,
      stock_type: '调整', quantity_change: actual, reason: '盘点调整', created_at: nowISO(),
    });
    updated.push({ id: it.item_id, name: cur.name, diff: actual - Number(cur.quantity) });
  }
  const st = await LocalDB.get('stocktake', takeId);
  if (st) await LocalDB.put('stocktake', { ...st, status: 'closed', updated_at: nowISO() });
  if (typeof Logs !== 'undefined') await Logs.write('STOCK_ADJUST', 'STOCKTAKE', takeId, '盘点过账', { adjusted: updated });
  notifyChange();
  return updated.length;
}

// ============================================================
// 全量备份 / 恢复（替代多设备实时同步）
// ============================================================
async function exportAllData() {
  const stores = LocalDB.STORES.filter((s) => s !== 'meta');
  const data = {};
  for (const s of stores) data[s] = await LocalDB.getAll(s);
  const payload = { app: 'hmx-inventory', version: 2, exportedAt: nowISO(), data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `HMX库存备份_${nowISO().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  if (typeof showToast === 'function') showToast('已导出全部数据', 'success');
}

async function importAllData(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const data = parsed.data || parsed;
  const stores = LocalDB.STORES.filter((s) => s !== 'meta');
  for (const s of stores) {
    if (Array.isArray(data[s])) await LocalDB.replaceAll(s, data[s]);
  }
  notifyChange();
  if (typeof showToast === 'function') showToast('数据已恢复，正在刷新…', 'success');
  if (typeof refreshDashboard === 'function') refreshDashboard();
  if (typeof renderInventoryTable === 'function') { renderInventoryTable(); renderAlertBanner(); }
}
