// ============================================================
// HMX v2 模块 — 出库（套餐+个性化追加）/ 套餐 BOM / 盘点
// 依赖：db.js、ui.js（showToast/escHtml/Logs 等全局）
// ============================================================

// 三大类产品定义
const ITEM_CLASS = {
  standard:  { label: '标准件', icon: '📦', cls: 'cat-standard' },
  custom:    { label: '定制件', icon: '🛠️', cls: 'cat-custom' },
  connector: { label: '连接件', icon: '🔩', cls: 'cat-connector' },
};
function classLabel(c) { return (ITEM_CLASS[c] || {}).label || (c || '未分类'); }
function classIcon(c) { return (ITEM_CLASS[c] || {}).icon || '📦'; }
function classTag(c) {
  const m = ITEM_CLASS[c] || {};
  return `<span class="cat-tag ${m.cls || 'cat-standard'}">${m.label || c || '未分类'}</span>`;
}

// ---------- 状态 ----------
let obPkgId = null, obSets = 1, obLines = [], obStockMap = {};
let pkgEditId = null, pkgItems = [];
let stId = null, stItems = [];

function showV2Error(container, err, what) {
  const msg = (err && err.message) || String(err);
  const hint = /indexeddb|database|store/i.test(msg || '')
    ? '<br><span class="hint-text">本地数据库初始化失败，请尝试硬刷新（Ctrl/Cmd+Shift+R）或使用支持的浏览器（Chrome/Edge/Firefox）。</span>'
    : '';
  container.innerHTML = `<div class="alert-banner show" style="display:flex">
    <span class="alert-icon">⚠️</span>
    <span>${what || '加载'}失败：${escHtml(msg)}${hint}</span></div>`;
}

// ============================================================
// 出库
// ============================================================
async function renderOutbound() {
  const root = document.getElementById('outboundRoot');
  if (!root) return;
  let pkgs = [], inv = [];
  try { pkgs = await loadPackages(); }
  catch (e) { return showV2Error(root, e, '套餐'); }
  try { inv = await loadInventory(); }
  catch (e) { inv = getCachedData(CACHE_KEYS.inventory) || []; }
  window.inventoryItems = inv;
  obStockMap = {}; inv.forEach(i => obStockMap[i.id] = Number(i.quantity));
  obPkgId = null; obSets = 1; obLines = [];

  root.innerHTML = `
    <div class="top-action-row">
      <div class="section-title">📤 出库管理</div>
      <div class="action-btns">
        <button class="btn btn-outline btn-sm" onclick="renderOutbound()">🔄 刷新</button>
      </div>
    </div>
    <div class="ob-layout">
      <div class="ob-left">
        <div class="form-group">
          <label>① 选择基础套餐（可留空做零散出库）</label>
          <select class="form-select" id="obPackage" onchange="onOutboundPackageChange()"></select>
        </div>
        <div class="form-group" id="obSetsGroup" style="display:none">
          <label>套餐套数</label>
          <input class="form-input" id="obSets" type="number" min="1" value="1" oninput="changeObSets()">
        </div>
        <div id="obPkgInfo" class="ob-pkg-info"></div>
        <div class="ob-tip">💡 选好套餐后，可在右侧「追加」定制件或额外标准件/连接件，灵活搭配出库。</div>
      </div>
      <div class="ob-right">
        <div class="ob-add-row">
          <select class="form-select" id="obAddItem"></select>
          <input class="form-input" id="obAddQty" type="number" min="1" placeholder="数量" style="max-width:110px">
          <button class="btn btn-outline btn-sm" onclick="addOutboundLine()">+ 追加定制件/额外件</button>
        </div>
        <div class="table-wrap" style="margin-top:10px">
          <div class="table-scroll">
            <table>
              <thead><tr>
                <th>物料</th><th>规格</th><th>单位</th><th>出库数量</th>
                <th>当前库存</th><th>状态</th><th>来源</th><th></th>
              </tr></thead>
              <tbody id="obLinesTbody"></tbody>
            </table>
          </div>
        </div>
        <div id="obValidation" class="ob-validation"></div>
        <div class="top-action-row" style="margin-top:12px; border:none; padding:0">
          <button class="btn btn-warning" id="obConfirm" onclick="confirmOutbound()">✅ 确认出库</button>
        </div>
      </div>
    </div>`;

  const sel = document.getElementById('obPackage');
  sel.innerHTML = '<option value="">— 不选（零散出库）—</option>' +
    pkgs.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  const add = document.getElementById('obAddItem');
  add.innerHTML = '<option value="">选择要追加的物料...</option>' +
    inv.map(i => `<option value="${i.id}">${escHtml(i.name)}${i.spec ? '（' + escHtml(i.spec) + '）' : ''} · 余${i.quantity}</option>`).join('');

  renderObLines();
}

