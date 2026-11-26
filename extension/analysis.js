/*
 * 쿠팡 상품 분석기 - 분석 계산
 * 쿠팡은 실제 판매량을 공개하지 않으므로 모든 판매량·매출은 "리뷰 수 기반 추정치"입니다.
 */
(function (root) {
  'use strict';

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  function sum(arr) { return arr.reduce((a, b) => a + (b || 0), 0); }

  // 리뷰 1개당 구매 수(배수). 업계에서는 보통 리뷰 1개 = 20~100건 구매로 봄
  function estimateSales(reviewCount, multiplier) {
    return Math.round((reviewCount || 0) * (multiplier || 30));
  }

  // 가격대를 5구간으로 나눠 구간별 리뷰 합(=판매 비중) 계산
  function priceBands(items, bandCount) {
    bandCount = bandCount || 5;
    const prices = items.map((i) => i.price).filter(Boolean).sort((a, b) => a - b);
    if (!prices.length) return [];
    // 극단값 영향을 줄이려고 하위 5%~상위 95% 범위로 구간 설정
    const lo = prices[Math.floor(prices.length * 0.05)];
    const hi = prices[Math.min(prices.length - 1, Math.ceil(prices.length * 0.95) - 1)];
    const step = Math.max(1, (hi - lo) / bandCount);
    const bands = [];
    for (let b = 0; b < bandCount; b++) {
      const from = Math.round(lo + step * b);
      const to = b === bandCount - 1 ? Infinity : Math.round(lo + step * (b + 1));
      bands.push({ from: b === 0 ? 0 : from, to, count: 0, reviews: 0 });
    }
    items.forEach((it) => {
      if (!it.price) return;
      const band = bands.find((bd) => it.price < bd.to) || bands[bands.length - 1];
      band.count += 1;
      band.reviews += it.reviewCount || 0;
    });
    const totalReviews = sum(bands.map((b) => b.reviews)) || 1;
    bands.forEach((b) => { b.share = Math.round((b.reviews / totalReviews) * 1000) / 10; });
    return bands;
  }

  function difficulty(top10AvgReviews) {
    if (top10AvgReviews < 300) return { level: '쉬움', note: '상위 상품도 리뷰가 적어 신규 진입 여지가 큽니다.' };
    if (top10AvgReviews < 2000) return { level: '보통', note: '차별화(구성·가격·상세페이지)가 있으면 진입 가능합니다.' };
    if (top10AvgReviews < 10000) return { level: '어려움', note: '상위 상품이 리뷰를 많이 쌓았습니다. 세부 키워드를 노리세요.' };
    return { level: '매우 어려움', note: '대형 판매자 시장입니다. 틈새 키워드나 다른 상품을 검토하세요.' };
  }

  function analyzeKeyword(items, multiplier) {
    multiplier = multiplier || 30;
    const list = items.filter((i) => i && i.price);
    const organic = list.filter((i) => !i.ad);
    const prices = list.map((i) => i.price);
    const reviews = list.map((i) => i.reviewCount || 0);
    const ratings = list.map((i) => i.rating).filter((r) => r != null);
    const sortedByReview = organic.slice().sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
    const top10 = sortedByReview.slice(0, 10);
    const top10Avg = top10.length ? Math.round(sum(top10.map((i) => i.reviewCount)) / top10.length) : 0;
    const totalReviews = sum(reviews);
    const top3Share = totalReviews ? Math.round((sum(sortedByReview.slice(0, 3).map((i) => i.reviewCount)) / totalReviews) * 1000) / 10 : 0;
    const rocket = list.filter((i) => i.delivery && i.delivery !== '일반').length;
    const bands = priceBands(list);
    const bestBand = bands.slice().sort((a, b) => b.reviews - a.reviews)[0] || null;
    const lowReviewWinners = organic.filter((i) => i.rank <= 20 && (i.reviewCount || 0) < 100);

    const enriched = list.map((i) => {
      const estSales = estimateSales(i.reviewCount, multiplier);
      return Object.assign({}, i, { estSales, estRevenue: estSales * i.price });
    });

    return {
      productCount: list.length,
      adCount: list.length - organic.length,
      avgPrice: list.length ? Math.round(sum(prices) / list.length) : 0,
      medianPrice: median(prices),
      minPrice: prices.length ? Math.min.apply(null, prices) : 0,
      maxPrice: prices.length ? Math.max.apply(null, prices) : 0,
      totalReviews,
      avgRating: ratings.length ? Math.round((sum(ratings) / ratings.length) * 10) / 10 : null,
      rocketShare: list.length ? Math.round((rocket / list.length) * 1000) / 10 : 0,
      top10AvgReviews: top10Avg,
      top3Share,
      difficulty: difficulty(top10Avg),
      bands,
      bestBand,
      lowReviewWinners: lowReviewWinners.length,
      estMarketSales: estimateSales(totalReviews, multiplier),
      items: enriched
    };
  }

  // ---------- 인기 키워드 ----------
  // 잘 팔리는(리뷰 많은) 상품들이 제목에 공통으로 쓰는 단어를 찾음
  var UNIT_RE = /^[\d.,]+(kg|g|ml|l|개|개입|입|팩|매|박스|세트|통|봉|구|미|마리|과|번|호|cm|mm|m|p|ea)?$/i;
  var STOP = ['1박스', '1세트', '박스', '세트', '상품', '무료배송', '배송', '증정', '포함', '옵션', '택1', '선택', '모음', '구성', '용량', '대용량', '소용량', '단품', '개별', '포장', '및', '외', '등',
    '김장대전', '무배', '오늘끝딜', '특가', '초특가', '타임특가', '한정특가', '슈퍼적립', '할인', '이벤트', '증정이벤트', '기획전', '1+1', '공식', '공식스토어', '새', '창에서', '열림'];
  // 숫자+단위가 붙은 말(무침250g, 1kg+) · 할인 표시
  var MIXED_UNIT_RE = /\d+(\.\d+)?\s*(kg|g|ml|l|개|팩|입|매|통|봉|인분|브릭스|brix)/i;
  // 근거가 있어야 쓸 수 있는 표현 (식품 표시·광고에서 주의)
  var CLAIM_RE = /(최상급|최고급|특급|1위|일등|최고|100%|haccp|해썹|유기농|무농약|무항생제|친환경|인증|명인|명품|전통|\d+년)/i;

  // 산지·지역 이름은 맨 앞에 자주 오지만 업체 이름이 아님
  var PLACES = '통영 고성 거제 남해 여수 완도 진도 해남 신안 목포 영암 강진 장흥 보성 고흥 순천 광양 제주 서귀포 부산 포항 영덕 울진 울릉 속초 강릉 동해 삼척 태안 서산 보령 당진 홍성 군산 부안 고창 영광 무안 나주 담양 곡성 구례 화순 하동 산청 함양 거창 합천 의령 청송 안동 의성 영주 봉화 문경 상주 영천 경산 성주 고령 김해 밀양 창원 마산 진주 사천 횡성 평창 정선 홍천 춘천 철원 인제 양구 이천 여주 안성 김포 강화 옹진 서천 논산 금산 청양 공주 부여 예산 괴산 충주 제천 단양 영동 옥천 보은 음성 진천 국내산 국산 전라도 경상도 강원도 충청도 전남 경남 전북 경북 충남 충북 남해안 동해안 서해안'.split(' ');
  function isPlace(w) {
    var x = String(w || '').replace(/(산|군|시|도)$/, '');
    return PLACES.indexOf(w) >= 0 || PLACES.indexOf(x) >= 0;
  }

  function tokenize(name) {
    return String(name || '')
      .replace(/[\[\]\(\)\{\}<>【】「」『』/|,+~!?:;"'·•★☆♥❤︎_=]/g, ' ')
      .split(/\s+/)
      .map(function (t) { return t.replace(/^[-.]+|[-.]+$/g, ''); })
      .filter(Boolean);
  }

  // 상품명 맨 앞의 [태그]를 뺀 첫 단어 (업체·브랜드 이름이 주로 오는 자리)
  function leadToken(name) {
    var t = tokenize(String(name || '').replace(/^\s*(\[[^\]]*\]\s*)+/, ''));
    return t.length ? t[0].toLowerCase() : '';
  }

  function extractKeywords(items, searchKeyword, limit) {
    limit = limit || 20;
    // 판매처 이름(네이버 수집 시)은 업체명으로 표시
    var malls = items.map(function (it) { return String(it.mall || '').replace(/\s+/g, '').toLowerCase(); }).filter(function (m) { return m.length >= 2; });
    var isMall = function (w) {
      var x = String(w).replace(/\s+/g, '').toLowerCase();
      return malls.some(function (m) { return m === x || (x.length >= 3 && (m.indexOf(x) >= 0 || x.indexOf(m) >= 0)); });
    };
    var kwParts = tokenize(searchKeyword).map(function (t) { return t.toLowerCase(); });
    var kwJoined = kwParts.join('');
    var stat = {};
    items.forEach(function (it) {
      var seen = {};
      var lead = leadToken(it.name);
      tokenize(it.name).forEach(function (t) {
        var low = t.toLowerCase();
        if (t.length < 2 || UNIT_RE.test(t) || STOP.indexOf(t) >= 0 || MIXED_UNIT_RE.test(t)) return;
        // 검색어 자체(예: 생굴무침, 생굴, 무침)는 제외
        if (kwParts.indexOf(low) >= 0 || low === kwJoined || (kwJoined && kwJoined.indexOf(low) >= 0)) return;
        if (seen[low]) return;
        seen[low] = true;
        var s = stat[low] || (stat[low] = { word: t, count: 0, reviews: 0, leadCount: 0 });
        s.count += 1;
        s.reviews += it.reviewCount || 0;
        if (lead === low) s.leadCount += 1;
      });
    });
    return Object.keys(stat).map(function (k) { return stat[k]; })
      // 한 상품에만 나온 단어는 업체 이름일 가능성이 커서 제외
      .filter(function (s) { return s.count >= 2; })
      .map(function (s) {
        // 점수: 많은 상품이 쓰고(count), 그 상품들이 많이 팔릴수록(리뷰) 높음
        s.score = Math.round(s.count * Math.log10((s.reviews || 0) + 10) * 10) / 10;
        s.caution = CLAIM_RE.test(s.word) ? '근거 필요'
          : isMall(s.word) ? '업체명 확인'
          // 나온 상품마다 항상 맨 앞에 오는 단어는 업체·브랜드 이름일 가능성
          : (s.leadCount === s.count && !isPlace(s.word) ? '업체명 확인' : '');
        delete s.leadCount;
        return s;
      })
      .sort(function (a, b) { return b.score - a.score || b.reviews - a.reviews; })
      .slice(0, limit);
  }

  function formatWon(n) {
    if (n == null || isNaN(n)) return '-';
    if (n >= 100000000) return (Math.round(n / 10000000) / 10) + '억원';
    if (n >= 100000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만원';
    // 10만원 미만은 소수점 한 자리까지 (예: 1.4만원) — 가격대 구간이 "1만원~1만원"처럼 겹쳐 보이지 않게
    if (n >= 10000) return (Math.round(n / 1000) / 10).toString().replace(/\.0$/, '') + '만원';
    return Math.round(n).toLocaleString('ko-KR') + '원';
  }

  function toCsv(items) {
    const head = ['순위', '상품ID', '상품명', '가격', '리뷰수', '별점', '배송', '광고', '추정누적판매', '추정누적매출', 'URL'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = items.map((i) => [i.rank, i.id, i.name, i.price, i.reviewCount, i.rating, i.delivery, i.ad ? 'Y' : '', i.estSales, i.estRevenue, i.url].map(esc).join(','));
    return '﻿' + [head.join(',')].concat(rows).join('\n');
  }

  const api = { analyzeKeyword, priceBands, median, estimateSales, difficulty, formatWon, toCsv, extractKeywords, tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CoupangAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
