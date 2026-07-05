// ============================================================
// 图纸解析 UI — drawing-ui.js
// 处理文件上传、结果渲染、扣减确认
// ============================================================

let drawingParsedData = null;

// ============================================================
// 文件上传处理
// ============================================================
async function handleDrawingUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('drawingStatus');
  statusEl.style.display = '';
  statusEl.innerHTML = '🔍 正在解析文件：' + file.name + '...';
  statusEl.className = 'upload-status parsing';

  try {
    DrawingParser.currentFileName = file.name;
    const result = await DrawingParser.parseFile(file);

    drawingParsedData = result;

    // 渲染结果
    renderDrawingSummary(result);
    renderDrawingMaterials(result);
    renderDrawingExceptions(result);

    document.getElementById('drawingResults').style.display = '';
    document.getElementById('drawingUploadArea').style.display = 'none';

    statusEl.innerHTML = `✅ 解析完成：识别到 ${result.total} 项物料（${result.matched.length} 项已匹配库存）`;
    statusEl.className = 'upload-status success';

    updateDrawingButtons();
  } catch (err) {
    statusEl.innerHTML = '❌ 解析失败：' + err.message;
    statusEl.className = 'upload-status error';
    showToast('❌ 文件解析失败：' + err.message, 'error');
  }

  event.target.value = '';
}

// ============================================================
// 重新选择文件
// ============================================================
function resetDrawingUpload() {
  drawingParsedData = null;
  document.getElementById('drawingResults').style.display = 'none';
  document.getElementById('drawingUploadArea').style.display = '';
  document.getElementById('drawingStatus').style.display = 'none';
  document.getElementById('drawingDeductionResult').style.display = 'none';
}

// ============================================================
// 渲染摘要卡片
// ============================================================
function renderDrawingSummary(result) {
  const wrap = document.getElementById('drawingSummary');
  const okCount = result.matched.length;
  const failCount = result.exceptions.length;
  const totalQty = result.materials.reduce((s, m) => s + m.quantity, 0);

  wrap.innerHTML = `
    <div class="summary-card">
      <div class="summary-icon">📋</div>
      <div class="summary-info">
        <div class="summary-value">${result.total}</div>
        <div class="summary-label">识别物料项</div>
      </div>
    </div>
    <div class="summary-card green">
      <div class="summary-icon">✅</div>
      <div class="summary-info">
        <div class="summary-value">${okCount}</div>
        <div class="summary-label">库存已匹配</div>
      </div>
    </div>
    <div class="summary-card ${failCount > 0 ? 'red' : 'warn'}">
      <div class="summary-icon">${failCount > 0 ? '⚠️' : '📌'}</div>
      <div class="summary-info">
        <div class="summary-value">${failCount}</div>
        <div class="summary-label">异常项</div>
      </div>
    </div>
    <div class="summary-card money">
      <div class="summary-icon">🔢</div>
      <div class="summary-info">
        <div class="summary-value">${totalQty}</div>
        <div class="summary-label">图纸总用量</div>
      </div>
    </div>
  `;
}

// ============================================================
// 渲染物料清单表格
// ============================================================
function renderDrawingMaterials(result) {
  const tbody = document.getElementById('drawingMaterialsTbody');
  if (!result.materials.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">未识别到任何物料</td></tr>';
    return;
  }

  tbody.innerHTML = result.materials.map((m, i) => {
    const invItem = m.matched_item;
    const statusHtml = renderDrawingStatus(m);
    const matchText = invItem
      ? `<span style="color:#27ae60">✅ ${m.match_type}匹配 (${m.match_score}分)</span>`
      : `<span style="color:#e74c3c">❌ 未匹配</span>`;
    const invQty = invItem ? invItem.quantity : '-';
    const categoryText = m.category
      ? `<span class="cat-tag ${getCatClass(m.category)}">${m.category}</span> <span class="sub-cat-tag">${m.sub_category || '-'}</span>`
      : '<span class="text-light">自动识别中...</span>';

    return `<tr class="${m.status === 'insufficient' ? 'row-warning' : ''} ${m.status === 'unmatched' ? 'row-error' : ''}">
      <td><input type="checkbox" class="drawing-check" data-index="${i}" ${m.status === 'unmatched' ? 'disabled' : 'checked'} onchange="updateDrawingButtons()"></td>
      <td><strong>${escHtml(m.name)}</strong></td>
      <td>${escHtml(m.spec || '-')}</td>
      <td><strong style="color:var(--primary-dark)">${m.quantity}</strong></td>
      <td>${escHtml(m.unit)}</td>
      <td>${categoryText}</td>
      <td>${matchText}</td>
      <td>${invQty}</td>
      <td>${statusHtml}</td>
    </tr>`;
  }).join('');
}

