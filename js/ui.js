// ============================================================
// UI 模块 — 表格渲染、分页、弹窗、导入导出
// 第一阶段增强版：集成新字段（批次号、有效期、最小订货量）+ 操作日志
// ============================================================

// ============================================================
// State
// ============================================================
let currentCat = '全部';
let currentSubCat = '';
let currentPage = 1;
let editingId = null;
let stockItemId = null;
let recPage = 1;
const PAGE_SIZE = APP_CONFIG.pageSize;

// 全局缓存：供采购建议使用
window.inventoryItems = [];

// ============================================================
// Tabs（已扩展：purchase, logs）
// ============================================================
async function switchTab(name) {
  // 权限：viewer 只能看库存总览
  if (currentUserRole === 'viewer' && name !== 'dashboard') {
    showToast('👁️ 仅查看权限，只能浏览库存总览页面', 'warning');
    return;
  }
  document.querySelectorAll('.nav-tab').forEach((t, i) => {
    const tabs = ['dashboard', 'inventory', 'purchase', 'records', 'logs'];
    t.classList.toggle('active', tabs[i] === name);
  });
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'dashboard') await safeLoad(refreshDashboard);
  if (name === 'inventory') { await safeLoad(renderInventoryTable); await safeLoad(renderAlertBanner); }
  if (name === 'purchase') await safeLoad(renderPurchaseTable);
  if (name === 'records') await safeLoad(renderRecords);
  if (name === 'logs') await safeLoad(renderLogs);
}

