// ============================================================
// 数据层 — Supabase API 封装
// 第一阶段增强版：支持新字段（批次号、有效期、最小订货量）
// ============================================================

let realtimeChannel = null;

// ============================================================
// 库存 CRUD
// ============================================================

async function loadInventory() {
  const { data, error } = await supabaseClient
    .from('inventory_items')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('加载库存失败:', error);
    return [];
  }
  // 转换为前端统一格式
  return (data || []).map(mapItem);
}

function wrapSupabaseError(error) {
  if (!error) return new Error('未知错误');
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('forbidden') || msg.includes('secret') || msg.includes('api key')) {
    return new Error('API 密钥配置错误，请联系管理员');
  }
  if (msg.includes('row-level') || msg.includes('rls') || msg.includes('violates row-level security')) {
    return new Error('无写入权限，请检查数据库权限设置');
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
    return new Error('网络连接失败，请检查网络');
  }
  if (msg.includes('duplicate') || msg.includes('unique')) {
    return new Error('数据重复，该品名已存在');
  }
  if (msg.includes('not null') || msg.includes('violates not-null')) {
    return new Error('必填字段未填写，请检查表单');
  }
  if (msg.includes('column') && msg.includes('does not exist')) {
    return new Error('数据库缺少字段，请先执行 migration_stage1.sql');
  }
  return new Error(error.message || '数据库操作失败');
}

async function saveItem(itemData) {
  // itemData: { id, category, name, spec, unit, quantity, unit_price, alert_qty, min_order_qty, batch_no, expiry_date, supplier, location, remark }
  const dbData = {
    category: itemData.category,
    sub_category: itemData.sub_category || null,
    name: itemData.name,
    spec: itemData.spec || '',
    unit: itemData.unit || '',
    quantity: Number(itemData.quantity) || 0,
    unit_price: Number(itemData.unit_price) || 0,
    alert_threshold: Number(itemData.alert_qty) || 0,  // 数据库字段为 alert_threshold
    min_order_qty: Number(itemData.min_order_qty) || 0,
    batch_no: itemData.batch_no || null,
    expiry_date: itemData.expiry_date || null,
    wip_qty: Number(itemData.wip_qty) || 0,
    project_no: itemData.project_no || null,
    supplier: itemData.supplier || '',
    location: itemData.location || '',
    remark: itemData.remark || '',
  };

  // 容错：如果新字段不存在（SQL迁移未执行），自动去掉重试
  const baseData = { ...dbData };
  delete baseData.min_order_qty;
  delete baseData.batch_no;
  delete baseData.expiry_date;
  delete baseData.sub_category;
  delete baseData.wip_qty;
  delete baseData.project_no;

  if (itemData.id) {
    // 更新
    let { error } = await supabaseClient.from('inventory_items').update(dbData).eq('id', itemData.id);
    if (error && (error.message || '').includes('does not exist')) {
      console.warn('新字段不存在，使用基础字段重试...');
      error = (await supabaseClient.from('inventory_items').update(baseData).eq('id', itemData.id)).error;
    }
    if (error) { console.error('更新库存失败:', error); throw wrapSupabaseError(error); }
  } else {
    // 新增
    let { error } = await supabaseClient.from('inventory_items').insert(dbData);
    if (error && (error.message || '').includes('does not exist')) {
      console.warn('新字段不存在，使用基础字段重试...');
      error = (await supabaseClient.from('inventory_items').insert(baseData)).error;
    }
    if (error) { console.error('新增库存失败:', error); throw wrapSupabaseError(error); }
  }
}

async function deleteItemById(id) {
  const { error } = await supabaseClient
    .from('inventory_items')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('删除库存失败:', error);
    throw wrapSupabaseError(error);
  }
}

// ============================================================
// 出入库操作（直接表操作，不使用 RPC 以免权限问题）
// ============================================================