function renderDrawingStatus(m) {
  switch (m.status) {
    case 'ok': return '<span style="color:#27ae60">✅ 可扣减</span>';
    case 'insufficient': return `<span style="color:#e67e22">⚠️ 库存不足（缺${m.shortage}）</span>`;
    case 'unmatched': return '<span style="color:#e74c3c">❌ 无匹配库存</span>';
    default: return '<span class="text-light">-</span>';
  }
}

// ============================================================
// 渲染异常报告
// ============================================================
function renderDrawingExceptions(result) {
  const wrap = document.getElementById('drawingExceptions');
  const tbody = document.getElementById('drawingExceptionsTbody');
  const exceptions = result.exceptions;

  if (!exceptions.length) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = '';
  tbody.innerHTML = exceptions.map(e => `
    <tr>
      <td><strong>${escHtml(e.name)}</strong></td>
      <td>${escHtml(e.spec || '-')}</td>
      <td>${e.quantity}</td>
      <td><span class="action-tag ${e.status === 'insufficient' ? 'action-STOCK_OUT' : 'action-DELETE'}">${e.status === 'insufficient' ? '库存不足' : '未匹配'}</span></td>
      <td>${e.status === 'insufficient' ? `缺 ${e.shortage} ${e.unit}（现有 ${e.matched_item.quantity}）` : '库存数据库中无此物料'}</td>
    </tr>
  `).join('');
}

// ============================================================
// 全选/取消全选
// ============================================================
function toggleDrawingSelectAll(checked) {
  document.querySelectorAll('.drawing-check:not(:disabled)').forEach(cb => {
    cb.checked = checked;
  });
  document.getElementById('drawingSelectAll').checked = checked;
  updateDrawingButtons();
}

function updateDrawingButtons() {
  const checked = document.querySelectorAll('.drawing-check:checked').length;
  const btn = document.getElementById('btnDeductDrawing');
  btn.disabled = checked === 0;
  btn.textContent = checked > 0 ? `🔄 确认扣减选中项（${checked}项）` : '🔄 确认扣减选中项';
}

// ============================================================
// 执行库存扣减
// ============================================================
async function executeDrawingDeduction() {
  if (!drawingParsedData) return;
  if (!canStock()) {
    showToast('❌ 当前权限不足，无法执行扣减操作', 'error');
    return;
  }

  const checks = document.querySelectorAll('.drawing-check:checked');
  if (!checks.length) {
    showToast('请至少选择一项物料', 'warning');
    return;
  }

  const selectedIndices = Array.from(checks).map(cb => parseInt(cb.dataset.index));
  const selectedMaterials = selectedIndices.map(i => drawingParsedData.materials[i]);

  if (!confirm(`确认对 ${selectedMaterials.length} 项物料执行库存扣减？\n\n此操作将更新库存数据并记录日志。`)) return;

  const btn = document.getElementById('btnDeductDrawing');
  btn.disabled = true;
  btn.textContent = '⏳ 扣减中...';

  try {
    const results = await DrawingParser.executeDeduction(selectedMaterials);
    renderDeductionResult(results);

    // 刷新库存页面
    if (typeof renderInventoryTable === 'function') await renderInventoryTable();
    if (typeof refreshDashboard === 'function') await refreshDashboard();

    showToast(`✅ 扣减完成：成功 ${results.success.length} 项，失败 ${results.failed.length} 项`, results.failed.length ? 'warning' : 'success');
  } catch (err) {
    showToast('❌ 扣减失败：' + err.message, 'error');
  }

  btn.disabled = false;
  updateDrawingButtons();
}

function renderDeductionResult(results) {
  const wrap = document.getElementById('drawingDeductionResult');
  const tbody = document.getElementById('drawingDeductionTbody');
  wrap.style.display = '';

  const rows = [];
  results.success.forEach(r => {
    rows.push(`<tr><td>${escHtml(r.name)}</td><td>-${r.deducted}</td><td>${r.remaining}</td><td><span style="color:#27ae60">✅ 已扣减</span></td></tr>`);
  });
  results.failed.forEach(r => {
    rows.push(`<tr><td>${escHtml(r.name)}</td><td>-</td><td>-</td><td><span style="color:#e74c3c">❌ ${escHtml(r.reason)}</span></td></tr>`);
  });
  tbody.innerHTML = rows.join('');
}

// ============================================================
// 拖拽上传支持
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.querySelector('.upload-zone');
  if (!zone) return;

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length) {
      const input = document.getElementById('drawingFileInput');
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      input.files = dt.files;
      handleDrawingUpload({ target: input });
    }
  });
});
