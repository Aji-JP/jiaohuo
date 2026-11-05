// 計算邏輯的單元測試：只需要 Node.js（18 以上），不用安裝任何套件。
//   node --test test/core.test.js
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { PAGES, read, section, loadCore, plain, ymd } = require('./helpers');

// vm 裡回傳的陣列原型不同，一律先 plain() 再比對
const texts = (r) => plain(r.lines.map((l) => l.text));
const line = (r, name) => plain(r.lines.filter((l) => l.name === name).map((l) => l.text));

test('三個頁面的共用計算邏輯（LOGIC 區塊）一字不差', () => {
  const blocks = PAGES.map((p) => section(read(p.file), '/*LOGIC-START*/', '/*CORE-END*/'));
  for (let i = 1; i < blocks.length; i++) {
    assert.equal(blocks[i], blocks[0], `${PAGES[i].file} 和 ${PAGES[0].file} 的 LOGIC 區塊不同，請同步修改`);
  }
});

test('index.html 和 v2.html 的丙級資料（題組、規則、排序）相同', () => {
  const data = (f) => section(read(f), '/*CORE-START*/', '/*LOGIC-START*/');
  assert.equal(data('index.html'), data('v2.html'));
});

for (const p of PAGES) {
  describe(`${p.file}：通用檢查`, () => {
    const C = loadCore(p.file);
    const IDS = Object.keys(C.RAW);
    beforeEach(() => C.setS(C.cleanState(null)));

    test('APP 標記正確', () => assert.equal(C.APP, p.app));

    test('每個題組的材料都解析得出名稱和大於 0 的每份數量', () => {
      for (const id of IDS) {
        const st = C.parseSet(C.RAW[id]);
        assert.ok(st.i.length > 0, `${id} 沒有材料`);
        for (const it of st.i) {
          assert.ok(it.n && !/\s/.test(it.n), `${id} 有材料名稱是空的或含空白：${JSON.stringify(it)}`);
          assert.ok(it.q > 0, `${id} 的「${it.n}」每份數量不是正數：${it.q}`);
        }
      }
    });

    test('所有題組 × 1～30 份都算得出來，訊息裡不會出現 NaN、undefined 或 0 份', () => {
      for (const id of IDS) {
        for (let n = 1; n <= 30; n++) {
          const r = C.compute([{ time: '上午', kind: '操作', set: id, n }]);
          assert.ok(r.lines.length > 0);
          for (const l of r.lines) {
            assert.doesNotMatch(l.text + l.hint, /NaN|undefined|Infinity/, `${id}×${n}：${l.text}／${l.hint}`);
            assert.doesNotMatch(l.text, /✖️0(?![.\d])/, `${id}×${n} 叫了 0：${l.text}`);
          }
        }
      }
    });

    test('上午加下午一起算，不會比分開算少', () => {
      // 抽查：同一題組上午 3 份＋下午 4 份，合計應該和一次 7 份完全一樣
      for (const id of IDS) {
        const a = C.compute([{ time: '上午', kind: '操作', set: id, n: 3 }, { time: '下午', kind: '操作', set: id, n: 4 }]);
        const b = C.compute([{ time: '上午', kind: '操作', set: id, n: 7 }]);
        assert.deepEqual(texts(a), texts(b), id);
      }
    });

    test('沒選題組、未知題組、份數亂填都不會當掉，也不會算進去', () => {
      const id = IDS[0];
      const bad = [null, undefined, {}, { set: '999-9', n: 5 }, { set: id, n: 'abc' }, { set: id, n: -3 }, { set: id, n: 0 }, { set: '__proto__', n: 5 }];
      const r = C.compute(bad);
      assert.equal(r.lines.length, 0);
      assert.equal(r.pantry.length, 0);
      assert.deepEqual(plain(C.detail(bad)), []);
      assert.deepEqual(plain(C.getSet('不存在')), { d: [], i: [], p: '' });
    });

    test('份數是字串或小數時，照整數算（不會變成字串相接）', () => {
      const id = IDS[0];
      const want = texts(C.compute([{ set: id, n: 5 }]));
      assert.deepEqual(texts(C.compute([{ set: id, n: '5' }])), want);
      assert.deepEqual(texts(C.compute([{ set: id, n: 5.7 }])), want);
      assert.deepEqual(texts(C.compute([{ set: id, n: '3' }, { set: id, n: '2' }])), want);
    });

    test('配菜表裡的材料叫 constructor、__proto__、toString 也不會當掉', () => {
      const id = IDS[0];
      const S = C.getS();
      S.sets[id] = { d: [], i: ['constructor', '__proto__', 'toString', 'hasOwnProperty'].map((n) => ({ n, q: 2, u: '個' })), p: '' };
      const r = C.compute([{ set: id, n: 3 }]);
      assert.deepEqual(texts(r), ['constructor✖️6個', '__proto__✖️6個', 'toString✖️6個', 'hasOwnProperty✖️6個']);
      assert.doesNotThrow(() => C.allNames());
    });

    test('配菜表被改壞（材料不是陣列）時，退回原本的題組資料', () => {
      const id = IDS[0];
      const want = texts(C.compute([{ set: id, n: 5 }]));
      C.getS().sets[id] = { i: 'x' };
      assert.deepEqual(texts(C.compute([{ set: id, n: 5 }])), want);
    });

    test('frac：常見分數顯示正確，接近整數時不會變成 2/2', () => {
      const cases = [[0.5, '1/2'], [0.25, '1/4'], [0.75, '3/4'], [1, '1'], [3, '3'], [0.16667, '1/6'], [0.33333, '1/3'],
        [0.2, '1/5'], [0.125, '1/8'], [0.1, '1/10'], [1.25, '1又1/4'], [0.9995, '1'], [1.9991, '2'], [0.123, '0.12']];
      for (const [q, want] of cases) assert.equal(C.frac(q), want, `frac(${q})`);
    });

    test('sched：一般情況是上課前一天入貨、前兩天叫貨', () => {
      const s = C.sched('2026-11-05'); // 週四
      assert.equal(ymd(s.del), '2026-11-04');
      assert.equal(ymd(s.ord), '2026-11-03');
      assert.deepEqual(plain(s.why), []);
      assert.equal(s.askSun, false);
    });

    test('sched：週二上課，週一不入貨→週日；週日沒課→週六', () => {
      const s = C.sched('2026-11-10');
      assert.equal(ymd(s.del), '2026-11-07');
      assert.equal(ymd(s.ord), '2026-11-06');
      assert.deepEqual(plain(s.why), ['週一不入貨，提前到週日入貨', '週日沒課，再提前到週六入貨']);
      assert.equal(s.askSun, true);
      const t = C.sched('2026-11-10', true);
      assert.equal(ymd(t.del), '2026-11-08');
      assert.equal(ymd(t.ord), '2026-11-07');
      assert.deepEqual(plain(t.why), ['週一不入貨，提前到週日入貨']);
    });

    test('sched：週一上課，週日沒課就週六入貨（說明不會寫「再提前」）', () => {
      const s = C.sched('2026-11-09');
      assert.equal(ymd(s.del), '2026-11-07');
      assert.deepEqual(plain(s.why), ['週日沒課，提前到週六入貨']);
      assert.equal(s.askSun, true);
      assert.equal(ymd(C.sched('2026-11-09', true).del), '2026-11-08');
    });

    test('sched：跨月、跨年、閏年', () => {
      assert.equal(ymd(C.sched('2027-01-01').del), '2026-12-31');
      assert.equal(ymd(C.sched('2027-01-01').ord), '2026-12-30');
      assert.equal(ymd(C.sched('2028-03-01').del), '2028-02-29');
      assert.ok(C.sched('2028-02-29'));
    });

    test('sched：不存在或格式錯的日期一律回傳 null', () => {
      for (const v of ['', null, undefined, 123, 'abc', '2026-02-30', '2027-02-29', '2026-13-01', '2026-1-5', '2026-11-05T00:00', '"><img>']) {
        assert.equal(C.sched(v), null, String(v));
      }
    });

    test('message：LINE 訊息格式', () => {
      const d = C.sched('2026-11-05').del;
      assert.equal(C.message(d, '中正', ['A✖️1', 'B✖️2'], '上午'), '11/4 上午. 入中正材料如下：\n1. A✖️1\n2. B✖️2\n非常感謝🙏');
      assert.equal(C.message(null, '仁武', ['A'], ''), '入仁武材料如下：\n1. A\n非常感謝🙏');
    });

    test('detail：上午在前、示範在操作前', () => {
      const [a, b] = IDS;
      const d = C.detail([{ time: '下午', kind: '操作', set: b, n: 6 }, { time: '上午', kind: '操作', set: a, n: 5 }, { time: '上午', kind: '示範', set: b, n: 1 }]);
      assert.deepEqual(plain(d.map((x) => x.title)), [`上午　示範　${b} ×1`, `上午　操作　${a} ×5`, `下午　操作　${b} ×6`]);
    });

    test('自訂規則：不合理的數字（負數、0、文字）會退回預設', () => {
      const S = C.getS();
      S.rules['測試'] = { t: 'pack', per: -5 };
      S.sets[IDS[0]] = { d: [], i: [{ n: '測試', q: 1, u: '個' }], p: '' };
      assert.deepEqual(line(C.compute([{ set: IDS[0], n: 3 }]), '測試'), ['測試✖️3個']);
      S.rules['測試'] = { t: 'jin', g: 'abc' };
      assert.deepEqual(line(C.compute([{ set: IDS[0], n: 3 }]), '測試'), ['測試✖️半斤']);
      S.rules['測試'] = { t: '亂寫' };
      assert.equal(C.rule('測試').t, 'sum');
    });

    test('cleanState：空的或亂掉的資料會變回預設值', () => {
      const def = plain(C.cleanState(null));
      assert.deepEqual(def, { place: '中正', head: 'del', rules: {}, sets: {}, hist: [], dirty: false, draft: null });
      for (const v of [undefined, 5, 'x', [], { rules: 'abc', sets: [1, 2], hist: 'x', head: 'evil', place: {} }]) {
        assert.deepEqual(plain(C.cleanState(v)), def, JSON.stringify(v));
      }
    });

    test('cleanState：__proto__ 不會汙染物件原型', () => {
      const v = JSON.parse('{"__proto__":{"polluted":1},"rules":{"__proto__":{"t":"jin"},"蔥":{"t":"sum"}}}');
      const s = C.cleanState(v);
      assert.equal(s.polluted, undefined);
      assert.equal(s.rules.polluted, undefined);
      assert.deepEqual(plain(Object.keys(s.rules)), ['蔥']);
      assert.equal(({}).polluted, undefined);
    });

    test('cleanState：規則只留合法欄位', () => {
      const s = C.cleanState({ rules: {
        A: { t: 'pack', per: -5, u: '包', c: 's', x: 1 },
        B: { t: 'sum', min: 0 },
        C: { t: '亂寫', g: '20', r: 'down', a: 'C'.repeat(100) },
        D: 'x',
        E: {},
      } });
      assert.deepEqual(plain(s.rules), {
        A: { t: 'pack', u: '包', c: 's' },
        B: { t: 'sum', min: 0 },
        C: { g: 20, a: 'C'.repeat(40) },
      });
    });

    test('cleanState：配菜表只留本頁有的題組，欄位型別會修正，菜名一律用內建的', () => {
      const id = IDS[0];
      const s = C.cleanState({ sets: {
        [id]: { d: ['<b>'], i: [{ n: ' 蔥 ', q: 'abc', u: 5 }, 'x', { n: '薑', q: '80', u: 'g' }], p: ['x'] },
        '999-9': { i: [] },
        [IDS[1]]: { i: 'x' },
      } });
      assert.deepEqual(plain(Object.keys(s.sets)), [id]);
      assert.deepEqual(plain(s.sets[id]), { d: plain(C.parseSet(C.RAW[id]).d), i: [{ n: '蔥', q: 0, u: '5' }, { n: '薑', q: 80, u: 'g' }], p: '' });
    });

    test('cleanState：紀錄和草稿裡的課程資料會被清理（防止塞入 HTML）', () => {
      const X = '"><img src=x onerror=alert(1)>';
      const id = IDS[0];
      const s = C.cleanState({ hist: [
        { t: 1, text: 'ok', ses: X, title: X, draft: { days: [{ date: X, sun: 'yes', ses: [{ time: X, kind: X, set: id, n: X }, { set: '999-9', n: '7' }] }], ed: { k: { text: X, base: 1, on: 'x', st: 'bad' } }, man: { k: [{ text: X }, 'x'] }, mode: X, place: X } },
        { text: 5 },
        null,
      ] });
      assert.equal(s.hist.length, 1);
      const d = plain(s.hist[0].draft);
      assert.deepEqual(d.days, [{ date: '', sun: false, ses: [{ time: '上午', kind: '操作', set: id, n: 0 }, { time: '上午', kind: '操作', set: '', n: 7 }] }]);
      assert.deepEqual(d.ed, { k: { text: X, base: '1' } });
      assert.deepEqual(d.man, { k: [{ text: X, on: true }] });
      assert.equal(d.mode, 'all');
    });

    test('cleanState：正常的資料原封不動保留', () => {
      const id = IDS[0];
      const v = {
        place: '中正', head: 'cls', dirty: true,
        rules: { 蔥: { t: 'jin', g: 25, r: 'up', a: '青蔥' } },
        sets: { [id]: { d: plain(C.parseSet(C.RAW[id]).d), i: [{ n: '蔥', q: 2, u: '支' }], p: '白醋' } },
        hist: [{ t: 123, title: 't', ses: 's', text: 'msg', draft: { days: [{ date: '2026-11-10', sun: true, ses: [{ time: '下午', kind: '示範', set: id, n: 1 }] }], ed: { '2026-11-08|all|蔥': { text: '蔥✖️1斤', base: '蔥✖️半斤', on: false }, 'x|all|蛋': { st: 'order' } }, man: { '2026-11-08': [{ text: '白木耳✖️1斤', on: false }] }, mode: 'pm', place: '仁武' } }],
        draft: { days: [{ date: '2026-11-12', sun: false, ses: [] }], ed: {}, man: {}, mode: 'am', place: '中正' },
      };
      assert.deepEqual(plain(C.cleanState(v)), v);
    });

    test('foreignBackup：分辨是不是另一個級別的備份', () => {
      const other = p.app === 'bing' ? 'yi' : 'bing';
      const otherId = p.app === 'bing' ? '201-A' : '301-1';
      assert.equal(C.foreignBackup({ app: other }), true);
      assert.equal(C.foreignBackup({ app: p.app }), false);
      assert.equal(C.foreignBackup({}), false);
      assert.equal(C.foreignBackup({ hist: [{ text: 'x' }] }), false);
      assert.equal(C.foreignBackup({ sets: { [otherId]: { i: [] } } }), true);
      assert.equal(C.foreignBackup({ hist: [{ text: 'x', draft: { days: [{ ses: [{ set: otherId }] }] } }] }), true);
      assert.equal(C.foreignBackup({ sets: { [otherId]: {}, [IDS[0]]: {} } }), false);
    });
  });
}

