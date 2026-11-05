// 畫面測試：用 Playwright 的 Chromium 直接開 HTML 檔操作。
//   npm install && npx playwright install chromium && node --test test/ui.test.js
// 沒裝 playwright 時會略過（設 REQUIRE_UI=1 則改成失敗，CI 用）。
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { ROOT, PAGES } = require('./helpers');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* 沒安裝 */ }
if (!chromium && process.env.REQUIRE_UI === '1') throw new Error('REQUIRE_UI=1 但找不到 playwright，請先 npm install');
const SKIP = chromium ? false : '沒有安裝 playwright，略過畫面測試（npm install 後再跑）';

const X = '"><img src=x onerror="window.__xss=(window.__xss||0)+1">';
const otherApp = (app) => (app === 'bing' ? 'yi' : 'bing');

let browser;
before(async () => { if (chromium) browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); });

// 開一個乾淨的分頁；storage 可預先塞 localStorage；剪貼簿 API 一律模擬成失敗，改由 execCommand 備援複製，複製內容記在 window.__copied
async function open(p, { storage } = {}) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(([key, val]) => {
    if (val != null) localStorage.setItem(key, val);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    document.execCommand = (cmd) => {
      if (cmd !== 'copy') return false;
      const a = document.activeElement;
      window.__copied = a && typeof a.value === 'string' ? a.value.slice(a.selectionStart, a.selectionEnd) : String(getSelection());
      return true;
    };
  }, [p.key, storage == null ? null : storage]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(pathToFileURL(path.join(ROOT, p.file)).href);
  page.errors = errors;
  page.close2 = () => ctx.close();
  return page;
}

