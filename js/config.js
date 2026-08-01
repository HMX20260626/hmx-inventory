// ============================================================
// 本地存储配置（零费用：数据存于浏览器 IndexedDB，不依赖任何后端）
// 详见 js/localdb.js
// ============================================================

// ============================================================
// 应用配置
// ============================================================
// ============================================================
// 访问码（管理员和编辑者使用不同码解锁权限）
// 可自行修改这些码
// ============================================================
const ACCESS_CODES = {
  admin: 'admin2024',
  editor: 'edit2024',
};

const APP_CONFIG = {
  appName: 'HMX金属家具库存管理系统',
  pageSize: 15,
  roles: {
    admin: { label: '管理员', icon: '🛡️', canEdit: true, canDelete: true, canStock: true, canImport: true },
    editor: { label: '编辑者', icon: '✏️', canEdit: true, canDelete: false, canStock: true, canImport: true },
    viewer: { label: '仅查看', icon: '👁️', canEdit: false, canDelete: false, canStock: false, canImport: false },
  },
};