// ============================================================
// Time
// ============================================================
function updateTime() {
  const now = new Date();
  document.getElementById('headerTime').textContent =
    now.toLocaleDateString('zh-CN') + ' ' + now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================================
// Dashboard
// ============================================================
async function refreshDashboard() {
  let inv;
  try {
    inv = await loadInventory();
    cacheData(CACHE_KEYS.inventory, inv);
    window.inventoryItems = inv;
  } catch (e) {
    inv = getCachedData(CACHE_KEYS.inventory) || [];
    window.inventoryItems = inv;
    console.warn('使用缓存数据');
  }

  const total = inv.length;
  const totalQty = inv.reduce((s, i) => s + Number(i.quantity), 0);
  const totalVal = inv.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const alertCount = inv.filter(i => Number(i.quantity) <= Number(i.alert_qty) && Number(i.alert_qty) > 0).length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statQty').textContent = totalQty.toLocaleString();
  document.getElementById('statValue').textContent = '¥' + totalVal.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('statAlert').textContent = alertCount;

  // Charts
  const cats = ['原材料', '半成品', '成品'];
  const catVals = cats.map(c => inv.filter(i => i.category === c).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0));

  renderBarChart(cats, catVals);
  renderLowStockTable(inv);

  // Recent records
  let recs;
  try {
    recs = await loadRecords();
    cacheData(CACHE_KEYS.records, recs);
  } catch (e) {
    recs = getCachedData(CACHE_KEYS.records) || [];
  }

  const tbody = document.getElementById('recentRecordsTbody');
  const recent = recs.slice(0, 8);
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">暂无出入库记录</td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(r => `
    <tr>
      <td>${fmtTimeStr(r.timestamp || r.created_at)}</td>
      <td>${escHtml(r.item_name || r.itemName)}</td>
      <td><span class="cat-tag ${typeClass(r.type)}">${r.type}</span></td>
      <td>${r.type === '调整' ? '→ ' + r.quantity : (r.type === '入库' ? '+' : '-') + r.quantity}</td>
      <td>${escHtml(r.reason || '-')}</td>
    </tr>
  `).join('');
}

// ============================================================
// Low Stock Alert Table
// ============================================================
function renderLowStockTable(inv) {
  const tbody = document.getElementById('lowStockTbody');
  if (!tbody) return;

  const lows = inv
    .filter(i => Number(i.alert_qty) > 0 && Number(i.quantity) <= Number(i.alert_qty))
    .sort((a, b) => (Number(a.quantity) - Number(a.alert_qty)) - (Number(b.quantity) - Number(b.alert_qty)));

  if (!lows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell" style="color:#5B8C5A">✅ 当前无低库存预警</td></tr>';
    return;
  }

  tbody.innerHTML = lows.map(i => {
    const gap = Number(i.alert_qty) - Number(i.quantity);
    return `<tr>
      <td><span class="cat-tag ${getCatClass(i.category)}">${i.category}</span></td>
      <td><strong>${escHtml(i.name)}</strong></td>
      <td class="qty-low">${i.quantity} ${escHtml(i.unit || '')} ⚠️</td>
      <td>${i.alert_qty}</td>
      <td class="text-danger"><strong>-${gap} ${escHtml(i.unit || '')}</strong></td>
    </tr>`;
  }).join('');
}

// ============================================================
// Inventory Table
// ============================================================
function getCatClass(cat) {
  if (cat === '原材料') return 'cat-raw';
  if (cat === '半成品') return 'cat-semi';
  return 'cat-finish';
}

function renderExpiryClass(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expiry-expired';
  if (diffDays < 30) return 'expiry-soon';
  return '';
}

async function renderInventoryTable() {
  let inv;
  try {
    inv = await loadInventory();
    cacheData(CACHE_KEYS.inventory, inv);
    window.inventoryItems = inv;
  } catch (e) {
    inv = getCachedData(CACHE_KEYS.inventory) || [];
    window.inventoryItems = inv;
    showToast('⚠️ 网络异常，使用缓存数据', 'warning');
  }

  const search = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();

  let filtered = inv.filter(item => {
    const matchCat = currentCat === '全部' || item.category === currentCat;
    const matchSubCat = !currentSubCat || (item.sub_category || '') === currentSubCat;
    const matchSearch = !search ||
      (item.name + ' ' + (item.spec || '') + ' ' + (item.supplier || '') + ' ' + (item.batch_no || '') + ' ' + (item.sub_category || '')).toLowerCase().includes(search);
    return matchCat && matchSubCat && matchSearch;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const slice = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const roleConfig = APP_CONFIG.roles[currentUserRole];

  const tbody = document.getElementById('inventoryTbody');
  if (!slice.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="15">📭 暂无库存数据，点击"新增库存"开始录入</td></tr>';
  } else {
    tbody.innerHTML = slice.map(item => {
      const isLow = Number(item.quantity) <= Number(item.alert_qty) && Number(item.alert_qty) > 0;
      const val = (Number(item.quantity) * Number(item.unit_price)).toFixed(2);
      const expiryCls = renderExpiryClass(item.expiry_date);
      const expiryText = item.expiry_date || '-';
      const actionBtns = [];
      if (roleConfig.canEdit) actionBtns.push(`<button class="btn btn-outline btn-sm" onclick="openEditModal('${item.id}')">✏️ 编辑</button>`);
      if (roleConfig.canStock) actionBtns.push(`<button class="btn btn-warning btn-sm" onclick="openStockModal('${item.id}')">📦 出入库</button>`);
      if (roleConfig.canDelete) actionBtns.push(`<button class="btn btn-danger btn-sm" onclick="handleDelete('${item.id}')">🗑️</button>`);

      return `<tr>
        <td><span class="cat-tag ${getCatClass(item.category)}">${item.category}</span></td>
        <td><span class="sub-cat-tag">${escHtml(item.sub_category || '-')}</span></td>
        <td><strong>${escHtml(item.name)}</strong></td>
        <td class="text-light">${escHtml(item.spec || '-')}</td>
        <td>${escHtml(item.unit || '-')}</td>
        <td class="${isLow ? 'qty-low' : ''}">${item.quantity}${isLow ? ' ⚠️' : ''}</td>
        <td>¥${Number(item.unit_price).toFixed(2)}</td>
        <td class="value-cell">¥${Number(val).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
        <td>${item.alert_qty || 0}</td>
        <td>${item.min_order_qty || 0}</td>
        <td class="text-light">${escHtml(item.batch_no || '-')}</td>
        <td class="${expiryCls}">${expiryText}</td>
        <td>${escHtml(item.supplier || '-')}</td>
        <td>${escHtml(item.location || '-')}</td>
        <td class="action-cell" style="white-space:nowrap">${actionBtns.join(' ')}</td>
      </tr>`;
    }).join('');
  }

  document.getElementById('pageInfo').textContent = `共 ${total} 条`;
  renderPageBtns(totalPages, 'pageBtns', currentPage, p => { currentPage = p; renderInventoryTable(); });

  // 更新角色 UI
  updateRoleUI();
}

async function renderAlertBanner() {
  let inv;
  try {
    inv = await loadInventory();
    window.inventoryItems = inv;
  } catch (e) {
    inv = getCachedData(CACHE_KEYS.inventory) || [];
  }

  const lows = inv.filter(i => Number(i.quantity) <= Number(i.alert_qty) && Number(i.alert_qty) > 0);
  const banner = document.getElementById('alertBanner');
  if (lows.length) {
    document.getElementById('alertText').innerHTML =
      `<strong>低库存预警（${lows.length} 种）：</strong>` + lows.map(i => `${i.name}（剩余 ${i.quantity} ${i.unit || ''}）`).join('、');
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}

function selectCat(el) {
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentCat = el.dataset.cat;
  currentSubCat = '';
  currentPage = 1;
  // 显示/隐藏二级分类筛选
  const subFilter = document.getElementById('subCatFilter');
  if (subFilter) {
    subFilter.style.display = (currentCat === '原材料') ? '' : 'none';
    if (currentCat !== '原材料') {
      // 重置二级分类筛选
      subFilter.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      subFilter.querySelector('.cat-tab').classList.add('active');
    }
  }
  renderInventoryTable();
}

function selectSubCat(el) {
  document.querySelectorAll('#subCatFilter .cat-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentSubCat = el.dataset.subcat;
  currentPage = 1;
  renderInventoryTable();
}

// 表单中分类切换时联动显示二级分类
function onCategoryChange() {
  const cat = document.getElementById('fCategory').value;
  const group = document.getElementById('subCatGroup');
  if (group) {
    group.style.display = (cat === '原材料') ? '' : 'none';
  }
}

// ============================================================
// Add / Edit Modal（已扩展新字段）
// ============================================================
function openAddModal() {
  editingId = null;
  document.getElementById('modalItemTitle').textContent = '新增库存';
  const fields = ['fCategory', 'fSubCategory', 'fName', 'fSpec', 'fUnit', 'fQty', 'fPrice', 'fAlert', 'fMinOrder', 'fBatchNo', 'fExpiry', 'fSupplier', 'fLocation', 'fRemark'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') el.value = id === 'fCategory' ? '原材料' : '';
    else el.value = '';
  });
  onCategoryChange(); // 初始化二级分类显示
  clearFormErrors();
  openModal('modalItem');
}

async function openEditModal(id) {
  const inv = await loadInventory();
  const item = inv.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  document.getElementById('modalItemTitle').textContent = '编辑库存';
  document.getElementById('fCategory').value = item.category;
  document.getElementById('fSubCategory').value = item.sub_category || '';
  onCategoryChange(); // 联动显示
  document.getElementById('fName').value = item.name;
  document.getElementById('fSpec').value = item.spec || '';
  document.getElementById('fUnit').value = item.unit || '';
  document.getElementById('fQty').value = item.quantity;
  document.getElementById('fPrice').value = item.unit_price;
  document.getElementById('fAlert').value = item.alert_qty || 0;
  document.getElementById('fMinOrder').value = item.min_order_qty || 0;
  document.getElementById('fBatchNo').value = item.batch_no || '';
  document.getElementById('fExpiry').value = item.expiry_date || '';
  document.getElementById('fSupplier').value = item.supplier || '';
  document.getElementById('fLocation').value = item.location || '';
  document.getElementById('fRemark').value = item.remark || '';
  clearFormErrors();
  openModal('modalItem');
}

function clearFormErrors() {
  ['errName', 'errQty'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  ['fName', 'fQty'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('error');
  });
}

async function handleSaveItem() {
  const name = document.getElementById('fName').value.trim();
  const qty = document.getElementById('fQty').value;
  let valid = true;

  if (!name) {
    document.getElementById('errName').textContent = '品名不能为空';
    document.getElementById('fName').classList.add('error');
    valid = false;
  } else {
    document.getElementById('errName').textContent = '';
    document.getElementById('fName').classList.remove('error');
  }
  if (qty === '' || isNaN(qty) || Number(qty) < 0) {
    document.getElementById('errQty').textContent = '请输入有效的库存数量';
    document.getElementById('fQty').classList.add('error');
    valid = false;
  } else {
    document.getElementById('errQty').textContent = '';
    document.getElementById('fQty').classList.remove('error');
  }
  if (!valid) return;

  // 编辑模式：先取旧值用于日志对比
  let oldItem = null;
  if (editingId) {
    const inv = await loadInventory();
    oldItem = inv.find(i => i.id === editingId);
  }

  const itemData = {
    id: editingId,
    category: document.getElementById('fCategory').value,
    sub_category: document.getElementById('fSubCategory').value || null,
    name,
    spec: document.getElementById('fSpec').value.trim(),
    unit: document.getElementById('fUnit').value.trim(),
    quantity: Number(qty),
    unit_price: Number(document.getElementById('fPrice').value) || 0,
    alert_qty: Number(document.getElementById('fAlert').value) || 0,
    min_order_qty: Number(document.getElementById('fMinOrder').value) || 0,
    batch_no: document.getElementById('fBatchNo').value.trim(),
    expiry_date: document.getElementById('fExpiry').value || null,
    supplier: document.getElementById('fSupplier').value.trim(),
    location: document.getElementById('fLocation').value.trim(),
    remark: document.getElementById('fRemark').value.trim(),
  };

  try {
    await saveItem(itemData);
    closeModal('modalItem');

    // 写操作日志
    if (editingId && oldItem) {
      // UPDATE：计算差异
      const changes = {};
      ['category', 'sub_category', 'name', 'spec', 'unit', 'quantity', 'unit_price', 'alert_qty', 'min_order_qty', 'batch_no', 'expiry_date', 'supplier', 'location', 'remark'].forEach(k => {
        if (String(oldItem[k] ?? '') !== String(itemData[k] ?? '')) {
          changes[k] = { from: oldItem[k], to: itemData[k] };
        }
      });
      if (Object.keys(changes).length) {
        await Logs.write('UPDATE', 'ITEM', editingId, name, changes);
      }
    } else {
      // CREATE
      await Logs.write('CREATE', 'ITEM', null, name, {
        category: itemData.category, quantity: itemData.quantity, unit_price: itemData.unit_price
      });
    }

    await renderInventoryTable();
    showToast(editingId ? '✅ 已更新库存条目' : '✅ 已新增库存条目', 'success');
  } catch (err) {
    showToast('❌ 操作失败: ' + err.message, 'error');
  }
}

// ============================================================
// Delete（增加日志）
// ============================================================
async function handleDelete(id) {
  const inv = await loadInventory();
  const item = inv.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确认删除"${item.name}"？此操作不可撤销。`)) return;

  try {
    await deleteItemById(id);
    await Logs.write('DELETE', 'ITEM', id, item.name, {
      category: item.category, quantity: item.quantity, spec: item.spec
    });
    await renderInventoryTable();
    showToast('🗑️ 已删除库存条目', 'warning');
  } catch (err) {
    showToast('❌ 删除失败: ' + err.message, 'error');
  }
}

