const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('extension/popup.html', 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://x/popup.html' });
const w = dom.window;
let clip = '';
const store = { sessions: { '생굴무침': { keyword: '생굴무침', items: {
  '1': { id: '1', rank: 2, name: '더좋은 생굴무침 330g', price: 9840, reviewCount: 2025, rating: 4, delivery: '일반', ad: false, url: 'https://www.coupang.com/vp/products/1' },
  '3': { id: '3', rank: 5, name: '통영 산지직송 생굴무침 330g', price: 12900, reviewCount: 300, rating: 4.5, delivery: '일반', ad: false, url: 'https://www.coupang.com/vp/products/3' },
  '4': { id: '4', rank: 6, name: '[특가] 통영 산지직송 최상급 생굴무침 500g', price: 16900, reviewCount: 120, rating: 4.5, delivery: '일반', ad: false, url: 'https://www.coupang.com/vp/products/4' },
  '5': { id: '5', rank: 8, name: '최상급 통영 굴무침', price: 9900, reviewCount: 50, rating: 4, delivery: '일반', ad: false, url: 'https://www.coupang.com/vp/products/5' },
  '2': { id: '2', rank: null, name: '광고 굴무침', price: 24120, reviewCount: 6389, rating: 4.5, delivery: '로켓배송', ad: true, url: 'https://www.coupang.com/vp/products/2' } } } }, current: '생굴무침' };
w.chrome = { storage: { local: { get: async () => store, set: async () => {} } }, tabs: { query: async () => [{ id: 1, url: 'https://www.coupang.com/np/search?q=x' }] } };
Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { clip = t; } } });
w.eval(fs.readFileSync('extension/analysis.js', 'utf8'));
w.eval(fs.readFileSync('extension/popup.js', 'utf8'));
(async () => {
  await new Promise((r) => setTimeout(r, 50));
  w.document.getElementById('btnCopySummary').click(); await new Promise((r) => setTimeout(r, 20));
  console.log('--- 요약 ---\n' + clip);
  w.document.getElementById('btnCopyTable').click(); await new Promise((r) => setTimeout(r, 20));
  console.log('--- 표 ---\n' + clip);
  w.document.getElementById('btnCopyKeywords').click(); await new Promise((r) => setTimeout(r, 20));
  console.log('--- 키워드 ---\n' + clip);
  console.log('--- 키워드 칩 --- ' + w.document.getElementById('keywords').textContent.replace(/\s+/g, ' ').trim());
  w.document.querySelector('.copy-one').click(); await new Promise((r) => setTimeout(r, 20));
  console.log('--- 한 상품 ---\n' + clip);
  console.log('--- 상태 --- ' + w.document.getElementById('status').textContent);
})();