// 直接設值並觸發事件（比 fill 穩定，date／number 欄位也適用）
const setVal = (loc, v) => loc.evaluate((el, v) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
const tab = (page, name) => page.click(`nav button[data-tab="${name}"]`);
const firstSet = (page) => page.evaluate(() => Object.keys(RAW)[0]);
const msgOf = (page, p) => (p.v2 ? page.locator('textarea[data-msg]').first().inputValue() : page.locator('#out').inputValue());
const toastText = (page, p) => page.locator(p.v2 ? '#toast' : '#toast2').textContent();
const sesSel = (p) => (p.v2 ? '#days .ses' : '#ses .ses');

async function pickSet(page, p, row, id, n) {
  const r = page.locator(sesSel(p)).nth(row);
  await r.locator('select[data-k=set]').selectOption(id);
  if (n != null) await setVal(page.locator(sesSel(p)).nth(row).locator('input[data-k=n]'), String(n));
}

async function restore(page, obj) {
  await tab(page, 'hist');
  await setVal(page.locator('#bk'), typeof obj === 'string' ? obj : JSON.stringify(obj));
  await page.click('#bkIn');
}

for (const p of PAGES) {
  describe(`${p.file}：畫面`, { skip: SKIP }, () => {
    test('開頁沒有錯誤；選題組後產生 LINE 訊息', async () => {
      const page = await open(p);
      const id = await firstSet(page);
      await pickSet(page, p, 0, id, 5);
      const msg = await msgOf(page, p);
      assert.match(msg, /材料如下：\n1\. /);
      assert.match(msg, /非常感謝🙏$/);
      assert.deepEqual(page.errors, []);
      await page.close2();
    });

    test('份數輸入小數或負數會變成 0 以上的整數', async () => {
      const page = await open(p);
      const n = page.locator(sesSel(p)).first().locator('input[data-k=n]');
      await setVal(n, '2.7');
      assert.equal(await page.locator(sesSel(p)).first().locator('input[data-k=n]').inputValue(), '2');
      await setVal(page.locator(sesSel(p)).first().locator('input[data-k=n]'), '-4');
      assert.equal(await page.locator(sesSel(p)).first().locator('input[data-k=n]').inputValue(), '0');
      await page.close2();
    });

    test('還原惡意備份不會執行裡面的 HTML／程式（XSS）', async () => {
      const page = await open(p);
      const id = await firstSet(page);
      const payload = {
        app: p.app, head: X, place: X,
        rules: { 蔥: { t: 'jin', a: X, u: X, f: X }, [X]: { t: 'pack', u: X } },
        sets: { [id]: { d: [X], i: [{ n: X, q: X, u: X }, { n: '蔥', q: 1, u: X }], p: X } },
        hist: [{ t: 1, title: X, date: X, ses: X, text: X, draft: {
          days: [{ date: X, sun: true, ses: [{ time: X, kind: X, set: id, n: X }] }],
          ed: { [X]: { text: X, base: X } }, man: { [X]: [{ text: X, on: true }] }, mode: X, place: X,
        } }],
      };
      await restore(page, payload);
      if (p.v2) await page.click('#hist [data-ld]');
      for (const t of ['rules', 'sets', 'hist', 'order']) await tab(page, t);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      assert.equal(await page.locator('#hist img, #rules img, #items img, #days img, #ses img').count(), 0);
      assert.deepEqual(page.errors, []);
      await page.close2();
    });

    test('格式壞掉的備份、壞掉的 localStorage 都不會讓頁面當掉', async () => {
      const id = p.app === 'bing' ? '301-1' : '201-A';
      const broken = JSON.stringify({ rules: null, sets: { [id]: { i: 'x' } }, hist: [null, { text: 5 }, 'x'], head: 7,
        draft: { days: [{ ses: [{ set: id, n: '5' }, null] }], ed: null, man: 'x' } });
      const page = await open(p, { storage: broken });
      assert.deepEqual(page.errors, []);
      await restore(page, { rules: 'x', sets: { [id]: 5 }, hist: 'x' });
      await restore(page, '{這不是 JSON');
      assert.match(await toastText(page, p), /不是有效的備份/);
      await tab(page, 'order');
      if (p.v2) {
        // 壞掉的草稿沒有日期：應該提醒「沒選日期」，選了日期就能算
        assert.match(await page.locator('.nodate').textContent(), /有 1 天/);
        await setVal(page.locator('#days input[data-k=date]').first(), '2026-11-12');
      }
      await pickSet(page, p, 0, id, 3);
      assert.match(await msgOf(page, p), /材料如下/);
      assert.deepEqual(page.errors, []);
      await page.close2();
    });

    test('另一個級別的備份會被擋下，資料不會被換掉', async () => {
      const page = await open(p);
      await page.evaluate(() => { S.rules['蔥'] = { t: 'sum' }; });
      await restore(page, { app: otherApp(p.app), rules: {}, hist: [] });
      assert.match(await toastText(page, p), /請到那一頁還原/);
      assert.deepEqual(await page.evaluate(() => S.rules['蔥']), { t: 'sum' });
      await page.close2();
    });

    test('產生的備份會帶 app 標記，貼回去可以還原', async () => {
      const page = await open(p);
      await page.evaluate(() => { S.rules['蔥'] = { t: 'jin', g: 25 }; });
      await tab(page, 'hist');
      await page.click('#bkOut');
      const bk = JSON.parse(await page.locator('#bk').inputValue());
      assert.equal(bk.app, p.app);
      await page.evaluate(() => { S.rules = {}; });
      await page.click('#bkIn');
      assert.deepEqual(await page.evaluate(() => S.rules['蔥']), { t: 'jin', g: 25 });
      await page.close2();
    });

    test('規則的數字欄清空就回預設、填負數會被擋下', async () => {
      const page = await open(p);
      await tab(page, 'rules');
      const box = page.locator('#rules details', { hasText: '西芹' }).first();
      await box.locator('summary').click();
      await setVal(box.locator('input[data-k=per]'), '5');
      assert.equal(await page.evaluate(() => rule('西芹').per), 5);
      await setVal(page.locator('#rules details', { hasText: '西芹' }).first().locator('input[data-k=per]'), '');
      assert.equal(await page.evaluate(() => rule('西芹').per), 10);
      assert.equal(await page.evaluate(() => own(S.rules, '西芹')), false, '全部清空後不應留下空的自訂規則');
      await setVal(page.locator('#rules details', { hasText: '西芹' }).first().locator('input[data-k=per]'), '-3');
      assert.equal(await page.evaluate(() => rule('西芹').per), 10);
      assert.match(await page.locator(p.v2 ? '#toast' : '#toast3').textContent(), /不合理/);
      await page.close2();
    });

    test('紀錄的「複製」在剪貼簿 API 失敗時也能複製整段', async () => {
      const page = await open(p);
      await pickSet(page, p, 0, await firstSet(page), 5);
      await page.click('#save');
      const text = await page.evaluate(() => S.hist[0].text);
      await tab(page, 'hist');
      await page.click('#hist [data-cp]');
      assert.equal(await page.evaluate(() => window.__copied), text);
      await page.close2();
    });
  });
}

for (const p of PAGES.filter((x) => x.v2)) {
  describe(`${p.file}：多天合併與草稿`, { skip: SKIP }, () => {
    test('改上課日期後，手動加的項目和改過的字會跟著搬到新的入貨日', async () => {
      const page = await open(p);
      const id = await firstSet(page);
      await setVal(page.locator('#days input[data-k=date]').first(), '2026-11-12');
      await pickSet(page, p, 0, id, 5);
      await page.click('.grp [data-addman]');
      await setVal(page.locator('.grp .line[data-man] input[type=text]').first(), '白木耳✖️1斤');
      await setVal(page.locator('.grp .line[data-key] input[type=text]').first(), '自己改的第一項');
      let msg = await msgOf(page, p);
      assert.match(msg, /白木耳✖️1斤/);
      assert.match(msg, /1\. 自己改的第一項/);
      await setVal(page.locator('#days input[data-k=date]').first(), '2026-11-19');
      msg = await msgOf(page, p);
      assert.match(msg, /^11\/18\. /);
      assert.match(msg, /白木耳✖️1斤/);
      assert.match(msg, /1\. 自己改的第一項/);
      assert.deepEqual(page.errors, []);
      await page.close2();
    });

    test('載入紀錄、改日期後沿用：手動項目還在', async () => {
      const page = await open(p);
      const id = await firstSet(page);
      await setVal(page.locator('#days input[data-k=date]').first(), '2026-11-12');
      await pickSet(page, p, 0, id, 5);
      await page.click('.grp [data-addman]');
      await setVal(page.locator('.grp .line[data-man] input[type=text]').first(), '白木耳✖️1斤');
      await page.click('#save');
      await page.click('#reset');
      assert.doesNotMatch(await page.locator('#groups').innerText(), /白木耳/);
      await tab(page, 'hist');
      await page.click('#hist [data-ld]');
      await setVal(page.locator('#days input[data-k=date]').first(), '2026-12-03');
      assert.match(await msgOf(page, p), /白木耳✖️1斤/);
      await page.close2();
    });

    test('排了課卻沒選日期，會提醒這些課不會算進叫貨單', async () => {
      const page = await open(p);
      await pickSet(page, p, 0, await firstSet(page), 5);
      assert.equal(await page.locator('.nodate').count(), 0);
      await setVal(page.locator('#days input[data-k=date]').first(), '');
      assert.match(await page.locator('.nodate').textContent(), /有 1 天/);
      assert.match(await page.locator('#barInfo').textContent(), /1 天沒選日期/);
      await page.close2();
    });

    test('「複製全部」在剪貼簿 API 失敗時，會複製所有訊息而不只第一則', async () => {
      const page = await open(p);
      const id = await firstSet(page);
      await setVal(page.locator('#days input[data-k=date]').first(), '2026-11-12');
      await pickSet(page, p, 0, id, 5);
      await page.click('#addDay');
      await setVal(page.locator('#days .day').nth(1).locator('input[data-k=date]'), '2026-11-19');
      await page.locator('#days .day').nth(1).locator('select[data-k=set]').first().selectOption(id);
      assert.equal(await page.locator('textarea[data-msg]').count(), 2);
      await page.click('#copyAll');
      const copied = await page.evaluate(() => window.__copied);
      const all = await page.evaluate(() => allMsgs().join('\n\n'));
      assert.equal(copied, all);
      assert.match(copied, /^11\/11\. [\s\S]*\n\n11\/18\. /);
      await page.close2();
    });

    test('同一個上課日加兩次，上課日只顯示一次', async () => {
      const page = await open(p);
      const id = await firstSet(page);
      await setVal(page.locator('#days input[data-k=date]').first(), '2026-11-12');
      await pickSet(page, p, 0, id, 5);
      await page.click('#addDay');
      await setVal(page.locator('#days .day').nth(1).locator('input[data-k=date]'), '2026-11-12');
      assert.equal(await page.evaluate(() => groups()[0].cls.length), 1);
      await page.close2();
    });
  });
}

describe('index.html：改過的字', { skip: SKIP }, () => {
  test('改過的叫貨字，在調整其他堂課後仍然保留；數量變了才換成新算的', async () => {
    const p = PAGES[0];
    const page = await open(p);
    await pickSet(page, p, 0, '301-1', 5);
    const fish = page.locator('#lines .line input[type=text]').nth(2);
    assert.equal(await fish.inputValue(), '鱸魚✖️5');
    await setVal(fish, '鱸魚✖️5（要大隻）');
    await pickSet(page, p, 1, '301-7', 5); // 301-7 沒有鱸魚
    assert.match(await page.locator('#out').inputValue(), /鱸魚✖️5（要大隻）/);
    await pickSet(page, p, 0, '301-1', 6); // 鱸魚數量變了
    assert.match(await page.locator('#out').inputValue(), /\d\. 鱸魚✖️6\n/);
    assert.deepEqual(page.errors, []);
    await page.close2();
  });
});
