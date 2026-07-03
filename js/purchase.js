// ============================================================
// 采购建议模块 - purchase.js
// ============================================================

const Purchase = {
  page: 1,
  pageSize: 20,
  cache: [],

  // 计算建议采购量
  // 规则：
  //  1. 当前库存 <= 预警值 才进入采购建议
  //  2. 建议采购量 = max(最小订货量, 预警值×2 - 当前库存) + 安全余量
  //  3. 紧急程度 = 缺口比例
  calculateSuggestion(item) {
    const qty = Number(item.quantity || 0);
    const alert = Number(item.alert_qty || 0);
    const minOrder = Number(item.min_order_qty || 0);
    const price = Number(item.price || 0);

    if (alert <= 0 || qty > alert) return null;  // 不需要采购

    const gap = alert - qty;
    // 推荐量：至少达到 minOrder，否则补到 alert 的 1.5 倍
    const baseQty = Math.max(minOrder, Math.ceil(alert * 1.5));
    const suggestQty = Math.max(baseQty, gap + Math.ceil(alert * 0.5));

    let urgency = 'low';
    if (qty === 0) urgency = 'high';
    else if (qty < alert * 0.5) urgency = 'high';
    else if (qty < alert * 0.8) urgency = 'mid';

    return {
      ...item,
      suggest_qty: suggestQty,
      suggest_amount: suggestQty * price,
      gap,
      urgency
    };
  },

  // 渲染表格
  async render() {
    if (!window.inventoryItems) {
      // 兜底：从 UI 模块拉取
      await refreshDashboard();
    }
    const all = (window.inventoryItems || []).map(it => this.calculateSuggestion(it)).filter(Boolean);
    this.cache = all;

    // 排序：紧急 > 中等 > 普通，按缺口比例倒序
    const order = { high: 0, mid: 1, low: 2 };
    all.sort((a, b) => {
      if (order[a.urgency] !== order[b.urgency]) return order[a.urgency] - order[b.urgency];
      return (b.gap / (b.alert_qty || 1)) - (a.gap / (a.alert_qty || 1));
    });

    // 分页
    const start = (this.page - 1) * this.pageSize;
    const pageRows = all.slice(start, start + this.pageSize);

    // 渲染摘要
    this.renderSummary(all);
    // 渲染表格
    this.renderTable(pageRows);
    // 渲染分页
    document.getElementById('purchasePageInfo').textContent = `共 ${all.length} 条`;
    this.renderPageBtns(all.length);
  },

  renderSummary(all) {
    const wrap = document.getElementById('purchaseSummary');
    if (!wrap) return;
    const totalQty = all.reduce((s, r) => s + r.suggest_qty, 0);
    const totalAmount = all.reduce((s, r) => s + r.suggest_amount, 0);
    const urgentCount = all.filter(r => r.urgency === 'high').length;
    const supplierSet = new Set(all.map(r => r.supplier).filter(Boolean));

    wrap.innerHTML = `
      <div class="summary-card urgent">
        <div class="summary-icon">🔥</div>
        <div class="summary-info">
          <div class="summary-value">${urgentCount}</div>
          <div class="summary-label">紧急采购项</div>
        </div>
      </div>
      <div class="summary-card warn">
        <div class="summary-icon">📦</div>
        <div class="summary-info">
          <div class="summary-value">${all.length}</div>
          <div class="summary-label">需采购品类</div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-icon">🔢</div>
        <div class="summary-info">
          <div class="summary-value">${totalQty}</div>
          <div class="summary-label">建议采购总量</div>
        </div>
      </div>
      <div class="summary-card money">
        <div class="summary-icon">💰</div>
        <div class="summary-info">
          <div class="summary-value">¥${formatMoney(totalAmount)}</div>
          <div class="summary-label">预计采购金额</div>
        </div>
      </div>
    `;
  },

  renderTable(rows) {
    const tbody = document.getElementById('purchaseTbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="12">🎉 暂无需要采购的物品，库存充足！</td></tr>';
      return;
    }
    const URGENCY_MAP = { high: '<span class="urgency urgency-high">🔥 紧急</span>',
                          mid:  '<span class="urgency urgency-mid">⚠️ 中等</span>',
                          low:  '<span class="urgency urgency-low">📌 普通</span>' };

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><span class="cat-tag cat-${catClass(r.category)}">${escapeHtml(r.category)}</span></td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td>${escapeHtml(r.spec || '-')}</td>
        <td>${escapeHtml(r.unit || '-')}</td>
        <td class="${Number(r.quantity) <= Number(r.alert_qty) ? 'qty-low' : ''}">${r.quantity}</td>
        <td>${r.alert_qty}</td>
        <td>${r.min_order_qty || 0}</td>
        <td><strong style="color:var(--primary-dark)">${r.suggest_qty}</strong></td>
        <td>¥${formatMoney(r.price)}</td>
        <td><strong>¥${formatMoney(r.suggest_amount)}</strong></td>
        <td>${escapeHtml(r.supplier || '-')}</td>
        <td>${URGENCY_MAP[r.urgency]}</td>
      </tr>
    `).join('');
  },

  renderPageBtns(total) {
    const wrap = document.getElementById('purchasePageBtns');
    if (!wrap) return;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    const prev = this.page > 1
      ? `<button class="page-btn" onclick="Purchase.goPage(${this.page - 1})">‹ 上一页</button>`
      : `<button class="page-btn" disabled>‹ 上一页</button>`;
    const next = this.page < totalPages
      ? `<button class="page-btn" onclick="Purchase.goPage(${this.page + 1})">下一页 ›</button>`
      : `<button class="page-btn" disabled>下一页 ›</button>`;
    wrap.innerHTML = prev + `<span style="padding:0 8px">第 ${this.page} / ${totalPages} 页</span>` + next;
  },

  goPage(p) { this.page = p; this.render(); }
};

// 工具函数
function renderPurchaseTable() { Purchase.render(); }
async function exportPurchaseExcel() {
  if (!Purchase.cache.length) {
    await Purchase.render();
  }
  if (!Purchase.cache.length) { showToast('暂无需要采购的物品', 'warning'); return; }
  const data = Purchase.cache.map(r => ({
    '分类': r.category,
    '品名': r.name,
    '规格': r.spec || '',
    '单位': r.unit || '',
    '当前库存': r.quantity,
    '预警值': r.alert_qty,
    '最小订货量': r.min_order_qty || 0,
    '建议采购量': r.suggest_qty,
    '单价(元)': r.price,
    '预计金额(元)': r.suggest_amount,
    '供应商': r.supplier || '',
    '紧急程度': ({ high: '紧急', mid: '中等', low: '普通' })[r.urgency]
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '采购建议');
  XLSX.writeFile(wb, `采购建议_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('采购建议已导出', 'success');
}