async function onOutboundPackageChange() {
  obPkgId = document.getElementById('obPackage').value || null;
  const info = document.getElementById('obPkgInfo');
  const setsGroup = document.getElementById('obSetsGroup');
  if (obPkgId) {
    try {
      const items = await loadPackageItems(obPkgId);
      obSets = 1;
      obLines = items.map(it => ({
        itemId: it.item_id,
        name: (it.item && it.item.name) || '',
        spec: (it.item && it.item.spec) || '',
        unit: (it.item && it.item.unit) || '',
        baseQty: Number(it.qty),
        qty: Number(it.qty),
        isCustomAdd: false,
        fromPackage: true,
      }));
      setsGroup.style.display = '';
      document.getElementById('obSets').value = 1;
      info.innerHTML = `📋 套餐含 <strong>${items.length}</strong> 种物料，套数默认为 1。`;
    } catch (e) {
      showToast('加载套餐明细失败：' + e.message, 'error');
    }
  } else {
    obLines = [];
    setsGroup.style.display = 'none';
    info.innerHTML = '';
  }
  renderObLines();
}

function changeObSets() {
  obSets = Number(document.getElementById('obSets').value) || 1;
  if (obSets < 1) obSets = 1;
  obLines.forEach(l => { if (l.fromPackage) l.qty = l.baseQty * obSets; });
  renderObLines();
}

function addOutboundLine() {
  const itemId = document.getElementById('obAddItem').value;
  const qty = Number(document.getElementById('obAddQty').value);
  if (!itemId) { showToast('请选择要追加的物料', 'warning'); return; }
  if (!qty || qty <= 0) { showToast('请输入大于 0 的数量', 'warning'); return; }
  const it = (window.inventoryItems || []).find(i => i.id === itemId);
  if (!it) return;
  obLines.push({
    itemId, name: it.name, spec: it.spec || '', unit: it.unit || '',
    qty, isCustomAdd: true, fromPackage: false,
  });
  document.getElementById('obAddQty').value = '';
  renderObLines();
}

function removeObLine(idx) {
  obLines.splice(idx, 1);
  renderObLines();
}

function onObQtyChange(input) {
  const idx = Number(input.dataset.idx);
  obLines[idx].qty = Number(input.value) || 0;
  validateOb();
}

function renderObLines() {
  const tbody = document.getElementById('obLinesTbody');
  if (!tbody) return;
  if (!obLines.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">尚未选择套餐或追加物料</td></tr>';
    validateOb();
    return;
  }
  tbody.innerHTML = obLines.map((l, idx) => {
    const stock = obStockMap[l.itemId] != null ? obStockMap[l.itemId] : 0;
    const ok = Number(l.qty) > 0 && Number(l.qty) <= stock;
    return `<tr class="${ok ? '' : 'row-error'}">
      <td><strong>${escHtml(l.name)}</strong></td>
      <td class="text-light">${escHtml(l.spec || '-')}</td>
      <td>${escHtml(l.unit || '-')}</td>
      <td><input class="form-input ob-qty" type="number" min="1" value="${l.qty}" data-idx="${idx}" oninput="onObQtyChange(this)"></td>
      <td>${stock} ${escHtml(l.unit || '')}</td>
      <td>${ok ? '<span class="rec-in">充足</span>' : '<span class="rec-out">不足</span>'}</td>
      <td>${l.isCustomAdd ? '<span class="urgency urgency-mid">追加</span>' : '<span class="cat-tag cat-standard">套餐</span>'}</td>
      <td>${l.isCustomAdd ? `<button class="btn btn-danger btn-sm" onclick="removeObLine(${idx})">✕</button>` : ''}</td>
    </tr>`;
  }).join('');
  validateOb();
}

