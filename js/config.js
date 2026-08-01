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
  // ============================================================
  // GitHub 共享数据同步（零费用真同步，多用户共享同一份库存）
  // 所有用户的改动会提交到仓库的 data/shared.json，并每 20s 拉取他人改动。
  // ⚠️ 安全提示：此 token 会出现在前端源码中，任何人打开页面都能看到。
  //    强烈建议到 GitHub → Settings → Developer settings → Fine-grained PAT，
  //    新建一个「仅限 hmx20260626/hmx-inventory 仓库、仅 Contents 读写」的 token 替换下方值。
  // ============================================================
  githubSync: {
    enabled: true,
    repo: 'hmx20260626/hmx-inventory',
    branch: 'master',
    path: 'data/shared.json',
    // ⚠️ 出于安全，token 不写进仓库源码（GitHub 会拦截含密钥的提交）。
    // 请在本页右上角点「⚙️ 配置同步」填入一个「仅限 hmx20260626/hmx-inventory 仓库、Contents 读写」的 token，
    // 它会保存在你本机浏览器（localStorage），不随代码公开。
    token: '',
  },
};
