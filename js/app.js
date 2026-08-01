// ============================================================
// App 初始化（免登录模式）
// ============================================================

// 注册 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(() => {
      console.log('SW registered');
    }).catch(e => console.warn('SW registration failed:', e));
  });
}

// 页面加载完成后直接初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 时间
  updateTime();
  setInterval(updateTime, 1000);

  // 从 sessionStorage 恢复角色（默认 viewer）
  initAuth();

  // 直接进入应用
  hideLoginScreen();
  updateHeaderUser();
  updateRoleUI();

  // 加载数据并订阅实时更新
  await refreshDashboard();
  subscribeToRealtime();

  // 启动 GitHub 共享数据同步（多用户真同步）
  if (typeof Sync !== 'undefined') {
    Sync.onStatus((status, msg) => {
      const badge = document.getElementById('syncBadge');
      if (badge) {
        badge.className = 'sync-badge sync-' + status;
        badge.textContent = '● ' + (msg || status);
      }
    });
    Sync.init();
  }
});
