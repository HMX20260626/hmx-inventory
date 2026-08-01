// ============================================================
// 本地数据层 — IndexedDB 封装（替代 Supabase，零费用、纯前端）
// 暴露全局对象 LocalDB，供 db.js / logs.js 调用
// ============================================================
const LocalDB = (function () {
  const DB_NAME = 'hmx_inventory_db';
  const DB_VERSION = 1;
  const STORES = [
    'inventory_items', 'stock_records', 'operation_logs',
    'packages', 'package_items', 'stock_out', 'stock_out_items',
    'stocktake', 'stocktake_items', 'meta'
  ];

  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        STORES.forEach((s) => {
          if (!db.objectStoreNames.contains(s)) {
            const os = db.createObjectStore(s, { keyPath: 'id' });
            if (s === 'package_items') os.createIndex('package_id', 'package_id', { unique: false });
            if (s === 'stock_out_items') os.createIndex('out_id', 'out_id', { unique: false });
            if (s === 'stocktake_items') os.createIndex('take_id', 'take_id', { unique: false });
            if (s === 'stock_records') os.createIndex('created_at', 'created_at', { unique: false });
            if (s === 'operation_logs') os.createIndex('created_at', 'created_at', { unique: false });
            if (s === 'inventory_items') os.createIndex('category', 'category', { unique: false });
          }
        });
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function reqPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getAll(store) {
    return open().then((db) => reqPromise(db.transaction(store, 'readonly').objectStore(store).getAll()));
  }

  function get(store, id) {
    return open().then((db) => reqPromise(db.transaction(store, 'readonly').objectStore(store).get(id)));
  }

  function put(store, obj) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      t.objectStore(store).put(obj);
      t.oncomplete = () => resolve(obj);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function del(store, id) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      t.objectStore(store).delete(id);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    }));
  }

  function clear(store) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      t.objectStore(store).clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    }));
  }

  function bulkPut(store, objs) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      (objs || []).forEach((o) => os.put(o));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    }));
  }

  function replaceAll(store, objs) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      os.clear();
      (objs || []).forEach((o) => os.put(o));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    }));
  }

  function queryByIndex(store, indexName, value) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readonly');
      const idx = t.objectStore(store).index(indexName);
      const r = idx.getAll(value);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function deleteByIndex(store, indexName, value) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const idx = t.objectStore(store).index(indexName);
      const req = idx.openCursor(value);
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { cur.delete(); cur.continue(); }
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    }));
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  return {
    open, getAll, get, put, del, clear, bulkPut, replaceAll,
    queryByIndex, deleteByIndex, uid, DB_NAME, STORES
  };
})();
