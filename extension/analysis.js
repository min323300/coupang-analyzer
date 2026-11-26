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

  function formatWon(n) {
    if (n == null || isNaN(n)) return '-';
    if (n >= 100000000) return (Math.round(n / 10000000) / 10) + '억원';
    if (n >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만원';
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

  const api = { analyzeKeyword, priceBands, median, estimateSales, difficulty, formatWon, toCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CoupangAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