// ============================================================
// Stock In/Out（增加日志）
// ============================================================
async function openStockModal(id) {
  stockItemId = id;
  const inv = await loadInventory();
  const item = inv.find(i => i.id === id);
  if (!item) return;
  document.getElementById('stockItemName').textContent = item.name;
  document.getElementById('stockCurrentQty').textContent = item.quantity + ' ' + (item.unit || '');
  document.getElementById('sType').value = '入库';
  document.getElementById('sQty').value = '';
  document.getElementById('sReason').value = '';
  document.getElementById('errSQty').textContent = '';
  openModal('modalStock');
}

async function handleSaveStock() {
  const qty = Number(document.getElementById('sQty').value);
  if (!qty || qty <= 0) {
    document.getElementById('errSQty').textContent = '请输入大于0的数量';
    return;
  }
  document.getElementById('errSQty').textContent = '';
  const type = document.getElementById('sType').value;
  const reason = document.getElementById('sReason').value.trim();

  try {
    const inv = await loadInventory();
    const item = inv.find(i => i.id === stockItemId);
    if (!item) return;

    // 出库前端预校验
    if (type === '出库' && qty > Number(item.quantity)) {
      document.getElementById('errSQty').textContent = `出库数量不能大于当前库存（${item.quantity}）`;
      return;
    }

    const changeQty = type === '调整' ? 0 : qty;
    const effectiveQty = type === '调整' ? qty : changeQty;
    const beforeQty = item.quantity;

    await performStockOperation(stockItemId, type, effectiveQty, reason);

    // 写操作日志
    const actionMap = { '入库': 'STOCK_IN', '出库': 'STOCK_OUT', '调整': 'STOCK_ADJUST' };
    await Logs.write(actionMap[type], 'ITEM', stockItemId, item.name, {
      type, qty, reason, before_qty: beforeQty, after_qty: type === '调整' ? qty : (beforeQty + (type === '入库' ? qty : -qty))
    });

    closeModal('modalStock');
    await renderInventoryTable();
    const label = type === '调整' ? '→ ' + qty : (type === '入库' ? '+' : '-') + qty;
    showToast(`✅ ${type}操作成功：${item.name} ${label}`, 'success');
  } catch (err) {
    showToast('❌ 操作失败: ' + err.message, 'error');
  }
}

