/**
 * 쿠팡 상품 분석기 - 구글시트 저장 + 판매 추적 + AI 리뷰 분석
 *
 * 설치 방법 (README 참고)
 * 1) 새 구글시트 → 확장 프로그램 → Apps Script → 이 코드를 붙여넣기
 * 2) 프로젝트 설정 → 스크립트 속성에 OPENAI_API_KEY 추가 (리뷰 AI 분석을 쓸 때만)
 * 3) setup 함수를 한 번 실행 (권한 승인)
 * 4) 배포 → 새 배포 → 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → 주소 복사
 */

var SHEETS = {
  LOG: { name: '수집기록', headers: ['수집일시', '출처', '키워드', '순위', '상품ID', '상품명', '가격', '리뷰수', '별점', '구매수', '판매처', '배송', '광고', 'URL'] },
  SUMMARY: { name: '키워드요약', headers: ['수집일시', '출처', '키워드', '상품수', '평균가격', '중간가격', '최저가', '최고가', '총리뷰', '상위10평균리뷰', '상위3독점률(%)', '로켓비율(%)', '평균별점', '진입난이도'] },
  TRACK: { name: '판매추적', headers: ['상품ID', '상품명', '출처', '판매처', '키워드', '첫수집일시', '첫리뷰수', '최근수집일시', '최근리뷰수', '최근가격', '경과일', '리뷰증가', '하루리뷰증가', '추정하루판매', '추정월판매', '추정월매출', 'URL'] },
  REVIEW: { name: '리뷰분석', headers: ['분석일시', '상품ID', '상품명', '가격', '전체리뷰수', '분석리뷰수', '한줄요약', '잘팔리는이유', '장점', '불만', '차별화아이디어', '상세페이지문구', 'URL'] }
};

function setup() {
  Object.keys(SHEETS).forEach(function (k) { getSheet_(SHEETS[k]); });
  var first = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('시트1');
  if (first && first.getLastRow() === 0 && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1) {
    SpreadsheetApp.getActiveSpreadsheet().deleteSheet(first);
  }
}

function getSheet_(def) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold').setBackground('#e8eefc');
    sh.setFrozenRows(1);
  }
  return sh;
}

