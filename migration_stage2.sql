-- ============================================================
-- HMX 第二阶段迁移：二级分类
-- 为原材料大类添加 sub_category 字段
-- ============================================================

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS sub_category TEXT;

COMMENT ON COLUMN inventory_items.sub_category IS '二级分类（原材料：螺丝类/铝件类/铁件类/注塑件类等）';

CREATE INDEX IF NOT EXISTS idx_inventory_sub_category ON inventory_items(sub_category);

-- ============================================================
-- 迁移完成 ✅
-- ============================================================
