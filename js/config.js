// ============================================================
// Supabase 配置
// 请在 Supabase 项目设置中获取你的 URL 和 anon key
// ============================================================
const SUPABASE_CONFIG = {
  url: 'https://udxvcyroqwslkphckyvb.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkeHZjeXJvcXdzbGtwaGNreXZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NTk4MjcsImV4cCI6MjA5ODUzNTgyN30.Wz74I9Uwjh-PY-geoAiHqYZZX9gznDaXZTz1la87rJw',
};

const supabaseClient = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

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