async function performStockOperation(itemId, stockType, quantityChange, reason) {
  // 获取当前库存
  const { data: items, error: fetchErr } = await supabaseClient
    .from('inventory_items')
    .select('name, quantity')
    .eq('id', itemId)
    .single();

  if (fetchErr || !items) {
    console.error('获取库存失败:', fetchErr);
    throw new Error('物品不存在');
  }

  let newQty;
  if (stockType === '入库') {
    newQty = Number(items.quantity) + Number(quantityChange);
  } else if (stockType === '出库') {
    newQty = Number(items.quantity) - Number(quantityChange);
    if (newQty < 0) throw new Error('出库数量超过当前库存');
  } else {
    newQty = Number(quantityChange); // 调整模式直接设值
  }

  // 更新库存数量
  const { error: updateErr } = await supabaseClient
    .from('inventory_items')
    .update({ quantity: newQty })
    .eq('id', itemId);
  if (updateErr) {
    console.error('更新库存数量失败:', updateErr);
    throw wrapSupabaseError(updateErr);
  }

  // 写入出入库记录
  const { error: recErr } = await supabaseClient
    .from('stock_records')
    .insert({
      item_id: itemId,
      item_name: items.name,
      stock_type: stockType,
      quantity_change: quantityChange,
      reason: reason || '',
    });
  if (recErr) {
    console.error('写入记录失败:', recErr);
    throw wrapSupabaseError(recErr);
  }
}

// ============================================================
// 出入库记录
// ============================================================

async function loadRecords() {
  const { data, error } = await supabaseClient
    .from('stock_records')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('加载记录失败:', error);
    return [];
  }
  return (data || []).map(r => ({
    recordId: r.id,
    record_id: r.id,
    itemId: r.item_id,
    item_id: r.item_id,
    itemName: r.item_name,
    item_name: r.item_name,
    type: r.stock_type,
    quantity: r.quantity_change,
    reason: r.reason,
    timestamp: r.created_at,
    created_at: r.created_at,
    operatorId: r.operator_id,
  }));
}

async function clearAllRecords() {
  const { error } = await supabaseClient
    .from('stock_records')
    .delete()
    .gte('created_at', '2000-01-01'); // 删除所有
  if (error) {
    console.error('清空记录失败:', error);
    throw wrapSupabaseError(error);
  }
}

// ============================================================
// 批量导入（事务性批量插入）
// ============================================================

async function batchImportItems(items) {
  const dbData = items.map(item => ({
    category: item.category || '原材料',
    sub_category: item.sub_category || null,
    name: item.name,
    spec: item.spec || '',
    unit: item.unit || '件',
    quantity: Number(item.quantity) || 0,
    unit_price: Number(item.unit_price ?? item.unitPrice) || 0,
    alert_threshold: Number(item.alert_qty ?? item.alertThreshold) || 0,  // 数据库字段为 alert_threshold
    min_order_qty: Number(item.min_order_qty) || 0,
    batch_no: item.batch_no || null,
    expiry_date: item.expiry_date || null,
    supplier: item.supplier || '',
    location: item.location || '',
    remark: item.remark || '',
    wip_qty: Number(item.wip_qty) || 0,
    project_no: item.project_no || null,
  }));

  const { error } = await supabaseClient
    .from('inventory_items')
    .insert(dbData);
  if (error && (error.message || '').includes('does not exist')) {
    // 容错：新字段不存在时去掉重试
    console.warn('新字段不存在，使用基础字段重试导入...');
    const baseData = dbData.map(d => { const b = {...d}; delete b.min_order_qty; delete b.batch_no; delete b.expiry_date; delete b.sub_category; delete b.wip_qty; delete b.project_no; return b; });
    const { error: err2 } = await supabaseClient.from('inventory_items').insert(baseData);
    if (err2) { console.error('批量导入失败:', err2); throw wrapSupabaseError(err2); }
  } else if (error) {
    console.error('批量导入失败:', error);
    throw wrapSupabaseError(error);
  }
}

// ============================================================
// Realtime 订阅
// ============================================================

function subscribeToRealtime() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel('inventory-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_items' },
      (payload) => {
        console.log('库存变更:', payload.eventType, payload.new);
        handleRealtimeChange(payload.eventType);
      }
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'stock_records' },
      (payload) => {
        console.log('记录变更:', payload.eventType, payload.new);
        handleRealtimeChange(payload.eventType);
      }
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'operation_logs' },
      (payload) => {
        // 操作日志变更 → 如果当前在 logs Tab 则刷新
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab && activeTab.id === 'tab-logs' && typeof renderLogs === 'function') {
          renderLogs();
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('Realtime 已连接');
      else if (status === 'CHANNEL_ERROR') console.error('Realtime 连接错误');
    });
}

