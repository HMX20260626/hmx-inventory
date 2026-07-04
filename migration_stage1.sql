-- ============================================================
-- HMX金属家具库存管理系统 - 第一阶段基础增强
-- 数据库迁移脚本（兼容现有 alert_threshold 字段，不重命名）
-- 适用：Supabase / PostgreSQL
-- ============================================================

-- --------------------------------------------------------
-- 1. inventory_items 表新增字段
-- --------------------------------------------------------

-- 批次号（用于追踪不同批次的物料）
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS batch_no TEXT;

-- 有效期（适用于有保质期的材料，如：油漆、胶水等）
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- 最小订货量（低于预警值后建议采购的最小数量）
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS min_order_qty NUMERIC DEFAULT 0;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_inventory_batch_no ON inventory_items(batch_no);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry_date ON inventory_items(expiry_date);

-- 字段注释
COMMENT ON COLUMN inventory_items.batch_no IS '批次号';
COMMENT ON COLUMN inventory_items.expiry_date IS '有效期';
COMMENT ON COLUMN inventory_items.min_order_qty IS '最小订货量（采购建议参考）';


-- --------------------------------------------------------
-- 2. 新增表：operation_logs（操作日志）
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS operation_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  operator TEXT DEFAULT 'system' NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  target_name TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_op_logs_created_at ON operation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_logs_operator ON operation_logs(operator);
CREATE INDEX IF NOT EXISTS idx_op_logs_action ON operation_logs(action);

COMMENT ON TABLE operation_logs IS '操作日志表：记录所有增删改和出入库操作';


-- --------------------------------------------------------
-- 3. 启用 Realtime（让操作日志支持实时订阅）
-- --------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE operation_logs;


-- --------------------------------------------------------
-- 4. 配置 RLS 权限（让前端能读写操作日志）
-- --------------------------------------------------------
ALTER TABLE operation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read logs" ON operation_logs;
CREATE POLICY "Allow public read logs" ON operation_logs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert logs" ON operation_logs;
CREATE POLICY "Allow public insert logs" ON operation_logs
  FOR INSERT WITH CHECK (true);


-- ============================================================
-- 迁移完成 ✅
-- 验证：
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'inventory_items' ORDER BY ordinal_position;
--   SELECT * FROM operation_logs LIMIT 5;
-- ============================================================
