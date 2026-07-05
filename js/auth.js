// ============================================================
// 访问码权限系统
// 默认仅查看 → 输入访问码 → 升级为编辑者或管理员
// 权限保存在 sessionStorage（关浏览器后自动退回 viewer）
// ============================================================

const ROLE_KEY = 'inv_role';
const CODE_KEY = 'inv_code';

let currentUser = null;
let currentUserRole = 'viewer';
let currentUserDisplayName = '访客';

// ============================================================
// 初始化 — 从 sessionStorage 恢复角色
// ============================================================
function initAuth() {
  const savedRole = sessionStorage.getItem(ROLE_KEY);
  const savedCode = sessionStorage.getItem(CODE_KEY);
  if (savedRole && verifyCode(savedRole, savedCode)) {
    currentUserRole = savedRole;
    currentUserDisplayName = APP_CONFIG.roles[savedRole].label;
  }
  updateHeaderUser();
}

function verifyCode(role, code) {
  if (!ACCESS_CODES[role]) return false;
  return code === ACCESS_CODES[role];
}

// ============================================================
// 显示/隐藏（兼容旧接口）
// ============================================================
function showLoginScreen() {}
function hideLoginScreen() {
  document.getElementById('appContainer').classList.add('logged-in');
  if (typeof refreshDashboard === 'function') refreshDashboard();
  if (typeof renderInventoryTable === 'function') renderInventoryTable();
  if (typeof renderAlertBanner === 'function') renderAlertBanner();
}

// ============================================================
// Header 用户显示（角色徽章可点击）
// ============================================================
function updateHeaderUser() {
  const roleConfig = APP_CONFIG.roles[currentUserRole];
  const el = document.getElementById('headerUser');
  el.innerHTML = `<span>${roleConfig.icon} ${roleConfig.label}</span>
    <span class="role-badge role-${currentUserRole}" onclick="showAccessCodeDialog()" title="点击切换权限">⚙️</span>`;
  el.style.cursor = 'default';
  el.querySelector('.role-badge').style.cursor = 'pointer';
}

// ============================================================
// 访问码弹窗
// ============================================================
function showAccessCodeDialog() {
  const dlg = document.getElementById('accessDialog');
  document.getElementById('accessCodeInput').value = '';
  document.getElementById('accessError').textContent = '';
  dlg.classList.add('show');
  setTimeout(() => document.getElementById('accessCodeInput').focus(), 100);
}

function closeAccessDialog() {
  document.getElementById('accessDialog').classList.remove('show');
}

function handleAccessSubmit() {
  const code = document.getElementById('accessCodeInput').value.trim();
  const errorEl = document.getElementById('accessError');

  if (!code) {
    errorEl.textContent = '请输入访问码';
    return;
  }

  // 尝试匹配角色
  let matchedRole = null;
  for (const [role, validCode] of Object.entries(ACCESS_CODES)) {
    if (code === validCode) {
      matchedRole = role;
      break;
    }
  }

  if (!matchedRole) {
    errorEl.textContent = '❌ 访问码错误，请重试';
    return;
  }

  // 升级角色
  currentUserRole = matchedRole;
  currentUserDisplayName = APP_CONFIG.roles[matchedRole].label;
  sessionStorage.setItem(ROLE_KEY, matchedRole);
  sessionStorage.setItem(CODE_KEY, code);

  updateHeaderUser();
  updateRoleUI();
  closeAccessDialog();

  // 刷新当前页面
  const roleConfig = APP_CONFIG.roles[matchedRole];
  showToast(`🔓 已切换为「${roleConfig.label}」权限`, 'success');
  if (typeof renderInventoryTable === 'function') renderInventoryTable();
}

// ============================================================
// 退出 → 回到 viewer
// ============================================================
function downgradeToViewer() {
  sessionStorage.removeItem(ROLE_KEY);
  sessionStorage.removeItem(CODE_KEY);
  currentUserRole = 'viewer';
  currentUserDisplayName = '访客';
  updateHeaderUser();
  updateRoleUI();
  if (typeof renderInventoryTable === 'function') renderInventoryTable();
  showToast('已退出权限模式，当前为仅查看', 'warning');
}

// ============================================================
// 角色 UI 控制
// ============================================================
function updateRoleUI() {
  const roleConfig = APP_CONFIG.roles[currentUserRole];

  toggleBtns('[data-role="edit"]', roleConfig.canEdit);
  toggleBtns('[data-role="delete"]', roleConfig.canDelete);
  toggleBtns('[data-role="stock"]', roleConfig.canStock);
  toggleBtns('[data-role="import"]', roleConfig.canImport);

  toggleEl('btnAdd', roleConfig.canEdit);
  toggleEl('btnImport', roleConfig.canImport);
  toggleEl('btnExport', roleConfig.canImport);
  toggleEl('btnClearRecords', roleConfig.canDelete);

  if (roleConfig.canEdit || roleConfig.canDelete || roleConfig.canStock) {
    document.getElementById('actionColHeader').style.display = '';
  } else {
    document.getElementById('actionColHeader').style.display = 'none';
  }
  document.querySelectorAll('.action-cell').forEach(el => {
    el.style.display = (roleConfig.canEdit || roleConfig.canDelete || roleConfig.canStock) ? '' : 'none';
  });

  // 权限：viewer 只能看库存总览
  const isViewerOnly = (currentUserRole === 'viewer');
  const restrictedTabs = ['nav-inventory', 'nav-purchase', 'nav-records', 'nav-logs', 'nav-drawing'];
  restrictedTabs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isViewerOnly ? 'none' : '';
  });
  // 如果当前在受限页面但角色是 viewer, 自动跳回库存总览
  if (isViewerOnly) {
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab && activeTab.id !== 'tab-dashboard') {
      switchTab('dashboard');
    }
  }
}

function toggleBtns(selector, show) {
  document.querySelectorAll(selector).forEach(el => el.style.display = show ? '' : 'none');
}

function toggleEl(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? '' : 'none';
}

// ============================================================
// 权限检查函数
// ============================================================
function canEdit() { return APP_CONFIG.roles[currentUserRole].canEdit; }
function canDelete() { return APP_CONFIG.roles[currentUserRole].canDelete; }
function canStock() { return APP_CONFIG.roles[currentUserRole].canStock; }
function canImport() { return APP_CONFIG.roles[currentUserRole].canImport; }

// ============================================================
// Auth 命名空间（给操作日志使用）
// ============================================================
const Auth = {
  getCurrentUser() {
    // 优先返回角色标识作为操作人
    return currentUserDisplayName || 'viewer';
  },
  getRole() { return currentUserRole; }
};