function handleRealtimeChange(eventType) {
  // 根据当前活动的 Tab 刷新数据
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
  const { data, error } = await supabaseClient
    .from('packages').select('*').order('name', { ascending: true });
  if (error) throw wrapSupabaseError(error);
  return data || [];
}

async function loadPackageItems(packageId) {
  const { data, error } = await supabaseClient
    .from('package_items')
    .select('id, package_id, item_id, qty, item:inventory_items(id, name, spec, unit, quantity)')
    .eq('package_id', packageId);
  if (error) throw wrapSupabaseError(error);
  return data || [];
}

async function savePackage(pkg, items) {
  let pkgId = pkg.id;
  if (pkgId) {
    const { error } = await supabaseClient
      .from('packages').update({ name: pkg.name, description: pkg.description || '' }).eq('id', pkgId);
    if (error) throw wrapSupabaseError(error);
    const { error: dErr } = await supabaseClient.from('package_items').delete().eq('package_id', pkgId);
    if (dErr) throw wrapSupabaseError(dErr);
  } else {
    const { data, error } = await supabaseClient
      .from('packages').insert({ name: pkg.name, description: pkg.description || '' }).select('id').single();
    if (error) throw wrapSupabaseError(error);
    pkgId = data.id;
  }
  if (items && items.length) {
    const rows = items.map(it => ({ package_id: pkgId, item_id: it.item_id, qty: Number(it.qty) || 1 }));
    const { error } = await supabaseClient.from('package_items').insert(rows);
    if (error) throw wrapSupabaseError(error);
  }
  await Logs.write(pkg.id ? 'UPDATE' : 'CREATE', 'PACKAGE', pkgId, pkg.name, { itemCount: (items || []).length });
}

async function deletePackage(id, name) {
  const { error: d1 } = await supabaseClient.from('package_items').delete().eq('package_id', id);
  if (d1) throw wrapSupabaseError(d1);
  const { error: d2 } = await supabaseClient.from('packages').delete().eq('id', id);
  if (d2) throw wrapSupabaseError(d2);
  await Logs.write('DELETE', 'PACKAGE', id, name || '套餐', {});
}

// ---------- 出库（套餐组合 + 个性化追加，事务化扣减） ----------
async function createOutbound(lines, meta) {
  // lines: [{ itemId, qty, isCustomAdd }]
  // meta:  { packageId, sets, packageName }
  if (!lines || !lines.length) throw new Error('出库明细为空');

  const inv = await loadInventory();
  const byId = {};
  inv.forEach(i => { byId[i.id] = i; });

  // 1) 聚合并按库存校验
  const need = {};
  for (const l of lines) {
    const q = Number(l.qty);
    if (!q || q <= 0) throw new Error('出库数量必须大于 0');
    need[l.itemId] = (need[l.itemId] || 0) + q;
  }
  const insufficient = [];
  for (const id in need) {
    const it = byId[id];
    if (!it) { insufficient.push('未知物品'); continue; }
    if (Number(it.quantity) < need[id]) {
      insufficient.push(`${it.name}（需 ${need[id]} / 余 ${it.quantity} ${it.unit || ''}）`);
    }
  }
  if (insufficient.length) {
    throw new Error('以下物品库存不足，无法出库：\n' + insufficient.join('、'));
  }

  // 2) 写入出库单头
  const { data: so, error: soErr } = await supabaseClient
    .from('stock_out')
    .insert({
      type: meta.packageId ? 'package' : 'single',
      package_id: meta.packageId || null,
      sets: meta.sets || null,
      operator: (Auth && Auth.getCurrentUser) ? Auth.getCurrentUser() : 'system',
      created_at: new Date().toISOString(),
    })
    .select('id').single();
  if (soErr) throw wrapSupabaseError(soErr);
  const outId = so.id;

  // 3) 逐行扣减 + 写流水 + 写明细（失败回滚已扣减项）
  const updated = [];
  try {
    for (const l of lines) {
      const it = byId[l.itemId];
      const newQty = Number(it.quantity) - Number(l.qty);
      const { error: uErr } = await supabaseClient.from('inventory_items').update({ quantity: newQty }).eq('id', l.itemId);
      if (uErr) throw wrapSupabaseError(uErr);
      updated.push({ id: l.itemId, prev: it.quantity });

      await supabaseClient.from('stock_records').insert({
        item_id: l.itemId, item_name: it.name, stock_type: '出库',
        quantity_change: Number(l.qty),
        reason: meta.packageId ? ('套餐出库：' + (meta.packageName || '')) : '出库',
      });
      await supabaseClient.from('stock_out_items').insert({
        out_id: outId, item_id: l.itemId, qty: Number(l.qty), is_custom_add: !!l.isCustomAdd,
      });
    }
  } catch (e) {
    for (const u of updated) {
      await supabaseClient.from('inventory_items').update({ quantity: u.prev }).eq('id', u.id);
    }
    throw new Error('出库中断，已回滚：' + e.message);
  }

  await Logs.write('STOCK_OUT', 'OUTBOUND', outId, meta.packageName || '零散出库', {
    type: meta.packageId ? 'package' : 'single', sets: meta.sets, lines,
  });
  return outId;
}