describe('丙級（v2.html）叫貨量', () => {
  const C = loadCore('v2.html');
  beforeEach(() => C.setS(C.cleanState(null)));
  const run = (...ses) => C.compute(ses.map(([set, n, time]) => ({ set, n, time: time || '上午', kind: '操作' })));

  test('301-1 × 5 份：各種叫法', () => {
    const r = run(['301-1', 5]);
    assert.deepEqual(texts(r), [
      '大里肌130g✖️5', '豬絞肉✖️150g', '鱸魚✖️5', '紅K✖️5', '紅辣椒✖️半斤', '小黃瓜✖️5', '大黃瓜✖️1',
      '蔥✖️半斤', '薑✖️半斤', '蒜✖️半斤', '蝦米✖️半斤', '冬菜✖️50g', '洋蔥✖️2', '青椒✖️5', '四季豆✖️750g',
    ]);
    assert.deepEqual(plain(r.lines.filter((l) => l.stock).map((l) => l.name)), ['蝦米', '冬菜']);
    assert.deepEqual(plain(r.pantry), ['番茄醬', '烏醋', '白醋', '地瓜粉']);
    assert.equal(r.lines.find((l) => l.name === '薑').hint, '需 400g（0.67斤）');
  });

  test('雞胸依每份規格分開列', () => {
    assert.deepEqual(line(run(['301-2', 5], ['302-4', 1]), '雞胸'), ['G胸1/2✖️5', 'G胸1副✖️1']);
  });

  test('整包：西芹每包 10 支', () => {
    assert.deepEqual(line(run(['301-4', 5]), '西芹'), ['西芹✖️1包']);
    assert.deepEqual(line(run(['301-4', 11]), '西芹'), ['西芹✖️2包']);
  });

  test('最少量：四季豆至少 150g', () => {
    assert.deepEqual(line(run(['301-9', 1]), '四季豆'), ['四季豆✖️150g']);
    assert.deepEqual(line(run(['301-9', 6]), '四季豆'), ['四季豆✖️180g']);
  });

  test('換算成斤：長糯米、紅辣椒無條件進位', () => {
    assert.deepEqual(line(run(['301-5', 5]), '長糯米'), ['長糯米✖️1.5斤']);
    // 紅辣椒每條約 30g：10 條＝300g 剛好半斤；11 條＝330g 進位成 1 斤；21 條＝630g 進位成 1.5 斤
    assert.deepEqual(line(run(['301-1', 10]), '紅辣椒'), ['紅辣椒✖️半斤']);
    assert.deepEqual(line(run(['301-1', 11]), '紅辣椒'), ['紅辣椒✖️1斤']);
    assert.deepEqual(line(run(['301-1', 21]), '紅辣椒'), ['紅辣椒✖️1.5斤']);
  });

  test('固定寫法與庫存品', () => {
    const r = run(['302-4', 5], ['302-3', 5]);
    assert.deepEqual(line(r, '九層塔'), ['九層塔✖️30元']);
    assert.deepEqual(line(r, '鹹蛋黃'), ['鹹蛋黃✖️1份(20顆)']);
    assert.equal(r.lines.find((l) => l.name === '鹹蛋黃').stock, true);
  });

  test('上午＋下午加總後才進位', () => {
    assert.deepEqual(line(run(['301-1', 5, '上午'], ['301-2', 5, '下午']), '洋蔥'), ['洋蔥✖️3']);
  });

  test('改規則：西芹改成每包 5 支', () => {
    C.getS().rules['西芹'] = { per: 5 };
    assert.deepEqual(line(run(['301-4', 6]), '西芹'), ['西芹✖️2包']);
  });
});

