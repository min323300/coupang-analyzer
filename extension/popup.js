/* 쿠팡 상품 분석기 - 팝업 화면 */
(function () {
  'use strict';
  const A = window.CoupangAnalysis;
  const $ = (id) => document.getElementById(id);
  const state = { settings: { scriptUrl: '', multiplier: 30 }, sessions: {}, current: '', reviews: null, sortKey: 'rank', sortDir: 1 };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (n == null || n === '' ? '-' : Number(n).toLocaleString('ko-KR'));

  function status(msg, type) {
    const el = $('status');
    el.textContent = msg;
    el.className = 'status show ' + (type || 'info');
    clearTimeout(status._t);
    if (type !== 'err') status._t = setTimeout(() => { el.className = 'status'; }, 4000);
  }

  function save() {
    return chrome.storage.local.set({ settings: state.settings, sessions: state.sessions, current: state.current, reviews: state.reviews });
  }

  async function load() {
    const d = await chrome.storage.local.get(['settings', 'sessions', 'current', 'reviews']);
    Object.assign(state.settings, d.settings || {});
    state.sessions = d.sessions || {};
    state.current = d.current || Object.keys(state.sessions)[0] || '';
    state.reviews = d.reviews || null;
    $('scriptUrl').value = state.settings.scriptUrl || '';
    $('multiplier').value = state.settings.multiplier || 30;
  }

  // 현재 탭에서 페이지 정보 읽기
  async function scrapeActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('열린 탭을 찾을 수 없습니다.');
    const ask = () => chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
    let res;
    try {
      res = await ask();
    } catch (e) {
      // 설치 전에 열어둔 탭이면 스크립트를 넣고 다시 시도
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        res = await ask();
      } catch (e2) {
        throw new Error('쿠팡 페이지에서만 사용할 수 있습니다. 쿠팡 검색/상품 페이지를 열고 다시 시도하세요.');
      }
    }
    if (!res || !res.ok) throw new Error((res && res.error) || '페이지를 읽지 못했습니다.');
    return res.data;
  }

  // ---------- 검색 분석 ----------
  async function collect() {
    try {
      const data = await scrapeActiveTab();
      if (data.type !== 'search') return status('쿠팡 "검색 결과" 페이지에서 눌러 주세요.', 'err');
      if (!data.items.length) return status('상품을 찾지 못했습니다. 페이지를 끝까지 스크롤한 뒤 다시 눌러 보세요.', 'err');
      const kw = data.keyword || '(키워드 없음)';
      const s = state.sessions[kw] || { keyword: kw, items: {}, pages: [] };
      data.items.forEach((it) => { s.items[it.id] = Object.assign(s.items[it.id] || {}, it); });
      if (s.pages.indexOf(data.page) < 0) s.pages.push(data.page);
      s.updatedAt = new Date().toISOString();
      state.sessions[kw] = s;
      state.current = kw;
      await save();
      render();
      status(`"${kw}" ${data.page}페이지에서 상품 ${data.items.length}개 수집 (누적 ${Object.keys(s.items).length}개)`, 'ok');
    } catch (e) {
      status(e.message, 'err');
    }
  }

  function currentItems() {
    const s = state.sessions[state.current];
    return s ? Object.values(s.items) : [];
  }

  function render() {
    const sel = $('keywordSelect');
    const kws = Object.keys(state.sessions);
    sel.innerHTML = kws.length ? kws.map((k) => `<option ${k === state.current ? 'selected' : ''}>${esc(k)}</option>`).join('') : '<option>수집한 키워드 없음</option>';

    const items = currentItems();
    if (!items.length) {
      $('summary').innerHTML = '';
      $('advice').innerHTML = '';
      $('bands').innerHTML = '<p class="note">아직 수집한 데이터가 없습니다.</p>';
      document.querySelector('#table tbody').innerHTML = '';
      return;
    }
    const r = A.analyzeKeyword(items, state.settings.multiplier);
    const card = (k, v, cls) => `<div class="card"><div class="k">${k}</div><div class="v ${cls || ''}">${v}</div></div>`;
    $('summary').innerHTML = [
      card('수집 상품 수', `${r.productCount}개 <small>(광고 ${r.adCount})</small>`),
      card('평균 / 중간 가격', `${A.formatWon(r.avgPrice)} / ${A.formatWon(r.medianPrice)}`),
      card('상위10 평균 리뷰', num(r.top10AvgReviews)),
      card('진입 난이도', r.difficulty.level, 'level-' + r.difficulty.level.split(' ')[0]),
      card('가격 범위', `${A.formatWon(r.minPrice)} ~ ${A.formatWon(r.maxPrice)}`),
      card('평균 별점', r.avgRating == null ? '-' : r.avgRating),
      card('로켓 배송 비율', r.rocketShare + '%'),
      card('상위3 리뷰 독점률', r.top3Share + '%')
    ].join('');

    const tips = [r.difficulty.note];
    if (r.bestBand) tips.push(`가장 많이 팔리는 가격대는 <b>${bandLabel(r.bestBand)}</b> (리뷰 비중 ${r.bestBand.share}%) 입니다.`);
    if (r.top3Share >= 60) tips.push('상위 3개 상품이 리뷰의 대부분을 가져갑니다. 같은 상품으로 정면 승부보다 구성·용량·디자인을 바꾼 차별화가 필요합니다.');
    else if (r.top3Share <= 30) tips.push('판매가 여러 상품에 고르게 나뉩니다. 절대 강자가 없어 신규 진입에 유리한 편입니다.');
    if (r.lowReviewWinners >= 3) tips.push(`리뷰 100개 미만인데 20위 안에 든 상품이 ${r.lowReviewWinners}개 있습니다. 최근 뜨는 상품이 있다는 신호이니 확인해 보세요.`);
    if (r.rocketShare >= 70) tips.push('로켓 배송 상품이 대부분입니다. 일반 배송으로는 노출이 불리할 수 있어 로켓그로스 입점을 고려하세요.');
    $('advice').innerHTML = '💡 ' + tips.join('<br>💡 ');

    $('bands').innerHTML = r.bands.map((b) => `
      <div class="band ${b === r.bestBand ? 'best' : ''}">
        <div class="label">${bandLabel(b)} <small>(${b.count}개)</small></div>
        <div class="bar"><span style="width:${b.share}%"></span></div>
        <div class="pct">${b.share}%</div>
      </div>`).join('');

    const key = state.sortKey;
    const dir = state.sortDir;
    const rows = r.items.slice().sort((a, b) => {
      let x = a[key], y = b[key];
      if (key === 'rank') { x = x == null ? 9999 : x; y = y == null ? 9999 : y; }
      if (typeof x === 'string' || typeof y === 'string') return String(x || '').localeCompare(String(y || '')) * dir;
      return ((x || 0) - (y || 0)) * dir;
    });
    document.querySelector('#table tbody').innerHTML = rows.map((i) => `
      <tr>
        <td class="num">${i.rank || (i.ad ? '광고' : '-')}</td>
        <td class="name">${i.ad ? '<span class="tag ad">광고</span>' : ''}<a href="${esc(i.url)}" target="_blank">${esc(i.name)}</a></td>
        <td class="num">${num(i.price)}</td>
        <td class="num">${num(i.reviewCount)}</td>
        <td class="num">${i.rating == null ? '-' : i.rating}</td>
        <td>${i.delivery !== '일반' ? `<span class="tag">${esc(i.delivery)}</span>` : '일반'}</td>
        <td class="num">${A.formatWon(i.estRevenue)}</td>
        <td><button class="copy-one" data-id="${esc(i.id)}" title="이 상품 정보 복사">📋</button></td>
      </tr>`).join('');
  }

  // ---------- 복사 ----------
  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // 클립보드 권한이 막힌 경우 예전 방식으로 복사
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    status(label + ' 복사했습니다. 원하는 곳에 Ctrl+V 로 붙여넣으세요.', 'ok');
  }

  function itemLine(i) {
    const bits = [
      i.name,
      `가격 ${num(i.price)}원`,
      `리뷰 ${num(i.reviewCount)}개`,
      i.rating != null ? `별점 ${i.rating}` : '',
      i.delivery,
      i.ad ? '광고' : ''
    ].filter(Boolean);
    return bits.join(' / ') + '\n' + i.url;
  }

  function copySummary() {
    const items = currentItems();
    if (!items.length) return status('먼저 데이터를 수집하세요.', 'err');
    const r = A.analyzeKeyword(items, state.settings.multiplier);
    const top = r.items.filter((i) => !i.ad).sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0)).slice(0, 10);
    const lines = [
      `[쿠팡 "${state.current}" 분석] ${new Date().toLocaleDateString('ko-KR')}`,
      `· 수집 상품 ${r.productCount}개 (광고 ${r.adCount})`,
      `· 평균 ${A.formatWon(r.avgPrice)} / 중간 ${A.formatWon(r.medianPrice)} (범위 ${A.formatWon(r.minPrice)} ~ ${A.formatWon(r.maxPrice)})`,
      `· 평균 별점 ${r.avgRating == null ? '-' : r.avgRating} / 로켓 비율 ${r.rocketShare}%`,
      r.bestBand ? `· 가장 많이 팔리는 가격대: ${bandLabel(r.bestBand)} (리뷰 비중 ${r.bestBand.share}%)` : '',
      '',
      '[리뷰 많은 상품 TOP ' + top.length + ']'
    ].filter((x) => x !== null);
    top.forEach((i, n) => lines.push(`${n + 1}. ${itemLine(i)}`));
    copyText(lines.join('\n'), '요약을');
  }

  function copyTable() {
    const items = currentItems();
    if (!items.length) return status('먼저 데이터를 수집하세요.', 'err');
    const r = A.analyzeKeyword(items, state.settings.multiplier);
    const head = ['순위', '광고', '상품명', '가격', '리뷰수', '별점', '배송', '상품ID', 'URL'];
    const clean = (v) => String(v == null ? '' : v).replace(/[\t\n]/g, ' ');
    const rows = r.items.slice().sort((a, b) => (a.rank || 9999) - (b.rank || 9999))
      .map((i) => [i.rank || '', i.ad ? 'Y' : '', i.name, i.price, i.reviewCount, i.rating == null ? '' : i.rating, i.delivery, i.id, i.url].map(clean).join('\t'));
    copyText([head.join('\t')].concat(rows).join('\n'), `표(${rows.length}개 상품)를`);
  }

  function bandLabel(b) {
    if (b.to === Infinity) return `${A.formatWon(b.from)} 이상`;
    if (!b.from) return `${A.formatWon(b.to)} 미만`;
    return `${A.formatWon(b.from)}~${A.formatWon(b.to)}`;
  }

  async function postToSheet(payload) {
    if (!state.settings.scriptUrl) throw new Error('설정 탭에서 구글 앱스스크립트 주소를 먼저 입력하세요.');
    const res = await fetch(state.settings.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('앱스스크립트 응답을 읽지 못했습니다. 배포 설정(액세스: 모든 사용자)을 확인하세요.'); }
    if (!json.ok) throw new Error(json.error || '시트 저장 실패');
    return json;
  }

  async function sendToSheet() {
    const items = currentItems();
    if (!items.length) return status('먼저 데이터를 수집하세요.', 'err');
    try {
      status('구글시트로 보내는 중...', 'info');
      const res = await postToSheet({ action: 'saveSearch', keyword: state.current, multiplier: Number(state.settings.multiplier) || 30, items });
      status(`저장 완료: ${res.saved}개 상품 기록, 판매추적 ${res.tracked}개 갱신`, 'ok');
    } catch (e) {
      status(e.message, 'err');
    }
  }

  function downloadCsv() {
    const items = currentItems();
    if (!items.length) return status('먼저 데이터를 수집하세요.', 'err');
    const r = A.analyzeKeyword(items, state.settings.multiplier);
    const blob = new Blob([A.toCsv(r.items.sort((a, b) => (a.rank || 9999) - (b.rank || 9999)))], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `쿠팡_${state.current}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function clearCurrent() {
    if (!state.current) return;
    delete state.sessions[state.current];
    state.current = Object.keys(state.sessions)[0] || '';
    await save();
    render();
    status('비웠습니다.', 'ok');
  }

  // ---------- 리뷰 분석 ----------
  async function collectReviews() {
    try {
      const data = await scrapeActiveTab();
      if (data.type !== 'product') return status('쿠팡 "상품 상세" 페이지에서 눌러 주세요.', 'err');
      if (!state.reviews || state.reviews.id !== data.id) state.reviews = { id: data.id, name: data.name, price: data.price, reviewCount: data.reviewCount, url: data.url, list: [] };
      const existing = new Set(state.reviews.list.map((r) => r.text));
      let added = 0;
      data.reviews.forEach((r) => { if (!existing.has(r.text)) { state.reviews.list.push(r); added++; } });
      Object.assign(state.reviews, { name: data.name || state.reviews.name, price: data.price || state.reviews.price, reviewCount: data.reviewCount || state.reviews.reviewCount });
      await save();
      renderReviews();
      if (!data.reviews.length) status('리뷰를 찾지 못했습니다. 상품 페이지 아래 "상품평" 영역까지 스크롤해서 리뷰가 보이게 한 뒤 다시 눌러 주세요.', 'err');
      else status(`리뷰 ${added}개 추가 (누적 ${state.reviews.list.length}개)`, 'ok');
    } catch (e) {
      status(e.message, 'err');
    }
  }

  function renderReviews() {
    const r = state.reviews;
    if (!r) { $('reviewInfo').innerHTML = '<p class="note">아직 수집한 리뷰가 없습니다.</p>'; return; }
    const card = (k, v) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    $('reviewInfo').innerHTML = [
      card('상품', `<span style="font-size:12px">${esc((r.name || '').slice(0, 40))}</span>`),
      card('가격', A.formatWon(r.price)),
      card('전체 리뷰 수', num(r.reviewCount)),
      card('수집한 리뷰', r.list.length + '개')
    ].join('');
    if (r.analysis) renderAi(r.analysis);
  }

  function renderAi(a) {
    const list = (arr) => '<ul>' + (arr || []).map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>';
    $('aiResult').innerHTML = `
      <h4>한 줄 요약</h4><p>${esc(a.summary)}</p>
      <h4>잘 팔리는 이유</h4>${list(a.whySells)}
      <h4>고객이 좋아하는 점</h4>${list(a.pros)}
      <h4>고객 불만</h4>${list(a.cons)}
      <h4>차별화 아이디어 (이렇게 팔면 이긴다)</h4>${list(a.ideas)}
      <h4>상세페이지에 넣을 문구</h4>${list(a.copy)}`;
  }

  async function analyzeReviews() {
    const r = state.reviews;
    if (!r || !r.list.length) return status('먼저 리뷰를 수집하세요.', 'err');
    try {
      $('btnAnalyze').disabled = true;
      status(`AI가 리뷰 ${r.list.length}개를 분석하는 중... (10~30초)`, 'info');
      const res = await postToSheet({ action: 'analyzeReviews', product: { id: r.id, name: r.name, price: r.price, reviewCount: r.reviewCount, url: r.url }, reviews: r.list.slice(0, 200) });
      r.analysis = res.analysis;
      await save();
      renderAi(res.analysis);
      status('분석 완료 — 구글시트 "리뷰분석" 탭에도 저장했습니다.', 'ok');
    } catch (e) {
      status(e.message, 'err');
    } finally {
      $('btnAnalyze').disabled = false;
    }
  }

  // ---------- 설정 ----------
  async function saveSettings() {
    state.settings.scriptUrl = $('scriptUrl').value.trim();
    state.settings.multiplier = Number($('multiplier').value) || 30;
    await save();
    render();
    status('저장했습니다.', 'ok');
  }

  async function testConnection() {
    try {
      await saveSettings();
      const res = await postToSheet({ action: 'ping' });
      status('연결 성공! 시트: ' + (res.sheetName || ''), 'ok');
    } catch (e) {
      status(e.message, 'err');
    }
  }

  // ---------- 이벤트 ----------
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + b.dataset.tab));
  }));
  document.querySelectorAll('#table th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.key;
    if (state.sortKey === k) state.sortDir *= -1;
    else { state.sortKey = k; state.sortDir = k === 'rank' || k === 'name' ? 1 : -1; }
    render();
  }));
  $('keywordSelect').addEventListener('change', async (e) => { state.current = e.target.value; await save(); render(); });
  $('btnCollect').addEventListener('click', collect);
  $('btnSend').addEventListener('click', sendToSheet);
  $('btnCsv').addEventListener('click', downloadCsv);
  $('btnClear').addEventListener('click', clearCurrent);
  $('btnCopySummary').addEventListener('click', copySummary);
  $('btnCopyTable').addEventListener('click', copyTable);
  document.querySelector('#table tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-one');
    if (!btn) return;
    const s = state.sessions[state.current];
    const it = s && s.items[btn.dataset.id];
    if (it) copyText(itemLine(it), '상품 정보를');
  });
  $('btnReviewCollect').addEventListener('click', collectReviews);
  $('btnAnalyze').addEventListener('click', analyzeReviews);
  $('btnReviewClear').addEventListener('click', async () => { state.reviews = null; $('aiResult').innerHTML = ''; await save(); renderReviews(); });
  $('btnSave').addEventListener('click', saveSettings);
  $('btnTest').addEventListener('click', testConnection);

  load().then(async () => {
    render();
    renderReviews();
    // 상품 페이지에서 열면 리뷰 탭을 먼저 보여 줌
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && /coupang\.com\/vp\/products\//.test(tab.url || '')) document.querySelector('.tab[data-tab="review"]').click();
  });
})();
