-- ============================================================
-- HMX 第三阶段迁移：v2 重构（三类产品 + 出库套餐 + 盘点）
-- 请在 Supabase Dashboard → SQL Editor 中完整执行本文件
-- ============================================================

-- 1) inventory_items：新增 在制量 / 项目号；旧 category 迁移为三类代码
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS wip_qty INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS project_no TEXT;

COMMENT ON COLUMN inventory_items.wip_qty IS '在制量（仅定制件使用）';
COMMENT ON COLUMN inventory_items.project_no IS '项目号（仅定制件使用，关联订单/项目）';

-- 旧的分类值（原材料/半成品/成品）统一映射为 standard，避免历史数据丢失
UPDATE inventory_items
SET category = 'standard'
WHERE category IS NULL
   OR category NOT IN ('standard', 'custom', 'connector');

CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_inventory_project ON inventory_items(project_no);

-- 2) 套餐 / BOM
CREATE TABLE IF NOT EXISTS packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  item_id    UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_package_items_pkg ON package_items(package_id);

-- 3) 出库单
CREATE TABLE IF NOT EXISTS stock_out (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL DEFAULT 'single',   -- 'package' | 'single'
  package_id UUID REFERENCES packages(id) ON DELETE SET NULL,
  sets       INTEGER,
  operator   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_out_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  out_id       UUID NOT NULL REFERENCES stock_out(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty          INTEGER NOT NULL DEFAULT 1,
  is_custom_add BOOLEAN NOT NULL DEFAULT FALSE  -- 是否为套餐外追加的定制件/额外件
);
CREATE INDEX IF NOT EXISTS idx_stock_out_items_out ON stock_out_items(out_id);

-- 4) 盘点
CREATE TABLE IF NOT EXISTS stocktake (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status     TEXT NOT NULL DEFAULT 'open',        -- 'open' | 'closed'
  operator   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stocktake_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  take_id      UUID NOT NULL REFERENCES stocktake(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  system_qty   INTEGER NOT NULL DEFAULT 0,
  actual_qty   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stocktake_items_take ON stocktake_items(take_id);

-- 5) RLS：沿用现有开放策略（与 inventory_items / stock_records 一致）
ALTER TABLE packages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_out          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_out_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktake          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktake_items    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['packages','package_items','stock_out','stock_out_items','stocktake','stocktake_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "allow_all" ON %I;', t);
    EXECUTE format('CREATE POLICY "allow_all" ON %I FOR ALL USING (true) WITH CHECK (true);', t);
  END LOOP;
END $$;

-- ============================================================
-- 迁移完成 ✅
-- ============================================================