function validateOb() {
  const box = document.getElementById('obValidation');
  const btn = document.getElementById('obConfirm');
  if (!box) return false;
  if (!obLines.length) {
    box.innerHTML = '<span class="text-light">请先选择套餐或追加物料。</span>';
    if (btn) btn.disabled = true;
    return false;
  }
  let bad = 0, empty = 0;
  obLines.forEach(l => {
    const stock = obStockMap[l.itemId] != null ? obStockMap[l.itemId] : 0;
    if (!Number(l.qty) || Number(l.qty) <= 0) empty++;
    else if (Number(l.qty) > stock) bad++;
  });
  if (empty) {
    box.innerHTML = `<span class="text-danger">⚠️ 有 ${empty} 行出库数量未填写或无效。</span>`;
    if (btn) btn.disabled = true;
    return false;
  }
  if (bad) {
    box.innerHTML = `<span class="text-danger">⚠️ 有 ${bad} 种物料库存不足，请调整数量或追加来源。</span>`;
    if (btn) btn.disabled = true;
    return false;
  }
  box.innerHTML = `<span class="text-success">✅ 库存校验通过，可出库共 ${obLines.length} 种物料。</span>`;
  if (btn) btn.disabled = false;
  return true;
}

async function confirmOutbound() {
  if (!validateOb()) return;
  const sel = document.getElementById('obPackage');
  const pkgName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '零散出库';
  const meta = {
    packageId: obPkgId || null,
    sets: obPkgId ? obSets : null,
    packageName: obPkgId ? pkgName : '零散出库',
  };
  const lines = obLines.map(l => ({ itemId: l.itemId, qty: Number(l.qty), isCustomAdd: l.isCustomAdd }));
  const btn = document.getElementById('obConfirm');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 出库中...'; }
  try {
    const outId = await createOutbound(lines, meta);
    showToast('✅ 出库成功（单号 ' + outId.slice(0, 8) + '）', 'success');
    // 刷新缓存库存
    try {
      const inv = await loadInventory();
      cacheData(CACHE_KEYS.inventory, inv);
      window.inventoryItems = inv;
    } catch (e) {}
    renderOutbound();
    if (typeof refreshDashboard === 'function') refreshDashboard();
  } catch (e) {
    showToast('❌ 出库失败：' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ 确认出库'; }
  }
}

// ============================================================
// 套餐（BOM 维护）
// ============================================================
async function renderPackages() {
  const root = document.getElementById('packagesRoot');
  if (!root) return;
  let pkgs = [];
  try { pkgs = await loadPackages(); }
  catch (e) { return showV2Error(root, e, '套餐'); }

  root.innerHTML = `
    <div class="top-action-row">
      <div class="section-title">📋 套餐管理（BOM）</div>
      <div class="action-btns">
        <button class="btn btn-primary btn-sm" onclick="openPkgEditor(null)">➕ 新建套餐</button>
        <button class="btn btn-outline btn-sm" onclick="renderPackages()">🔄 刷新</button>
      </div>
    </div>
    <div id="pkgList"></div>
    <div id="pkgEditor"></div>`;

  const list = document.getElementById('pkgList');
  if (!pkgs.length) {
    list.innerHTML = '<div class="alert-banner" style="display:flex"><span class="alert-icon">📋</span><span>暂无套餐，点击右上角「新建套餐」创建一个基础组合。</span></div>';
    return;
  }
  list.innerHTML = `<div class="table-wrap"><div class="table-scroll"><table>
    <thead><tr><th>套餐名称</th><th>说明</th><th>操作</th></tr></thead>
    <tbody>${pkgs.map(p => `<tr>
      <td><strong>${escHtml(p.name)}</strong></td>
      <td class="text-light">${escHtml(p.description || '-')}</td>
      <td class="action-cell" style="white-space:nowrap">
        <button class="btn btn-outline btn-sm" onclick="openPkgEditor('${p.id}')">✏️ 编辑</button>
        <button class="btn btn-danger btn-sm" onclick="handleDeletePkg('${p.id}','${escHtml(p.name)}')">🗑️</button>
      </td></tr>`).join('')}</tbody>
  </table></div></div>`;
}

async function openPkgEditor(id) {
  pkgEditId = id;
  const editor = document.getElementById('pkgEditor');
  if (!editor) return;
  let name = '', desc = '', rows = [];
  if (id) {
    try {
      const pkgs = await loadPackages();
      const p = pkgs.find(x => x.id === id);
      if (p) { name = p.name; desc = p.description || ''; }
      const items = await loadPackageItems(id);
      rows = items.map(it => ({ item_id: it.item_id, qty: Number(it.qty) }));
    } catch (e) { showToast('加载套餐失败：' + e.message, 'error'); }
  }
  pkgItems = rows;

  editor.innerHTML = `
    <div class="modal-card">
      <div class="modal-header"><h2>${id ? '编辑套餐' : '新建套餐'}</h2></div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group"><label>套餐名称 <span class="req">*</span></label>
            <input class="form-input" id="pkgName" value="${escHtml(name)}" placeholder="例：标准衣柜套餐"></div>
          <div class="form-group"><label>说明</label>
            <input class="form-input" id="pkgDesc" value="${escHtml(desc)}" placeholder="例：含柜体+层板+腿架+连接件"></div>
        </div>
        <div class="section-title" style="margin-top:6px">BOM 明细</div>
        <div id="pkgRows"></div>
        <button class="btn btn-outline btn-sm" onclick="addPkgRow()">+ 添加物料行</button>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('pkgEditor').innerHTML=''">取消</button>
        <button class="btn btn-primary" onclick="savePkgEditor()">💾 保存套餐</button>
      </div>
    </div>`;
  renderPkgRows();
}

function renderPkgRows() {
  const wrap = document.getElementById('pkgRows');
  if (!wrap) return;
  const inv = window.inventoryItems || [];
  const opts = '<option value="">选择物料...</option>' +
    inv.map(i => `<option value="${i.id}" ${i.id === '' ? '' : ''}>${escHtml(i.name)}${i.spec ? '（' + escHtml(i.spec) + '）' : ''}</option>`).join('');
  if (!pkgItems.length) {
    wrap.innerHTML = '<div class="text-light" style="padding:8px 0">暂无物料行，点击下方「添加物料行」。</div>';
    return;
  }
  wrap.innerHTML = pkgItems.map((r, idx) => `
    <div class="pkg-row">
      <select class="form-select" data-idx="${idx}" onchange="onPkgRowItem(this)">${opts.replace(`value="${r.item_id}"`, `value="${r.item_id}" selected`)}</select>
      <input class="form-input" type="number" min="1" value="${r.qty}" data-idx="${idx}" oninput="onPkgRowQty(this)" placeholder="数量" style="max-width:110px">
      <button class="btn btn-danger btn-sm" onclick="removePkgRow(${idx})">✕</button>
    </div>`).join('');
}

function addPkgRow() { pkgItems.push({ item_id: '', qty: 1 }); renderPkgRows(); }
function removePkgRow(idx) { pkgItems.splice(idx, 1); renderPkgRows(); }
function onPkgRowItem(sel) { pkgItems[Number(sel.dataset.idx)].item_id = sel.value; }
function onPkgRowQty(inp) { pkgItems[Number(inp.dataset.idx)].qty = Number(inp.value) || 0; }

async function savePkgEditor() {
  const name = document.getElementById('pkgName').value.trim();
  const desc = document.getElementById('pkgDesc').value.trim();
  if (!name) { showToast('请填写套餐名称', 'warning'); return; }
  const items = pkgItems
    .filter(r => r.item_id)
    .map(r => ({ item_id: r.item_id, qty: Number(r.qty) || 1 }));
  if (!items.length) { showToast('请至少添加一行有效物料', 'warning'); return; }
  try {
    await savePackage({ id: pkgEditId, name, description: desc }, items);
    showToast('✅ 套餐已保存', 'success');
    document.getElementById('pkgEditor').innerHTML = '';
    pkgEditId = null;
    renderPackages();
  } catch (e) {
    showToast('❌ 保存失败：' + e.message, 'error');
  }
}

async function handleDeletePkg(id, name) {
  if (!confirm(`确认删除套餐「${name}」？`)) return;
  try {
    await deletePackage(id, name);
    showToast('🗑️ 已删除套餐', 'warning');
    renderPackages();
  } catch (e) { showToast('❌ 删除失败：' + e.message, 'error'); }
}

// ============================================================
// 盘点
// ============================================================
async function renderStocktake() {
  const root = document.getElementById('stocktakeRoot');
  if (!root) return;
  try {
    if (stId) {
      stItems = await loadStocktakeItems(stId);
    } else {
      stItems = [];
    }
  } catch (e) { return showV2Error(root, e, '盘点'); }

  root.innerHTML = `
    <div class="top-action-row">
      <div class="section-title">📑 库存盘点</div>
      <div class="action-btns">
        ${stId ? '' : '<button class="btn btn-primary btn-sm" onclick="startStocktake()">🟢 开始盘点（生成盘点单）</button>'}
        <button class="btn btn-outline btn-sm" onclick="renderStocktake()">🔄 刷新</button>
      </div>
    </div>
    <div id="stBody"></div>`;

  const body = document.getElementById('stBody');
  if (!stId) {
    body.innerHTML = '<div class="alert-banner" style="display:flex"><span class="alert-icon">📑</span><span>点击「开始盘点」一键生成当前库存盘点单，逐项录入实际数量后过账。</span></div>';
    return;
  }
  if (!stItems.length) {
    body.innerHTML = '<div class="empty-cell">盘点单为空。</div>';
    return;
  }
  body.innerHTML = `
    <div class="table-wrap"><div class="table-scroll"><table>
      <thead><tr>
        <th>物料</th><th>规格</th><th>单位</th><th>系统库存</th><th>实际盘点</th><th>差异</th>
      </tr></thead>
      <tbody>${stItems.map(it => {
        const sys = Number(it.system_qty);
        const act = it.actual_qty != null && it.actual_qty !== '' ? Number(it.actual_qty) : '';
        const diff = act === '' ? '' : (act - sys);
        const diffCls = diff === '' ? '' : (diff === 0 ? 'text-success' : (diff > 0 ? 'text-success' : 'text-danger'));
        return `<tr>
          <td><strong>${escHtml((it.item && it.item.name) || '')}</strong></td>
          <td class="text-light">${escHtml((it.item && it.item.spec) || '-')}</td>
          <td>${escHtml((it.item && it.item.unit) || '-')}</td>
          <td>${sys}</td>
          <td><input class="form-input st-actual" type="number" data-id="${it.item_id}" value="${act}" placeholder="${sys}" style="max-width:120px"></td>
          <td class="${diffCls}">${diff === '' ? '-' : (diff > 0 ? '+' : '') + diff}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>
    <div class="top-action-row" style="margin-top:12px; border:none; padding:0">
      <button class="btn btn-outline" onclick="saveStocktakeProgress()">💾 保存进度</button>
      <button class="btn btn-warning" onclick="postStocktakeNow()">✅ 确认过账（按实际数调整库存）</button>
    </div>`;
}

async function startStocktake() {
  try {
    stId = await generateStocktake();
    showToast('🟢 已生成盘点单', 'success');
    renderStocktake();
  } catch (e) { showToast('❌ 生成盘点单失败：' + e.message, 'error'); }
}

async function saveStocktakeProgress() {
  if (!stId) return;
  const map = {};
  document.querySelectorAll('.st-actual').forEach(inp => {
    map[inp.dataset.id] = inp.value === '' ? '' : Number(inp.value);
  });
  try {
    await saveStocktakeActual(stId, map);
    showToast('💾 盘点进度已保存', 'success');
  } catch (e) { showToast('❌ 保存失败：' + e.message, 'error'); }
}

async function postStocktakeNow() {
  if (!stId) return;
  if (!confirm('确认过账？系统将按实际盘点数量调整库存（差异自动生成调整记录）。')) return;
  try {
    const n = await postStocktake(stId);
    showToast(`✅ 过账完成，调整了 ${n} 种物料`, 'success');
    stId = null;
    try { const inv = await loadInventory(); cacheData(CACHE_KEYS.inventory, inv); window.inventoryItems = inv; } catch (e) {}
    renderStocktake();
    if (typeof refreshDashboard === 'function') refreshDashboard();
  } catch (e) { showToast('❌ 过账失败：' + e.message, 'error'); }
}
