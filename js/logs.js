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
        operator,
        action,
        target_type: targetType,
        target_id: targetId ? String(targetId) : null,
        target_name: targetName || null,
        details: details || {},
        created_at: new Date().toISOString()
      };
      const { error } = await supabaseClient.from('operation_logs').insert(payload);
      if (error) console.warn('写入操作日志失败：', error);
    } catch (e) {
      console.warn('Logs.write error:', e);
    }
  },

  // 拉取日志（带筛选 + 分页）
  async fetch() {
    const { action, operator, dateFrom, dateTo } = this.filter;
    let q = supabaseClient
      .from('operation_logs')
      .select('*')
      .order('created_at', { ascending: false });

    if (action) q = q.eq('action', action);
    if (operator) q = q.ilike('operator', `%${operator}%`);
    if (dateFrom) q = q.gte('created_at', dateFrom + 'T00:00:00');
    if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59');

    const from = (this.page - 1) * this.pageSize;
    const to = from + this.pageSize - 1;
    q = q.range(from, to);

    const { data, error, count } = await q;
    if (error) {
      console.error('拉取日志失败：', error);
      return { rows: [], total: 0 };
    }
    // count 由后端返回（依赖 PostgREST 的 exact count 头），这里降级为本次返回长度
    return { rows: data || [], total: (data || []).length === this.pageSize ? from + data.length + 1 : from + (data || []).length };
  },

  // 拉取全部（用于导出）
  async fetchAll() {
    const { action, operator, dateFrom, dateTo } = this.filter;
    let q = supabaseClient
      .from('operation_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (action) q = q.eq('action', action);
    if (operator) q = q.ilike('operator', `%${operator}%`);
    if (dateFrom) q = q.gte('created_at', dateFrom + 'T00:00:00');
    if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59');

    const { data, error } = await q;
    if (error) return [];
    return data || [];
  },

  // 渲染表格
  async render() {
    const { rows } = await this.fetch();
    this.cache = rows;
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

    document.getElementById('logPageInfo').textContent = `共 ${rows.length} 条（本页）`;
    this.renderPageBtns(rows.length);
  },

  renderPageBtns(currentCount) {
    const wrap = document.getElementById('logPageBtns');
    if (!wrap) return;
    // 简化版：上一页/下一页（没有总数就只能这样）
    const prev = this.page > 1
      ? `<button class="page-btn" onclick="Logs.goPage(${this.page - 1})">‹ 上一页</button>`
      : `<button class="page-btn" disabled>‹ 上一页</button>`;
    const next = currentCount === this.pageSize
      ? `<button class="page-btn" onclick="Logs.goPage(${this.page + 1})">下一页 ›</button>`
      : `<button class="page-btn" disabled>下一页 ›</button>`;
    wrap.innerHTML = prev + `<span style="padding:0 8px">第 ${this.page} 页</span>` + next;
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