async function loadOutbounds(limit = 50) {
  const { data, error } = await supabaseClient
    .from('stock_out')
    .select('*, package:packages(name), items:stock_out_items(id, item_id, qty, is_custom_add, item:inventory_items(name, unit))')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw wrapSupabaseError(error);
  return data || [];
}

// ---------- 盘点（生成 → 录入 → 过账） ----------
async function generateStocktake() {
  const inv = await loadInventory();
  const { data: st, error } = await supabaseClient
    .from('stocktake')
    .insert({ operator: (Auth && Auth.getCurrentUser) ? Auth.getCurrentUser() : 'system', status: 'open', created_at: new Date().toISOString() })
    .select('id').single();
  if (error) throw wrapSupabaseError(error);
  if (inv.length) {
    const rows = inv.map(i => ({ take_id: st.id, item_id: i.id, system_qty: Number(i.quantity), actual_qty: null }));
    const { error: e2 } = await supabaseClient.from('stocktake_items').insert(rows);
    if (e2) throw wrapSupabaseError(e2);
  }
  await Logs.write('CREATE', 'STOCKTAKE', st.id, '新建盘点单', { count: inv.length });
  return st.id;
}

async function loadStocktakeItems(takeId) {
  const { data, error } = await supabaseClient
    .from('stocktake_items')
    .select('id, take_id, item_id, system_qty, actual_qty, item:inventory_items(name, spec, unit, category)')
    .eq('take_id', takeId);
  if (error) throw wrapSupabaseError(error);
  return data || [];
}

async function saveStocktakeActual(takeId, actualMap) {
  // actualMap: { itemId: actualQty }
  for (const [itemId, actual] of Object.entries(actualMap)) {
    const val = (actual === '' || actual == null) ? null : Number(actual);
    const { error } = await supabaseClient
      .from('stocktake_items').update({ actual_qty: val }).eq('take_id', takeId).eq('item_id', itemId);
    if (error) throw wrapSupabaseError(error);
  }
}

async function postStocktake(takeId) {
  const { data: items, error } = await supabaseClient
    .from('stocktake_items').select('*').eq('take_id', takeId);
  if (error) throw wrapSupabaseError(error);

  const inv = await loadInventory();
  const byId = {};
  inv.forEach(i => { byId[i.id] = i; });

  const updated = [];
  for (const it of items) {
    if (it.actual_qty === null || it.actual_qty === '') continue;
    const cur = byId[it.item_id];
    if (!cur) continue;
    const actual = Number(it.actual_qty);
    if (actual === Number(cur.quantity)) continue;
    const { error: uErr } = await supabaseClient.from('inventory_items').update({ quantity: actual }).eq('id', it.item_id);
    if (uErr) throw wrapSupabaseError(uErr);
    updated.push({ id: it.item_id, name: cur.name, diff: actual - Number(cur.quantity) });
    await supabaseClient.from('stock_records').insert({
      item_id: it.item_id, item_name: cur.name, stock_type: '调整',
      quantity_change: actual, reason: '盘点调整',
    });
  }
  const { error: cErr } = await supabaseClient.from('stocktake').update({ status: 'closed' }).eq('id', takeId);
  if (cErr) throw wrapSupabaseError(cErr);
  await Logs.write('STOCK_ADJUST', 'STOCKTAKE', takeId, '盘点过账', { adjusted: updated });
  return updated.length;
}
