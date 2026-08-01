// ============================================================
// GitHub 共享数据同步层
// 以仓库内的 data/shared.json 为"真源"，所有用户读写同一份，
// 改动作防抖提交 + 每 20s 拉取他人改动。零费用、无第三方后端。
// 冲突策略：按 updated_at 较新者优先；删除用 deletedIds 集合标记；
// 清空 store 用 clearedStores 标记以本地为准。
// ============================================================
const Sync = (function () {
  const STORES = LocalDB.STORES.filter((s) => s !== 'meta');
  const LS_DELETED = 'hmx_deleted_ids';
  const LS_CLEARED = 'hmx_cleared_stores';

  let _cfg = null;
  let _status = 'idle';            // idle | syncing | synced | error | offline
  let _statusMsg = '';
  let _pushing = false;
  let _pollTimer = null;
  let _debounceTimer = null;
  let _lastRemoteUpdatedAt = '';
  let _statusCbs = [];

  let _deletedIds = new Set(loadSet(LS_DELETED));
  let _clearedStores = new Set(loadSet(LS_CLEARED));

  function loadSet(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }
  function saveSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
  }
  function cfg() {
    if (!_cfg) _cfg = (window.APP_CONFIG && APP_CONFIG.githubSync) || {};
    return _cfg;
  }
  function enabled() { return !!(cfg().token && cfg().repo && cfg().path); }

  // ---------- GitHub API ----------
  function api(method, path, body) {
    const c = cfg();
    const url = `https://api.github.com/repos/${c.repo}/contents/${encodeURIComponent(c.path)}?ref=${c.branch || 'master'}`;
    const headers = {
      'Authorization': 'Bearer ' + c.token,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'hmx-inventory-sync',
    };
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const op = (method === 'GET' || method === 'DELETE') ? 'GET' : 'PUT';
      xhr.open(op, url, true);
      Object.keys(headers).forEach((h) => xhr.setRequestHeader(h, headers[h]));
      xhr.onload = () => {
        let data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, status: xhr.status, data });
        else if (xhr.status === 404 && method === 'GET') resolve({ ok: false, status: 404, data: null });
        else reject(new Error('GitHub API ' + xhr.status + ': ' + (data && data.message ? data.message : xhr.responseText.slice(0, 200))));
      };
      xhr.onerror = () => reject(new Error('网络错误，无法连接 GitHub'));
      xhr.send(body ? JSON.stringify(body) : undefined);
    });
  }

  function b64encodeUtf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function b64decodeUtf8(str) {
    const bin = atob(str.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  // ---------- 文件读写 ----------
  async function pullRaw() {
    const res = await api('GET');
    if (!res.ok) return { ok: false, sha: null, data: null, updatedAt: null };
    const sha = res.data.sha;
    let data = null, updatedAt = null;
    try {
      const json = JSON.parse(b64decodeUtf8(res.data.content));
      data = json.data || {};
      updatedAt = json.updatedAt || null;
    } catch (e) { data = null; }
    return { ok: true, sha, data, updatedAt };
  }

  async function pushRaw(data, sha) {
    const payload = { version: 2, updatedAt: new Date().toISOString(), data };
    const body = {
      message: 'hmx sync: update shared data ' + new Date().toISOString(),
      content: b64encodeUtf8(JSON.stringify(payload, null, 2)),
      branch: cfg().branch || 'master',
    };
    if (sha) body.sha = sha;
    try {
      const res = await api('PUT', null, body);
      return res;
    } catch (e) {
      if (String(e.message).includes('409')) {
        // 冲突：重新拉取再合并再推一次
        const cur = await pullRaw();
        const local = await readAllLocal();
        const merged = mergeForPush(local, cur.data || {});
        const body2 = {
          message: 'hmx sync: retry update ' + new Date().toISOString(),
          content: b64encodeUtf8(JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), data: merged }, null, 2)),
          branch: cfg().branch || 'master',
          sha: cur.sha,
        };
        return api('PUT', null, body2);
      }
      throw e;
    }
  }

  async function createInitial() {
    const empty = { version: 2, updatedAt: new Date().toISOString(), data: {} };
    STORES.forEach((s) => { empty.data[s] = []; });
    const body = {
      message: 'hmx sync: init shared data',
      content: b64encodeUtf8(JSON.stringify(empty, null, 2)),
      branch: cfg().branch || 'master',
    };
    return api('PUT', null, body);
  }

  // ---------- 本地读写 ----------
  async function readAllLocal() {
    const out = {};
    for (const s of STORES) out[s] = await LocalDB.getAll(s);
    return out;
  }
  async function replaceAllLocal(data) {
    for (const s of STORES) {
      const rows = Array.isArray(data[s]) ? data[s] : [];
      await LocalDB.replaceAll(s, rows);
    }
  }
  function byId(arr) {
    const m = {};
    (arr || []).forEach((r) => { if (r && r.id) m[r.id] = r; });
    return m;
  }

  // ---------- 合并（本地改动叠加到远程真源） ----------
  function mergeForPush(local, remote) {
    const result = {};
    for (const store of STORES) {
      if (_clearedStores.has(store)) {
        // 该 store 被本地清空，以本地为准
        result[store] = (local[store] || []).filter((d) => d && !_deletedIds.has(d.id));
        continue;
      }
      const rm = byId(remote[store]);
      const lm = byId(local[store]);
      const out = [];
      const seen = new Set();
      // 1) 先放入远程条目（未被本地删除的）
      Object.values(rm).forEach((r) => {
        if (_deletedIds.has(r.id)) return; // 本地删了，覆盖远程
        out.push(r); seen.add(r.id);
      });
      // 2) 叠加本地改动
      Object.values(lm).forEach((l) => {
        if (_deletedIds.has(l.id)) return;
        const idx = out.findIndex((x) => x.id === l.id);
        if (idx >= 0) {
          if ((l.updated_at || '') >= (out[idx].updated_at || '')) out[idx] = l;
        } else {
          out.push(l);
        }
      });
      result[store] = out;
    }
    return result;
  }

  // ---------- 状态 ----------
  function setStatus(s, msg) {
    _status = s; if (msg !== undefined) _statusMsg = msg;
    _statusCbs.forEach((cb) => { try { cb(_status, _statusMsg); } catch {} });
  }
  function onStatus(cb) { if (typeof cb === 'function') _statusCbs.push(cb); }
  function getStatus() { return { status: _status, msg: _statusMsg }; }

  // ---------- 推送（防抖） ----------
  function schedulePush() {
    if (!enabled()) return;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { doPush().catch((e) => console.warn('sync push failed', e)); }, 1200);
  }
  async function doPush() {
    if (_pushing) return;
    _pushing = true;
    setStatus('syncing', '同步中…');
    try {
      const cur = await pullRaw();
      const local = await readAllLocal();
      const merged = mergeForPush(local, cur.data || {});
      await pushRaw(merged, cur.sha);
      _lastRemoteUpdatedAt = new Date().toISOString();
      // 推送成功后，已清空的 store 已上传，移除标记
      if (_clearedStores.size) { _clearedStores.clear(); saveSet(LS_CLEARED, _clearedStores); }
      setStatus('synced', '已同步');
    } catch (e) {
      console.warn('Sync push error:', e);
      if (String(e.message).includes('网络')) setStatus('offline', '离线（本地已保存）');
      else setStatus('error', '同步失败：' + e.message.slice(0, 40));
    } finally {
      _pushing = false;
    }
  }

  // ---------- 拉取（轮询 / 手动） ----------
  async function pullAndApply(force) {
    if (!enabled()) return;
    try {
      const cur = await pullRaw();
      if (!cur.ok) { setStatus('offline', '无共享文件'); return; }
      if (!force && cur.updatedAt && cur.updatedAt === _lastRemoteUpdatedAt) {
        setStatus(_status === 'error' ? 'error' : 'synced', '已同步');
        return;
      }
      await replaceAllLocal(cur.data || {});
      _lastRemoteUpdatedAt = cur.updatedAt || new Date().toISOString();
      if (typeof handleRealtimeChange === 'function') handleRealtimeChange('*');
      setStatus('synced', '已同步');
    } catch (e) {
      console.warn('Sync pull error:', e);
      if (String(e.message).includes('网络')) setStatus('offline', '离线（本地已保存）');
      else setStatus('error', '拉取失败：' + e.message.slice(0, 40));
    }
  }

  function syncNow() { return pullAndApply(true); }

  function startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => { pullAndApply(false).catch(() => {}); }, 20000);
  }

  // ---------- 删除标记（供 db.js 调用） ----------
  function markDeleted(ids) {
    (Array.isArray(ids) ? ids : [ids]).forEach((id) => { if (id) _deletedIds.add(id); });
    saveSet(LS_DELETED, _deletedIds);
  }
  function markCleared(store) {
    _clearedStores.add(store);
    saveSet(LS_CLEARED, _clearedStores);
  }

  // ---------- 初始化 ----------
  async function init() {
    if (!enabled()) { setStatus('offline', '未启用同步'); return; }
    setStatus('syncing', '连接共享数据…');
    try {
      const cur = await pullRaw();
      if (cur.ok) {
        await replaceAllLocal(cur.data || {});
        _lastRemoteUpdatedAt = cur.updatedAt || '';
        if (typeof handleRealtimeChange === 'function') handleRealtimeChange('*');
        setStatus('synced', '已同步');
      } else {
        // 文件不存在，创建初始空文件
        await createInitial();
        _lastRemoteUpdatedAt = new Date().toISOString();
        setStatus('synced', '已同步（新建）');
      }
    } catch (e) {
      console.warn('Sync init error:', e);
      if (String(e.message).includes('网络')) setStatus('offline', '离线（本地已保存）');
      else setStatus('error', '初始化失败：' + e.message.slice(0, 40));
    }
    startPolling();
  }

  return {
    init, schedulePush, syncNow, onStatus, getStatus,
    markDeleted, markCleared, enabled,
  };
})();