// ============================================================
// Records
// ============================================================
async function renderRecords() {
  let recs;
  try {
    recs = await loadRecords();
    cacheData(CACHE_KEYS.records, recs);
  } catch (e) {
    recs = getCachedData(CACHE_KEYS.records) || [];
  }

  const typeF = document.getElementById('recTypeFilter').value;
  const dateFrom = document.getElementById('recDateFrom').value;
  const dateTo = document.getElementById('recDateTo').value;
  const search = (document.getElementById('recSearch')?.value || '').trim().toLowerCase();

  if (typeF) recs = recs.filter(r => r.type === typeF);
  if (dateFrom) recs = recs.filter(r => (r.timestamp || r.created_at) >= dateFrom);
  if (dateTo) recs = recs.filter(r => (r.timestamp || r.created_at) <= dateTo + 'T23:59:59');
  if (search) recs = recs.filter(r => (r.item_name || r.itemName || '').toLowerCase().includes(search));

  const total = recs.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (recPage > totalPages) recPage = totalPages;
  const slice = recs.slice((recPage - 1) * PAGE_SIZE, recPage * PAGE_SIZE);

  const tbody = document.getElementById('recordsTbody');
  if (!slice.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">📭 暂无出入库记录</td></tr>';
  } else {
    tbody.innerHTML = slice.map(r => `<tr>
      <td style="white-space:nowrap">${fmtTimeStr(r.timestamp || r.created_at)}</td>
      <td><strong>${escHtml(r.item_name || r.itemName)}</strong></td>
      <td><span class="cat-tag ${typeClass(r.type)}">${r.type}</span></td>
      <td>${r.type === '调整' ? '→ ' + r.quantity : (r.type === '入库' ? '<span class="text-success">+' : '<span class="text-danger">-') + r.quantity + '</span>'}</td>
      <td>${escHtml(r.reason || '-')}</td>
    </tr>`).join('');
  }

  document.getElementById('recPageInfo').textContent = `共 ${total} 条`;
  renderPageBtns(totalPages, 'recPageBtns', recPage, p => { recPage = p; renderRecords(); });
}

