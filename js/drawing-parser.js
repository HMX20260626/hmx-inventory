// ============================================================
// 图纸解析引擎 — drawing-parser.js
// 核心：从CAD/PDF/Excel中识别物料，匹配库存，执行扣减
// ============================================================

const DrawingParser = {
  // 解析结果
  materials: [],       // 解析出的物料列表
  matched: [],         // 匹配成功的
  unmatched: [],       // 匹配失败的（异常）
  insufficient: [],    // 库存不足的（异常）
  inventoryCache: null, // 库存快照

  // ============================================================
  // 物料识别正则库（基于常见CAD导出格式）
  // ============================================================
  PATTERNS: [
    // 模式1: 序号|名称|规格|数量|单位|备注 (最常见的BOM格式)
    {
      name: 'BOM表格竖线分隔',
      regex: /(\d+)\s*[|\s]\s*([\u4e00-\u9fa5a-zA-Z0-9\-\+\.\#×x\(\)（）\s]{2,40})\s*[|\s]\s*([\u4e00-\u9fa5a-zA-Z0-9\-\+\.\#×x\(\)（）\s]{0,30})\s*[|\s]\s*(\d+)\s*[|\s]\s*([\u4e00-\u9fa5a-zA-Z]{0,6})/g,
      groups: { name: 2, spec: 3, qty: 4, unit: 5 }
    },
    // 模式2: 物名称 + 空格 + 数量
    {
      name: '物料-数量对',
      regex: /([\u4e00-\u9fa5a-zA-Z0-9\-\+\.]{2,30})\s+(\d+)\s*(件|个|套|张|根|米|m|支|组|台|kg|KG|mm)?/g,
      groups: { name: 1, qty: 2, unit: 3 }
    },
    // 模式3: 数量 + 单位 + 名称（如：2件 螺丝M6x20）
    {
      name: '数量-单位-名称',
      regex: /(\d+)\s*(件|个|套|张|根|米|支|组|台|kg|KG)\s+([\u4e00-\u9fa5a-zA-Z0-9\-\+\.\#×x\(\)（）]{2,40})/g,
      groups: { name: 3, qty: 1, unit: 2 }
    },
    // 模式4: 规格×数量（如：M6x20×50件）
    {
      name: '规格x数量',
      regex: /([\u4e00-\u9fa5a-zA-Z0-9\-\+\.#]{2,40})\s*[×xX]\s*(\d+)\s*(件|个|套|张|根)?/g,
      groups: { name: 1, qty: 2, unit: 3 }
    },
    // 模式5: CAD表格行（空格对齐格式）
    {
      name: '对齐表格行',
      regex: /^[\s]*(\d+)[\s]+([\u4e00-\u9fa5a-zA-Z0-9\-\+\.\#×x\(\)（）\/]{3,30})[\s]{2,}(\d+)[\s]*([\u4e00-\u9fa5a-zA-Z]{0,6})/gm,
      groups: { name: 2, qty: 3, unit: 4 }
    }
  ],

  // 分类关键词
  CATEGORY_RULES: [
    { cat: '螺丝类', keys: ['螺丝', '螺栓', '螺钉', '螺柱', '螺母', '垫圈', '弹垫', '平垫', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'] },
    { cat: '铝件类', keys: ['铝', '合金', 'AL', 'Al', '型材', '铝板', '铝管'] },
    { cat: '铁件类', keys: ['铁', '钢', '铁板', '钢板', '角铁', '方管', '圆管', '铁管', '钢管', '镀锌', '不锈钢', 'SPCC', 'SECC', 'Q235', '45#'] },
    { cat: '注塑件类', keys: ['塑料', '注塑', '塑胶', 'ABS', 'PP', 'PE', 'PC', 'PA', 'POM', '尼龙', '亚克力', '有机玻璃'] },
    { cat: '其他原材料', keys: [] }
  ],

  // ============================================================
  // 主入口：解析文件
  // ============================================================
  async parseFile(file) {
    this.materials = [];
    this.matched = [];
    this.unmatched = [];
    this.insufficient = [];
    this.inventoryCache = null;

    const ext = file.name.split('.').pop().toLowerCase();
    let rawText = '';

    try {
      if (ext === 'dwg') {
        rawText = await this.parseDWG(file);
      } else if (ext === 'dxf') {
        rawText = await this.parseDXF(file);
      } else if (ext === 'pdf') {
        rawText = await this.parsePDF(file);
      } else if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
        rawText = await this.parseSpreadsheet(file);
      } else {
        throw new Error('不支持的文件格式：' + ext + '（支持 DWG/DXF/PDF/CSV/XLSX）');
      }

      // 提取物料
      this.extractMaterials(rawText);
      // 去重合并
      this.mergeDuplicates();
      // 分类
      this.classifyMaterials();
      // 匹配库存
      await this.matchInventory();
    } catch (err) {
      console.error('解析失败:', err);
      throw err;
    }

    return {
      total: this.materials.length,
      matched: this.matched.length,
      unmatched: this.unmatched.length,
      insufficient: this.insufficient.length,
      materials: this.materials,
      exceptions: [...this.unmatched, ...this.insufficient]
    };
  },

  // ============================================================
  // DWG 解析：从二进制中提取可读文本
  // ============================================================
  async parseDWG(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // 提取所有可读字符串（连续ASCII或GBK双字节）
    let text = '';
    let current = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];

      // ASCII 可打印字符 32-126
      if (b >= 32 && b <= 126) {
        current += String.fromCharCode(b);
        continue;
      }
      // GBK 汉字（双字节）：高字节 0x81-0xFE
      if (b >= 0x81 && b <= 0xFE && i + 1 < bytes.length) {
        const b2 = bytes[i + 1];
        if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFE)) {
          // 尝试解码
          try {
            const gbkBytes = new Uint8Array([b, b2]);
            const decoder = new TextDecoder('gbk');
            current += decoder.decode(gbkBytes);
            i++; // skip next byte
            continue;
          } catch (e) { /* ignore */ }
        }
      }

      // 字节序列结束
      if (current.length > 0) {
        if (current.length >= 4) text += current + '\n';
        current = '';
      }
    }
    if (current.length >= 4) text += current + '\n';

    console.log(`[DWG] 提取到 ${text.length.toLocaleString()} 字符`);
    return text;
  },

  // ============================================================
  // DXF 解析（文本格式，直接读取）
  // ============================================================
  async parseDXF(file) {
    const text = await file.text();
    return text;
  },

  // ============================================================
  // PDF 解析（使用 pdf.js CDN）
  // ============================================================
  async parsePDF(file) {
    if (typeof pdfjsLib === 'undefined') {
      // 动态加载 pdf.js
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs';
        script.type = 'module';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
  },

  // ============================================================
  // Excel/CSV 解析
  // ============================================================
  async parseSpreadsheet(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          let text = '';
          wb.SheetNames.forEach(name => {
            const ws = wb.Sheets[name];
            text += XLSX.utils.sheet_to_csv(ws) + '\n';
          });
          resolve(text);
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  },

  // ============================================================
  // 从文本中提取物料信息
  // ============================================================
  extractMaterials(rawText) {
    const materials = [];
    const seen = new Set();

    // 清理文本：去掉明显不是物料行的内容
    const lines = rawText.split('\n').filter(line => {
      const trimmed = line.trim();
      // 跳过太短、太长、全是数字的
      if (trimmed.length < 5 || trimmed.length > 500) return false;
      // 跳过纯符号
      if (/^[=\-_\*\.\s\|]{3,}$/.test(trimmed)) return false;
      return true;
    });

    const joinedText = lines.join('\n');

    // 尝试各种模式
    for (const pattern of this.PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(joinedText)) !== null) {
        const groups = pattern.groups;
        const name = (match[groups.name] || '').trim();
        const qty = parseInt(match[groups.qty]) || 0;
        const spec = (match[groups.spec] || '').trim();
        const unit = (match[groups.unit] || '').trim() || '件';

        // 过滤：名称至少2个字符，数量 > 0，不是纯数字名称
        if (name.length < 2 || qty <= 0 || /^\d+$/.test(name)) continue;
        // 过滤常见非物料文本
        if (/^(序号|编号|代码|图号|材料|Material|Item|No|Qty|数量|名称|Description|规格|备注|合计|总计|共|第|页|技术|要求|说明)/i.test(name)) continue;

        const key = `${name}|${spec}`;
        if (seen.has(key)) continue;
        seen.add(key);

        materials.push({
          name,
          spec,
          quantity: qty,
          unit,
          category: '',
          sub_category: '',
          source_line: match[0].substring(0, 80),
          source_pattern: pattern.name
        });
      }
    }

    // 追加：对没有被上面匹配到的行做宽松匹配
    if (materials.length === 0) {
      for (const line of lines) {
        const m = line.match(/([\u4e00-\u9fa5a-zA-Z0-9\-\+\.\#×x\/]{3,30})\s{2,}(\d+)/);
        if (m) {
          const name = m[1].trim();
          const qty = parseInt(m[2]);
          if (name.length >= 2 && qty > 0) {
            const key = name;
            if (!seen.has(key)) {
              seen.add(key);
              materials.push({ name, spec: '', quantity: qty, unit: '件', category: '', sub_category: '', source_line: line.substring(0, 80), source_pattern: '宽松匹配' });
            }
          }
        }
      }
    }

    this.materials = materials;
    console.log(`[提取] 识别到 ${materials.length} 项物料`);
  },

  // ============================================================
  // 去重合并（同名+同规格的合并数量）
  // ============================================================
  mergeDuplicates() {
    const merged = {};
    for (const m of this.materials) {
      const key = `${m.name}|||${m.spec}`;
      if (merged[key]) {
        merged[key].quantity += m.quantity;
        merged[key].sources = (merged[key].sources || 1) + 1;
      } else {
        merged[key] = { ...m, sources: 1 };
      }
    }
    this.materials = Object.values(merged);
  },

  // ============================================================
  // 自动分类（基于关键词）
  // ============================================================
  classifyMaterials() {
    this.materials.forEach(m => {
      const text = (m.name + ' ' + m.spec).toLowerCase();
      let found = false;
      for (const rule of this.CATEGORY_RULES) {
        if (rule.keys.length === 0) continue;
        if (rule.keys.some(k => text.includes(k.toLowerCase()))) {
          m.category = '原材料';
          m.sub_category = rule.cat;
          found = true;
          break;
        }
      }
      if (!found && /[\u4e00-\u9fa5]/.test(m.name)) {
        m.category = '原材料';
        m.sub_category = '其他原材料';
      }
    });
  },

  // ============================================================
  // 匹配库存数据库
  // ============================================================
  async matchInventory() {
    // 获取当前库存
    if (!this.inventoryCache) {
      try {
        this.inventoryCache = await loadInventory();
      } catch (e) {
        this.inventoryCache = [];
      }
    }

    this.matched = [];
    this.unmatched = [];
    this.insufficient = [];

    for (const m of this.materials) {
      // 精确匹配：名称完全一致
      let invMatch = this.inventoryCache.find(i => i.name === m.name);
      // 模糊匹配：名称包含
      if (!invMatch) {
        invMatch = this.inventoryCache.find(i =>
          i.name.includes(m.name) || m.name.includes(i.name)
        );
      }
      // 规格辅助匹配
      if (!invMatch && m.spec) {
        invMatch = this.inventoryCache.find(i =>
          (i.spec || '').includes(m.spec) || m.spec.includes(i.spec || '')
        );
      }

      if (invMatch) {
        m.matched_item = invMatch;
        m.match_type = m.name === invMatch.name ? '精确' : '模糊';
        m.match_score = this.scoreMatch(m, invMatch);

        if (invMatch.quantity < m.quantity) {
          m.status = 'insufficient';
          m.shortage = m.quantity - invMatch.quantity;
          this.insufficient.push(m);
        } else {
          m.status = 'ok';
          this.matched.push(m);
        }
      } else {
        m.status = 'unmatched';
        m.match_type = '无匹配';
        m.match_score = 0;
        this.unmatched.push(m);
      }
    }
  },

  scoreMatch(material, inventory) {
    let score = 0;
    if (material.name === inventory.name) score += 50;
    if (material.name.includes(inventory.name) || inventory.name.includes(material.name)) score += 30;
    if (material.spec && inventory.spec && (material.spec.includes(inventory.spec) || inventory.spec.includes(material.spec))) score += 20;
    return score;
  },

  // ============================================================
  // 执行库存扣减
  // ============================================================
  async executeDeduction(selectedMaterials) {
    const results = { success: [], failed: [], totalDeducted: 0 };

    for (const m of selectedMaterials) {
      try {
        if (!m.matched_item) {
          results.failed.push({ name: m.name, reason: '库存中无匹配项' });
          continue;
        }

        const invItem = m.matched_item;
        const newQty = invItem.quantity - m.quantity;
        if (newQty < 0) {
          results.failed.push({ name: m.name, reason: `库存不足（需求：${m.quantity}，库存：${invItem.quantity}）` });
          continue;
        }

        // 更新库存
        const itemData = {
          id: invItem.id,
          category: invItem.category,
          sub_category: invItem.sub_category,
          name: invItem.name,
          spec: invItem.spec || '',
          unit: invItem.unit || '',
          quantity: newQty,
          unit_price: invItem.unit_price,
          alert_qty: invItem.alert_qty || 0,
          min_order_qty: invItem.min_order_qty || 0,
          batch_no: invItem.batch_no || '',
          expiry_date: invItem.expiry_date || '',
          supplier: invItem.supplier || '',
          location: invItem.location || '',
          remark: invItem.remark || ''
        };

        await saveItem(itemData);

        // 写操作日志
        const action = `从图纸【${this.currentFileName || '未知'}】扣减`;
        await Logs.write('STOCK_ADJUST', 'ITEM', invItem.id, invItem.name, {
          action: '图纸扣减',
          from: invItem.quantity,
          to: newQty,
          delta: -m.quantity,
          drawing_file: this.currentFileName || '',
          source: 'CAD图纸自动解析'
        });

        results.totalDeducted += m.quantity;
        results.success.push({
          name: m.name,
          deducted: m.quantity,
          remaining: newQty
        });

        // 更新缓存
        invItem.quantity = newQty;
        m.deducted = true;
      } catch (err) {
        results.failed.push({ name: m.name, reason: err.message });
      }
    }

    // 刷新缓存
    try {
      this.inventoryCache = await loadInventory();
      window.inventoryItems = this.inventoryCache;
    } catch (e) { /* ignore */ }

    return results;
  },

  // ============================================================
  // 快照 / 撤销机制
  // ============================================================
  _snapshot: null,

  // 保存当前解析状态快照（用于撤销）
  saveSnapshot() {
    this._snapshot = {
      timestamp: new Date().toISOString(),
      fileName: this.currentFileName || null,
      materials: JSON.parse(JSON.stringify(this.materials)),
      matched: JSON.parse(JSON.stringify(this.matched)),
      unmatched: JSON.parse(JSON.stringify(this.unmatched)),
      insufficient: JSON.parse(JSON.stringify(this.insufficient)),
      inventoryCache: this.inventoryCache ? JSON.parse(JSON.stringify(this.inventoryCache)) : null
    };
    console.log('[快照] 已保存解析状态快照');
    return this._snapshot;
  },

  // 恢复到快照状态
  restoreSnapshot() {
    if (!this._snapshot) {
      console.warn('[快照] 无可用快照');
      return false;
    }
    const snap = this._snapshot;
    this.materials = JSON.parse(JSON.stringify(snap.materials));
    this.matched = JSON.parse(JSON.stringify(snap.matched));
    this.unmatched = JSON.parse(JSON.stringify(snap.unmatched));
    this.insufficient = JSON.parse(JSON.stringify(snap.insufficient));
    this.currentFileName = snap.fileName;
    if (snap.inventoryCache) {
      this.inventoryCache = JSON.parse(JSON.stringify(snap.inventoryCache));
    }
    console.log('[快照] 已恢复到快照状态');
    return true;
  },

  // 清除快照并重置所有状态
  clearAll() {
    this._snapshot = null;
    this.materials = [];
    this.matched = [];
    this.unmatched = [];
    this.insufficient = [];
    this.currentFileName = null;
    console.log('[解析器] 已清除所有状态');
  }
};

// 暴露到全局
window.DrawingParser = DrawingParser;