describe('乙級（yiji.html）叫貨量', () => {
  const C = loadCore('yiji.html');
  beforeEach(() => C.setS(C.cleanState(null)));
  const run = (...ses) => C.compute(ses.map(([set, n]) => ({ set, n, time: '上午', kind: '操作' })));

  test('1/6 個 × 6 份＝剛好 1 個，不會多叫（0.16667 進位錯誤的回歸測試）', () => {
    assert.deepEqual(line(run(['202-B', 6]), '高麗菜'), ['高麗菜✖️1']);
    assert.deepEqual(line(run(['202-B', 12]), '高麗菜'), ['高麗菜✖️2']);
    assert.deepEqual(line(run(['202-B', 7]), '高麗菜'), ['高麗菜✖️2']);
    assert.deepEqual(line(run(['203-A', 6]), '洋蔥'), ['洋蔥✖️1']);
    assert.deepEqual(line(run(['203-A', 3]), '沙拉醬'), ['沙拉醬✖️1條']);
  });

  test('照 201 配菜表的順序排列', () => {
    assert.deepEqual(texts(run(['201-A', 5])).slice(0, 5), ['牛後腿肉250g✖️5', '黃魚✖️5', '水發魷魚✖️5', '小黃瓜✖️15', '芥菜心✖️5']);
  });

  test('大黃瓜每份 0.2 條', () => {
    assert.deepEqual(line(run(['201-A', 5]), '大黃瓜'), ['大黃瓜✖️1']);
    assert.deepEqual(line(run(['201-A', 6]), '大黃瓜'), ['大黃瓜✖️2']);
  });

  test('明細用分數顯示每份用量', () => {
    const rows = C.detail([{ time: '上午', kind: '操作', set: '202-B', n: 6 }])[0].rows;
    assert.equal(rows.find((r) => r.n === '高麗菜').per, '1/6個');
    assert.equal(rows.find((r) => r.n === '高麗菜').tot, '1個');
    const rows2 = C.detail([{ time: '上午', kind: '操作', set: '203-B', n: 2 }])[0].rows;
    assert.equal(rows2.find((r) => r.n === '桶筍').per, '1又1/4支');
  });
});
