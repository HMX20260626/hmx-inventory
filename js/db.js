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
    name: itemData.name,
    spec: itemData.spec || '',
    unit: itemData.unit || '',
    quantity: Number(itemData.quantity) || 0,
    unit_price: Number(itemData.unit_price) || 0,
    alert_threshold: Number(itemData.alert_qty) || 0,  // 数据库字段为 alert_threshold
    min_order_qty: Number(itemData.min_order_qty) || 0,
    batch_no: itemData.batch_no || null,
    expiry_date: itemData.expiry_date || null,
    supplier: itemData.supplier || '',
    location: itemData.location || '',
    remark: itemData.remark || '',
  };

  // 容错：如果新字段不存在（SQL迁移未执行），自动去掉重试
  const baseData = { ...dbData };
  delete baseData.min_order_qty;
  delete baseData.batch_no;
  delete baseData.expiry_date;

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
  }));

  const { error } = await supabaseClient
    .from('inventory_items')
    .insert(dbData);
  if (error && (error.message || '').includes('does not exist')) {
    // 容错：新字段不存在时去掉重试
    console.warn('新字段不存在，使用基础字段重试导入...');
    const baseData = dbData.map(d => { const b = {...d}; delete b.min_order_qty; delete b.batch_no; delete b.expiry_date; return b; });
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
    name: row.name,
    spec: row.spec,
    unit: row.unit,
    quantity: Number(row.quantity),
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
