// ============================================================
// 操作日志模块 - logs.js
// ============================================================

const Logs = {
  // 当前筛选条件
  filter: { action: '', operator: '', dateFrom: '', dateTo: '' },
  page: 1,
  pageSize: 20,
  cache: [],

  // 写入操作日志（核心：所有写操作都应调用此方法）
  async write(action, targetType, targetId, targetName, details) {
    try {
      const operator = (Auth && Auth.getCurrentUser) ? Auth.getCurrentUser() : 'system';
      const payload = {
        id: LocalDB.uid(),
        operator,
        action,
        target_type: targetType,
        target_id: targetId ? String(targetId) : null,
        target_name: targetName || null,
        details: details || {},
        created_at: new Date().toISOString()
      };
      await LocalDB.put('operation_logs', payload);
    } catch (e) {
      console.warn('Logs.write error:', e);
    }
  },

  // 拉取日志（带筛选 + 分页）
  async fetch() {
    const { action, operator, dateFrom, dateTo } = this.filter;
    let rows = await LocalDB.getAll('operation_logs');
    if (action) rows = rows.filter((r) => r.action === action);
    if (operator) rows = rows.filter((r) => (r.operator || '').toLowerCase().includes(operator.toLowerCase()));
    if (dateFrom) rows = rows.filter((r) => (r.created_at || '') >= dateFrom + 'T00:00:00');
    if (dateTo) rows = rows.filter((r) => (r.created_at || '') <= dateTo + 'T23:59:59');
    rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const total = rows.length;
    const from = (this.page - 1) * this.pageSize;
    const paged = rows.slice(from, from + this.pageSize);
    return { rows: paged, total };
  },

  // 拉取全部（用于导出）
  async fetchAll() {
    const { action, operator, dateFrom, dateTo } = this.filter;
    let rows = await LocalDB.getAll('operation_logs');
    if (action) rows = rows.filter((r) => r.action === action);
    if (operator) rows = rows.filter((r) => (r.operator || '').toLowerCase().includes(operator.toLowerCase()));
    if (dateFrom) rows = rows.filter((r) => (r.created_at || '') >= dateFrom + 'T00:00:00');
    if (dateTo) rows = rows.filter((r) => (r.created_at || '') <= dateTo + 'T23:59:59');
    rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return rows;
  },

  // 渲染表格
  async render() {
    const { rows, total } = await this.fetch();
    this.cache = rows;
    this.total = total;
    const tbody = document.getElementById('logsTbody');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">暂无操作日志</td></tr>';
      document.getElementById('logPageInfo').textContent = '共 0 条';
      document.getElementById('logPageBtns').innerHTML = '';
      return;
    }

    const ACTION_MAP = {
      CREATE: '➕ 新增', UPDATE: '✏️ 修改', DELETE: '🗑️ 删除',
      STOCK_IN: '📥 入库', STOCK_OUT: '📤 出库', STOCK_ADJUST: '🔧 调整'
    };

    tbody.innerHTML = rows.map(r => {
      const details = (() => {
        try {
          return JSON.stringify(r.details, null, 2);
        } catch { return ''; }
      })();

      return `
        <tr>
          <td>${formatDateTime(r.created_at)}</td>
          <td><span class="operator-tag">${escapeHtml(r.operator || 'system')}</span></td>
          <td><span class="action-tag action-${r.action}">${ACTION_MAP[r.action] || r.action}</span></td>
          <td>${escapeHtml(r.target_name || '-')}</td>
          <td><div class="log-details">${escapeHtml(details) || '-'}</div></td>
        </tr>
      `;
    }).join('');

    document.getElementById('logPageInfo').textContent = `共 ${this.total} 条`;
    this.renderPageBtns();
  },

  renderPageBtns() {
    const wrap = document.getElementById('logPageBtns');
    if (!wrap) return;
    const total = this.total || 0;
    const prev = this.page > 1
      ? `<button class="page-btn" onclick="Logs.goPage(${this.page - 1})">‹ 上一页</button>`
      : `<button class="page-btn" disabled>‹ 上一页</button>`;
    const next = (this.page * this.pageSize) < total
      ? `<button class="page-btn" onclick="Logs.goPage(${this.page + 1})">下一页 ›</button>`
      : `<button class="page-btn" disabled>下一页 ›</button>`;
    wrap.innerHTML = prev + `<span style="padding:0 8px">第 ${this.page} 页 / 共 ${total} 条</span>` + next;
  },

  goPage(p) {
    this.page = p;
    this.render();
  },

  setFilter() {
    this.filter.action = document.getElementById('logActionFilter')?.value || '';
    this.filter.operator = document.getElementById('logOperatorFilter')?.value || '';
    this.filter.dateFrom = document.getElementById('logDateFrom')?.value || '';
    this.filter.dateTo = document.getElementById('logDateTo')?.value || '';
    this.page = 1;
  },

  clearFilter() {
    const ids = ['logActionFilter', 'logOperatorFilter', 'logDateFrom', 'logDateTo'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    this.filter = { action: '', operator: '', dateFrom: '', dateTo: '' };
    this.page = 1;
    this.render();
  }
};

// 全局函数（HTML inline onclick 调用）
function renderLogs() {
  Logs.setFilter();
  Logs.render();
}
function clearLogFilters() {
  Logs.clearFilter();
}
async function exportLogsExcel() {
  const rows = await Logs.fetchAll();
  if (!rows.length) { showToast('暂无数据可导出', 'warning'); return; }
  const data = rows.map(r => ({
    '时间': formatDateTime(r.created_at),
    '操作人': r.operator,
    '动作': r.action,
    '对象名称': r.target_name || '',
    '对象ID': r.target_id || '',
    '详情': JSON.stringify(r.details || {})
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '操作日志');
  XLSX.writeFile(wb, `操作日志_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('导出成功', 'success');
}
