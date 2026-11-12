// 測試共用工具：從 HTML 抽出 /*CORE-START*/ … /*CORE-END*/ 那段程式，在 Node 的 vm 裡執行，
// 這樣不用瀏覽器也能測叫貨量計算、日期推算和資料清理。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PAGES = [
  { file: 'index.html', app: 'bing', key: 'jiaohuo.v1', v2: false },
  { file: 'v2.html', app: 'bing', key: 'jiaohuo.v2', v2: true },
  { file: 'yiji.html', app: 'yi', key: 'jiaohuo.yi.v1', v2: true },
];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function section(src, start, end) {
  const i = src.indexOf(start);
  const j = src.indexOf(end);
  if (i < 0 || j < 0 || j < i) throw new Error(`找不到 ${start} … ${end}`);
  return src.slice(i, j + end.length);
}

const EXPORTS = [
  'APP', 'APPS', 'RAW', 'DR', 'ORDER', 'ROWS', 'TIMES', 'KINDS',
  'parseSet', 'getSet', 'unitOf', 'rule', 'num', 'snap', 'frac', 'jinText', 'allNames',
  'compute', 'sched', 'message', 'detail', 'md', 'mdw', 'cnt',
  'cleanState', 'cleanDraft', 'foreignBackup',
];

function loadCore(file) {
  const core = section(read(file), '/*CORE-START*/', '/*CORE-END*/');
  const ctx = vm.createContext({});
  return vm.runInContext(
    `${core}\n;({${EXPORTS.join(',')},getS:()=>S,setS:v=>{S=v}})`,
    ctx,
    { filename: file },
  );
}

// vm 裡建立的物件原型和外面不同，比對前先轉成一般 JSON 物件
const plain = (x) => JSON.parse(JSON.stringify(x));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

module.exports = { ROOT, PAGES, read, section, loadCore, plain, ymd };