function doGet() {
  return json_({ ok: true, message: '쿠팡 상품 분석기 연결됨', sheetName: SpreadsheetApp.getActiveSpreadsheet().getName() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'ping':
        return json_({ ok: true, sheetName: SpreadsheetApp.getActiveSpreadsheet().getName() });
      case 'saveSearch':
        return json_(saveSearch_(body));
      case 'analyzeReviews':
        return json_(analyzeReviews_(body));
      default:
        return json_({ ok: false, error: '알 수 없는 요청: ' + body.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 검색 결과 저장 ----------
function saveSearch_(body) {
  var now = new Date();
  var rawKeyword = String(body.keyword || '');
  var source = body.source || (/^\[네이버\]/.test(rawKeyword) ? '네이버' : '쿠팡');
  var keyword = rawKeyword.replace(/^\[네이버\]\s*/, '');
  var multiplier = Number(body.multiplier) || 30;
  var items = (body.items || []).filter(function (i) { return i && i.id && i.price; });
  if (!items.length) throw new Error('저장할 상품이 없습니다.');
  items.sort(function (a, b) { return (a.rank || 999) - (b.rank || 999); });

  // 1) 수집기록
  var log = getSheet_(SHEETS.LOG);
  var rows = items.map(function (i) {
    return [now, source, keyword, i.rank || '', String(i.id), i.name || '', i.price || '', i.reviewCount || 0, i.rating == null ? '' : i.rating,
      i.purchaseCount == null ? '' : i.purchaseCount, i.mall || '', i.delivery || '', i.ad ? 'Y' : '', shortUrl_(i.url)];
  });
  log.getRange(log.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  log.getRange(2, 5, log.getLastRow() - 1, 1).setNumberFormat('@');

  // 2) 키워드요약
  var s = summarize_(items);
  getSheet_(SHEETS.SUMMARY).appendRow([now, source, keyword, s.count, s.avg, s.median, s.min, s.max, s.totalReviews, s.top10Avg, s.top3Share, s.rocketShare, s.avgRating, s.level]);

  // 3) 판매추적 (같은 상품을 다른 날 다시 수집하면 리뷰 증가량으로 판매 추정)
  var tracked = updateTracking_(items, keyword, now, multiplier, source);

  return { ok: true, saved: items.length, tracked: tracked };
}

function summarize_(items) {
  var prices = items.map(function (i) { return Number(i.price); }).sort(function (a, b) { return a - b; });
  var organic = items.filter(function (i) { return !i.ad; });
  var byReview = organic.slice().sort(function (a, b) { return (b.reviewCount || 0) - (a.reviewCount || 0); });
  var total = items.reduce(function (t, i) { return t + (i.reviewCount || 0); }, 0);
  var top10 = byReview.slice(0, 10);
  var top10Avg = top10.length ? Math.round(top10.reduce(function (t, i) { return t + (i.reviewCount || 0); }, 0) / top10.length) : 0;
  var top3 = byReview.slice(0, 3).reduce(function (t, i) { return t + (i.reviewCount || 0); }, 0);
  var ratings = items.map(function (i) { return i.rating; }).filter(function (r) { return r != null && r !== ''; });
  var rocket = items.filter(function (i) { return i.delivery && i.delivery !== '일반'; }).length;
  var mid = Math.floor(prices.length / 2);
  var level = top10Avg < 300 ? '쉬움' : top10Avg < 2000 ? '보통' : top10Avg < 10000 ? '어려움' : '매우 어려움';
  return {
    count: items.length,
    avg: Math.round(prices.reduce(function (t, p) { return t + p; }, 0) / prices.length),
    median: prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2),
    min: prices[0],
    max: prices[prices.length - 1],
    totalReviews: total,
    top10Avg: top10Avg,
    top3Share: total ? Math.round(top3 / total * 1000) / 10 : 0,
    rocketShare: Math.round(rocket / items.length * 1000) / 10,
    avgRating: ratings.length ? Math.round(ratings.reduce(function (t, r) { return t + Number(r); }, 0) / ratings.length * 10) / 10 : '',
    level: level
  };
}

function shortUrl_(u) {
  u = String(u || '');
  // 스마트스토어·쿠팡 상품 주소는 ? 뒤 추적값을 지워 짧게, 광고 주소는 그대로(잘라서)
  if (/smartstore\.naver\.com\/[^/]+\/products\/|coupang\.com\/vp\/products\//.test(u)) return u.split('?')[0];
  return u.slice(0, 500);
}

function updateTracking_(items, keyword, now, multiplier, source) {
  var sh = getSheet_(SHEETS.TRACK);
  var width = SHEETS.TRACK.headers.length;
  var last = sh.getLastRow();
  var data = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  var index = {};
  data.forEach(function (r, i) { index[String(r[0])] = i; });

  // 열: 0 상품ID 1 상품명 2 출처 3 판매처 4 키워드 5 첫수집일시 6 첫리뷰수 7 최근수집일시 8 최근리뷰수 9 최근가격
  //     10 경과일 11 리뷰증가 12 하루리뷰증가 13 추정하루판매 14 추정월판매 15 추정월매출 16 URL
  items.forEach(function (it) {
    var id = String(it.id);
    var reviews = Number(it.reviewCount) || 0;
    if (index[id] == null) {
      index[id] = data.length;
      data.push([id, it.name || '', source || '', it.mall || '', keyword, now, reviews, now, reviews, it.price, 0, 0, '', '', '', '', shortUrl_(it.url)]);
    } else {
      var r = data[index[id]];
      r[1] = it.name || r[1];
      r[3] = it.mall || r[3];
      r[7] = now;
      r[8] = reviews;
      r[9] = it.price;
      r[16] = shortUrl_(it.url) || r[16];
    }
  });

  data.forEach(function (r) {
    var first = new Date(r[5]);
    var recent = new Date(r[7]);
    var days = (recent - first) / 86400000;
    r[10] = Math.round(days * 10) / 10;
    r[11] = (Number(r[8]) || 0) - (Number(r[6]) || 0);
    if (days >= 0.9) {
      var perDay = Math.max(0, r[11]) / days;
      r[12] = Math.round(perDay * 100) / 100;
      r[13] = Math.round(perDay * multiplier);
      r[14] = Math.round(perDay * multiplier * 30);
      r[15] = Math.round(perDay * multiplier * 30 * (Number(r[9]) || 0));
    } else {
      r[12] = '1일 후 재수집 필요';
      r[13] = r[14] = r[15] = '';
    }
  });

  if (data.length) {
    sh.getRange(2, 1, data.length, width).setValues(data);
    sh.getRange(2, 1, data.length, 1).setNumberFormat('@');
    sh.getRange(2, 16, data.length, 1).setNumberFormat('#,##0');
  }
  return items.length;
}

// ---------- AI 리뷰 분석 ----------
function analyzeReviews_(body) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('OPENAI_API_KEY');
  if (!key) throw new Error('앱스스크립트 [프로젝트 설정 → 스크립트 속성]에 OPENAI_API_KEY를 넣어 주세요.');
  var model = props.getProperty('OPENAI_MODEL') || 'gpt-4o-mini';
  var p = body.product || {};
  var reviews = (body.reviews || []).slice(0, 200);
  if (!reviews.length) throw new Error('분석할 리뷰가 없습니다.');

  var reviewText = reviews.map(function (r, i) {
    return (i + 1) + '. ' + (r.star ? '[별점 ' + r.star + '] ' : '') + String(r.text).slice(0, 400);
  }).join('\n');

  var prompt =
    '너는 쿠팡 상품 소싱 전문가야. 아래 상품의 실제 고객 리뷰를 분석해서, 이 상품이 왜 잘 팔리는지와 ' +
    '경쟁 판매자가 어떻게 차별화하면 이길 수 있는지 알려줘. 리뷰에 근거한 내용만 쓰고, 추측은 하지 마.\n\n' +
    '상품명: ' + (p.name || '') + '\n가격: ' + (p.price || '') + '원\n전체 리뷰 수: ' + (p.reviewCount || '') + '\n\n' +
    '리뷰:\n' + reviewText + '\n\n' +
    '아래 JSON 형식으로만 답해. 각 배열은 3~5개 항목, 한국어로 짧고 구체적으로.\n' +
    '{"summary":"한 줄 요약","whySells":["잘 팔리는 이유"],"pros":["고객이 좋아하는 점"],"cons":["고객 불만"],"ideas":["차별화 아이디어"],"copy":["상세페이지에 넣을 문구"]}';

  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    })
  });
  var code = res.getResponseCode();
  var out = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error('OpenAI 오류(' + code + '): ' + (out.error && out.error.message || ''));
  var a = JSON.parse(out.choices[0].message.content);

  var join = function (arr) { return (arr || []).map(function (x) { return '• ' + x; }).join('\n'); };
  getSheet_(SHEETS.REVIEW).appendRow([new Date(), String(p.id || ''), p.name || '', p.price || '', p.reviewCount || '', reviews.length,
    a.summary || '', join(a.whySells), join(a.pros), join(a.cons), join(a.ideas), join(a.copy), p.url || '']);

  return { ok: true, analysis: a };
}