function typeClass(type) {
  if (type === '入库') return 'rec-in';
  if (type === '出库') return 'rec-out';
  return 'rec-adj';
}

function clearRecordFilters() {
  document.getElementById('recTypeFilter').value = '';
  document.getElementById('recDateFrom').value = '';
  document.getElementById('recDateTo').value = '';
  document.getElementById('recSearch').value = '';
  recPage = 1;
  renderRecords();
}

async function handleClearRecords() {
  if (!confirm('确认清空所有出入库记录？此操作不可撤销。')) return;
  try {
    await clearAllRecords();
    await Logs.write('DELETE', 'RECORDS', null, '全部出入库记录', { count: 'all' });
    await renderRecords();
    showToast('已清空所有记录', 'warning');
  } catch (err) {
    showToast('❌ 清空失败: ' + err.message, 'error');
  }
}

// ============================================================
// Pagination
// ============================================================
function renderPageBtns(total, containerId, current, onPage) {
  const container = document.getElementById(containerId);
  if (total <= 1) { container.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="void(0)" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>‹ 上一页</button>`;
  const range = getPRange(current, total);
  range.forEach(p => {
    if (p === '...') html += `<span class="page-dots">…</span>`;
    else html += `<button class="page-btn ${p === current ? 'active' : ''}" onclick="void(0)" data-page="${p}">${p}</button>`;
  });
  html += `<button class="page-btn" onclick="void(0)" data-page="${current + 1}" ${current === total ? 'disabled' : ''}>下一页 ›</button>`;
  container.innerHTML = html;

  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page);
      if (!isNaN(p) && p >= 1 && p <= total) onPage(p);
    });
  });
}

function getPRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const arr = [1];
  if (cur > 3) arr.push('...');
  for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) arr.push(i);
  if (cur < total - 2) arr.push('...');
  arr.push(total);
  return arr;
}

// ============================================================
// Modal Helpers
// ============================================================
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('show')) {
    closeModal(e.target.id);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal('modalItem'); closeModal('modalStock'); }
});

// ============================================================
// Toast
// ============================================================
function showToast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  const duration = (type === 'error' || type === 'warning') ? 5000 : 2800;
  setTimeout(() => {
    t.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ============================================================
// Import / Export（已扩展新字段）
// ============================================================
async function exportExcel() {
  const inv = await loadInventory();
  const cat = currentCat === '全部' ? inv : inv.filter(i => i.category === currentCat);
  if (!cat.length) { showToast('当前没有数据可导出', 'warning'); return; }

  const rows = [['分类', '二级分类', '品名', '规格/型号', '单位', '库存数量', '单价(元)', '库存价值(元)', '预警值', '最小订货量', '批次号', '有效期', '供应商', '存放位置', '备注']];
  cat.forEach(i => rows.push([
    i.category, i.sub_category || '', i.name, i.spec, i.unit, i.quantity, i.unit_price,
    (Number(i.quantity) * Number(i.unit_price)).toFixed(2),
    i.alert_qty || 0, i.min_order_qty || 0,
    i.batch_no || '', i.expiry_date || '',
    i.supplier, i.location, i.remark
  ]));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [8, 10, 12, 20, 6, 8, 8, 12, 8, 10, 14, 12, 12, 12, 12].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '库存数据');
  XLSX.writeFile(wb, `HMX库存_${fmtDate(new Date())}.xlsx`);
  showToast('✅ Excel 导出成功', 'success');
}

async function exportRecordsExcel() {
  const recs = await loadRecords();
  if (!recs.length) { showToast('暂无记录可导出', 'warning'); return; }

  const rows = [['操作时间', '品名', '类型', '数量变动', '原因/备注']];
  recs.forEach(r => rows.push([
    fmtTimeStr(r.timestamp || r.created_at), r.item_name || r.itemName, r.type,
    r.type === '调整' ? '→ ' + r.quantity : (r.type === '入库' ? '+' : '-') + r.quantity,
    r.reason || ''
  ]));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [18, 14, 6, 10, 20].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '出入库记录');
  XLSX.writeFile(wb, `出入库记录_${fmtDate(new Date())}.xlsx`);
  showToast('✅ 记录导出成功', 'success');
}

async function importCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const text = e.target.result;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) { showToast('CSV 格式不正确或无数据', 'error'); return; }

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const colMap = {};
    const headerMap = {
      '分类': 'category', '二级分类': 'sub_category',
      '品名': 'name', '规格': 'spec', '规格/型号': 'spec',
      '单位': 'unit', '库存数量': 'quantity', '单价': 'unit_price', '单价(元)': 'unit_price',
      '预警值': 'alert_qty', '最小订货量': 'min_order_qty',
      '批次号': 'batch_no', '有效期': 'expiry_date',
      '供应商': 'supplier', '存放位置': 'location', '备注': 'remark'
    };
    headers.forEach((h, i) => { if (headerMap[h]) colMap[headerMap[h]] = i; });

    if (colMap.name === undefined) { showToast('CSV 缺少"品名"列', 'error'); return; }

    const items = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      const name = cols[colMap.name];
      if (!name) continue;
      items.push({
        category: cols[colMap.category] || '原材料', sub_category: cols[colMap.sub_category] || null, name,
        spec: cols[colMap.spec] || '', unit: cols[colMap.unit] || '件',
        quantity: Number(cols[colMap.quantity]) || 0,
        unit_price: Number(cols[colMap.unit_price]) || 0,
        alert_qty: Number(cols[colMap.alert_qty]) || 0,
        min_order_qty: Number(cols[colMap.min_order_qty]) || 0,
        batch_no: cols[colMap.batch_no] || '',
        expiry_date: cols[colMap.expiry_date] || null,
        supplier: cols[colMap.supplier] || '', location: cols[colMap.location] || '',
        remark: cols[colMap.remark] || ''
      });
    }

    try {
      await batchImportItems(items);
      await Logs.write('CREATE', 'ITEM', null, 'CSV批量导入', { count: items.length });
      await renderInventoryTable();
      showToast(`✅ 成功导入 ${items.length} 条数据`, 'success');
    } catch (err) {
      showToast('❌ 导入失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

// ============================================================
// Utils
// ============================================================
function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeHtml(s) { return escHtml(s); }

function catClass(cat) { return getCatClass(cat); }

function formatMoney(n) {
  return Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtTimeStr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// ============================================================
// Safe Load Wrapper
// ============================================================
async function safeLoad(fn) {
  try {
    await fn();
  } catch (err) {
    console.warn('加载失败:', err);
    showToast('⚠️ 加载失败，请检查网络连接', 'warning');
  }
}
