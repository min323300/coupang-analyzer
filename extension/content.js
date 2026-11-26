/*
 * 쿠팡 상품 분석기 - 페이지 정보 읽기 (content script)
 * 사용자가 보고 있는 쿠팡 화면에서 상품 정보를 읽어 팝업에 전달합니다.
 * 쿠팡은 화면 구조(클래스 이름)를 자주 바꾸므로, 클래스 이름에 의존하지 않는
 * "링크 + 글자 패턴" 방식을 기본으로 사용합니다.
 */
(function (root) {
  'use strict';

  function toNumber(text) {
    if (text == null) return null;
    const m = String(text).replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function cleanText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function productIdFromUrl(href) {
    const m = String(href || '').match(/\/vp\/products\/(\d+)/);
    return m ? m[1] : null;
  }

  function absoluteUrl(href, base) {
    try {
      return new URL(href, base || 'https://www.coupang.com').href;
    } catch (e) {
      return href;
    }
  }

  // 상품 카드 하나에서 판매가 찾기
  function extractPrice(card) {
    const direct = card.querySelector(
      '.price-value, [class*="price-value"], [class*="PriceValue"], [class*="sale-price"] strong'
    );
    if (direct && toNumber(direct.textContent)) return toNumber(direct.textContent);

    // 가격 영역만 대상으로 (적립금·쿠폰 금액이 섞이지 않도록)
    const scope = card.querySelector('[class*="PriceArea"], [class*="priceArea"], [class*="price-area"], [class*="price-wrap"]') || card;

    // 정가(취소선)와 단위가격( "(100g당 1,200원)" )은 빼고 "원" 금액 중 가장 작은 값을 판매가로 봄
    const clone = scope.cloneNode(true);
    clone.querySelectorAll('del, s, strike, img, [class*="base-price"], [class*="BasePrice"], [class*="unit-price"], [class*="UnitPrice"], [class*="origin-price"]')
      .forEach((el) => el.remove());
    const text = (clone.textContent || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/최대\s*[\d,]+\s*원\s*적립/g, ' ')
      .replace(/[\d,]+\s*원\s*(적립|할인|쿠폰|캐시)/g, ' ');
    const amounts = [];
    const re = /([\d]{1,3}(?:,\d{3})+|\d{3,})\s*원/g;
    let m;
    while ((m = re.exec(text))) {
      const n = toNumber(m[1]);
      if (n && n >= 100) amounts.push(n);
    }
    return amounts.length ? Math.min.apply(null, amounts) : null;
  }

  // 리뷰 수 찾기: "(1,234)" 형태
  function extractReviewCount(card) {
    const direct = card.querySelector(
      '.rating-total-count, [class*="rating-total-count"], [class*="RatingCount"], [class*="review-count"]'
    );
    if (direct) {
      const n = toNumber(direct.textContent);
      if (n != null) return n;
    }
    const text = card.textContent || '';
    const m = text.match(/\(\s*([\d,]+)\s*\)/);
    return m ? toNumber(m[1]) : 0;
  }

  // 별점 찾기: aria-label, 숫자, 또는 별 그림의 width(%)
  function extractRating(card) {
    // 2026년 쿠팡 화면: 별 묶음에 aria-label="4.5" 처럼 숫자만 들어 있음
    const arias = Array.from(card.querySelectorAll('[aria-label]'));
    for (const el of arias) {
      const v = (el.getAttribute('aria-label') || '').trim();
      if (/^\d(\.\d)?$/.test(v) && Number(v) <= 5) return Number(v);
      const m = v.match(/(?:별점|rating)[^\d]*(\d(?:\.\d)?)/i);
      if (m && Number(m[1]) <= 5) return Number(m[1]);
    }
    // 별 그림 개수로 계산 (꽉 찬 별 1, 반쪽 별 0.5)
    const full = card.querySelectorAll('[class*="fullRating"], [class*="full-star"]').length;
    const half = card.querySelectorAll('[class*="halfRating"], [class*="half-star"]').length;
    if (full + half > 0) return full + half * 0.5;
    const ratingEl = card.querySelector('em.rating, .rating, [class*="rating"]:not([class*="count"]):not([class*="Count"])');
    if (ratingEl) {
      const n = toNumber(ratingEl.textContent);
      if (n != null && n > 0 && n <= 5) return n;
      const style = ratingEl.getAttribute('style') || '';
      const w = style.match(/width\s*:\s*([\d.]+)%/);
      if (w) return Math.round((Number(w[1]) / 20) * 10) / 10;
    }
    const styled = card.querySelector('[class*="star"] [style*="width"], [class*="Star"] [style*="width"]');
    if (styled) {
      const w = (styled.getAttribute('style') || '').match(/width\s*:\s*([\d.]+)%/);
      if (w) return Math.round((Number(w[1]) / 20) * 10) / 10;
    }
    return null;
  }

  function extractName(card, link) {
    const el = card.querySelector('.name, [class*="productName"], [class*="ProductName"], [class*="product-name"], [class*="name"]');
    if (el && cleanText(el.textContent).length > 3) return cleanText(el.textContent);
    const img = card.querySelector('img[alt]');
    if (img && cleanText(img.getAttribute('alt')).length > 3) return cleanText(img.getAttribute('alt'));
    return cleanText(link.getAttribute('title') || link.textContent).slice(0, 120);
  }

  function extractDelivery(card) {
    const imgs = Array.from(card.querySelectorAll('img'));
    const srcs = imgs.map((i) => (i.getAttribute('src') || '') + ' ' + (i.getAttribute('alt') || '')).join(' ').toLowerCase();
    const text = card.textContent || '';
    if (/rocket[_-]?fresh|logo_fresh|로켓프레시/.test(srcs + text)) return '로켓프레시';
    if (/rocket[_-]?merchant|판매자로켓|로켓그로스/.test(srcs + text)) return '판매자로켓';
    if (/rocket[_-]?jikgu|로켓직구/.test(srcs + text)) return '로켓직구';
    if (/rocket|로켓배송/.test(srcs + text)) return '로켓배송';
    return '일반';
  }

  function isAd(card, link) {
    const href = (link && link.getAttribute('href')) || '';
    if (/sourceType=srp_product_ads|_ads(&|$)/.test(href)) return true;
    if (card.querySelector('[aria-label="Ad information"], .ad-badge, [class*="ad-badge"], [class*="AdMark"], [class*="adMark"]')) return true;
    // 글자가 정확히 "광고"인 요소
    return Array.from(card.querySelectorAll('span, div, em')).some((el) => el.children.length === 0 && cleanText(el.textContent) === '광고');
  }

  function rankFromHref(href) {
    const m = String(href || '').match(/[?&]rank=(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // 검색 결과 페이지 읽기
  function scrapeSearch(doc, pageUrl) {
    doc = doc || document;
    pageUrl = pageUrl || (doc.location && doc.location.href) || '';
    let keyword = '';
    let page = 1;
    try {
      const u = new URL(pageUrl);
      keyword = u.searchParams.get('q') || '';
      page = Number(u.searchParams.get('page') || 1);
    } catch (e) { /* ignore */ }

    const links = Array.from(doc.querySelectorAll('a[href*="/vp/products/"]'));
    const seen = new Set();
    const items = [];
    links.forEach((a) => {
      const id = productIdFromUrl(a.getAttribute('href'));
      if (!id || seen.has(id)) return;
      const card = a.closest('li') || a.closest('article') || a.parentElement || a;
      // 카드 안에 가격이 없으면 상품 카드가 아님 (추천 배너 등)
      const price = extractPrice(card);
      if (!price) return;
      seen.add(id);
      items.push({
        id,
        name: extractName(card, a),
        price,
        reviewCount: extractReviewCount(card),
        rating: extractRating(card),
        delivery: extractDelivery(card),
        ad: isAd(card, a),
        hrefRank: rankFromHref(a.getAttribute('href')),
        url: absoluteUrl(a.getAttribute('href'), pageUrl).split('?')[0],
        image: (card.querySelector('img') && (card.querySelector('img').getAttribute('src') || card.querySelector('img').getAttribute('data-src'))) || ''
      });
    });
    // 순위: 쿠팡 링크에 들어 있는 rank 값을 우선 사용, 없으면 화면 순서(광고 제외)로 계산
    const perPage = 60;
    let pos = 0;
    items.forEach((it) => {
      if (it.ad) { it.rank = null; }
      else { pos += 1; it.rank = it.hrefRank || ((page - 1) * perPage + pos); }
      delete it.hrefRank;
    });
    return { type: 'search', keyword, page, url: pageUrl, items };
  }

  // 상품 상세 페이지 읽기 (리뷰 포함)
  function scrapeProduct(doc, pageUrl) {
    doc = doc || document;
    pageUrl = pageUrl || (doc.location && doc.location.href) || '';
    const id = productIdFromUrl(pageUrl);
    const titleEl = doc.querySelector('h1.product-title, .prod-buy-header__title, h1[class*="title"], h1');
    const og = doc.querySelector('meta[property="og:title"]');
    const name = cleanText((titleEl && titleEl.textContent) || (og && og.getAttribute('content')) || doc.title);

    // 판매가: 가격 영역에서 정가(취소선)·단위가격을 빼고 첫 번째 금액
    let price = null;
    const priceBox = doc.querySelector('.price-container, .prod-price-container, .prod-sale-price');
    if (priceBox) {
      const clone = priceBox.cloneNode(true);
      clone.querySelectorAll('del, s, [class*="origin-price"], [class*="base-price"], [class*="unit-price"]').forEach((e) => e.remove());
      const m = (clone.textContent || '').replace(/\([^)]*\)/g, ' ').match(/([\d]{1,3}(?:,\d{3})+|\d{3,})\s*원/);
      if (m) price = toNumber(m[1]);
    }
    if (!price) {
      const priceEl = doc.querySelector('.total-price strong, [class*="final-price"], [class*="price-amount"]');
      price = priceEl ? toNumber(priceEl.textContent) : null;
    }

    const countEl = doc.querySelector('.rating-count-txt, .sdp-review__average__total-star__info-count, .count, [class*="review-count"], [class*="ReviewCount"]');
    const reviewCount = countEl ? toNumber(countEl.textContent) : null;

    const reviews = [];
    const seen = new Set();
    const push = (text, star, title) => {
      const t = cleanText(text);
      if (t.length >= 5 && !seen.has(t)) {
        seen.add(t);
        reviews.push({ text: (title ? '[' + cleanText(title) + '] ' : '') + t.slice(0, 1000), star });
      }
    };
    const starOf = (art) => {
      if (!art) return null;
      const full = art.querySelectorAll('[class*="full-star"], [class*="fullRating"]').length;
      const half = art.querySelectorAll('[class*="half-star"], [class*="halfRating"]').length;
      if (full + half) return full + half * 0.5;
      const s = art.querySelector('[data-rating]');
      return s ? toNumber(s.getAttribute('data-rating')) : null;
    };

    // 2026년 화면: 리뷰 영역(.sdp-review / .product-review) 안의 article, 본문은 span[translate="no"]
    const reviewArea = doc.querySelector('.sdp-review, .product-review, #sdpReview') || doc;
    reviewArea.querySelectorAll('article').forEach((art) => {
      const body = art.querySelector('span[translate="no"], .sdp-review__article__list__review__content, [class*="review__content"]');
      if (!body) return;
      const titleEl2 = art.querySelector('.sdp-review__article__list__headline, [class*="headline"]') ||
        (body.closest('div') && body.closest('div').previousElementSibling);
      const title = titleEl2 && titleEl2.className && /font-bold|headline/.test(titleEl2.className) ? titleEl2.textContent : '';
      push(body.innerText || body.textContent, starOf(art), title);
    });
    // 예전 화면 대비
    if (!reviews.length) {
      doc.querySelectorAll('.sdp-review__article__list__review__content, [class*="ReviewContent"], [class*="review-content"]').forEach((n) => {
        push(n.textContent, starOf(n.closest('article')), '');
      });
    }
    return { type: 'product', id, name, price, reviewCount, url: pageUrl.split('?')[0], reviews };
  }

  // ---------- 네이버쇼핑 검색 결과 ----------
  const NAVER_PRODUCT_RE = /(smartstore\.naver\.com\/[^/?#]+\/products\/\d+|brand\.naver\.com\/[^/?#]+\/products\/\d+|shopping\.naver\.com\/(catalog|window-products|ns\/products|outlink)|cr\.shopping\.naver\.com|adcr\.naver\.com|\/catalog\/\d+|nv_mid=\d+|nvMid=\d+)/;

  function naverKey(href) {
    const s = String(href || '');
    const m = s.match(/(?:nv_mid|nvMid|catalog\/|products\/)(\d{5,})/);
    return m ? m[1] : s.split('?')[0];
  }

  function koNumber(str) {
    // "1.2만" → 12000, "3,456" → 3456
    if (!str) return null;
    const m = String(str).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(만)?/);
    if (!m) return null;
    return Math.round(Number(m[1]) * (m[2] ? 10000 : 1));
  }

  function naverCard(a) {
    // 링크에서 위로 올라가며 "가격이 들어 있고, 다른 상품은 섞이지 않은" 가장 큰 상자를 상품 카드로 봄
    const key = naverKey(a.getAttribute('href'));
    let el = a;
    let best = null;
    for (let i = 0; i < 8 && el && el.parentElement; i++) {
      el = el.parentElement;
      if (el.tagName === 'BODY') break;
      const keys = new Set(Array.from(el.querySelectorAll('a[href]'))
        .map((x) => x.getAttribute('href')).filter((h) => NAVER_PRODUCT_RE.test(h)).map(naverKey));
      if (keys.size > 1 || (keys.size === 1 && !keys.has(key))) break;
      if (/[\d,]{3,}\s*원/.test(el.textContent || '')) best = el;
    }
    return best;
  }

  function naverPrice(card) {
    const t = (card.textContent || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/배송비\s*[\d,]+\s*원/g, ' ')
      .replace(/[\d,]+\s*원\s*(적립|할인|쿠폰|이상)/g, ' ')
      .replace(/최대\s*[\d,]+\s*원/g, ' ');
    // 취소선(정가) 제거 후 첫 번째 금액
    const clone = card.cloneNode(true);
    clone.querySelectorAll('del, s, strike').forEach((e) => e.remove());
    const t2 = (clone.textContent || '').replace(/\([^)]*\)/g, ' ').replace(/배송비\s*[\d,]+\s*원/g, ' ')
      .replace(/[\d,]+\s*원\s*(적립|할인|쿠폰|이상)/g, ' ').replace(/최대\s*[\d,]+\s*원/g, ' ');
    const m = t2.match(/([\d]{1,3}(?:,\d{3})+|\d{3,})\s*원/) || t.match(/([\d]{1,3}(?:,\d{3})+|\d{3,})\s*원/);
    return m ? toNumber(m[1]) : null;
  }

  function scrapeNaver(doc, pageUrl) {
    doc = doc || document;
    pageUrl = pageUrl || (doc.location && doc.location.href) || '';
    let keyword = '';
    let page = 1;
    try {
      const u = new URL(pageUrl);
      keyword = u.searchParams.get('query') || u.searchParams.get('q') || '';
      page = Number(u.searchParams.get('pagingIndex') || u.searchParams.get('page') || 1);
    } catch (e) { /* ignore */ }

    const seen = new Set();
    const items = [];
    Array.from(doc.querySelectorAll('a[href]')).forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!NAVER_PRODUCT_RE.test(href)) return;
      const key = naverKey(href);
      if (seen.has(key)) return;
      const card = naverCard(a);
      if (!card) return;
      const price = naverPrice(card);
      if (!price) return;
      seen.add(key);
      const text = cleanText(card.textContent);

      // 상품명: 카드 안 링크 중 글자가 가장 긴 것 → 이미지 설명
      const linkTexts = Array.from(card.querySelectorAll('a[href]'))
        .filter((x) => NAVER_PRODUCT_RE.test(x.getAttribute('href') || ''))
        .map((x) => cleanText(x.getAttribute('title') || x.textContent))
        .filter((s) => s.length >= 4 && !/^[\d,]+\s*원$/.test(s));
      linkTexts.sort((p, q) => q.length - p.length);
      const img = card.querySelector('img[alt]');
      const name = (linkTexts[0] || (img && cleanText(img.getAttribute('alt'))) || '').slice(0, 150);

      const rv = text.match(/리뷰\s*\(?\s*([\d,.]+\s*만?)/);
      const buy = text.match(/구매\s*([\d,.]+\s*만?)/);
      const star = text.match(/(?:별점|평점|★)\s*([0-5](?:\.\d+)?)/);
      const mallEl = card.querySelector('[class*="mall" i] a, [class*="mall_title" i], [class*="mallName" i], [class*="store" i] a');
      const ad = /adcr\.naver\.com|cr\.shopping\.naver\.com\/adcr|ad\.search\.naver/.test(href) ||
        Array.from(card.querySelectorAll('span, em, i, button')).some((e) => e.children.length === 0 && cleanText(e.textContent) === '광고');
      let delivery = '일반';
      if (/도착보장/.test(text)) delivery = '도착보장';
      else if (/오늘출발/.test(text)) delivery = '오늘출발';
      else if (/무료배송/.test(text)) delivery = '무료배송';

      items.push({
        id: key,
        source: 'naver',
        name,
        price,
        reviewCount: rv ? koNumber(rv[1]) : 0,
        purchaseCount: buy ? koNumber(buy[1]) : null,
        rating: star ? Number(star[1]) : null,
        mall: mallEl ? cleanText(mallEl.textContent).slice(0, 40) : '',
        delivery,
        ad,
        url: absoluteUrl(href, pageUrl),
        image: (img && (img.getAttribute('src') || img.getAttribute('data-src'))) || ''
      });
    });
    let pos = 0;
    items.forEach((it) => { if (it.ad) it.rank = null; else { pos += 1; it.rank = (page - 1) * 40 + pos; } });
    return { type: 'search', source: 'naver', keyword, page, url: pageUrl, items };
  }

  function scrapeCurrent() {
    const url = location.href;
    if (/shopping\.naver\.com/.test(url)) return scrapeNaver(document, url);
    if (/\/np\/search/.test(url)) return scrapeSearch(document, url);
    if (/\/vp\/products\//.test(url)) return scrapeProduct(document, url);
    return { type: 'unknown', url };
  }

  const api = { scrapeSearch, scrapeProduct, scrapeNaver, koNumber, extractPrice, extractReviewCount, extractRating, toNumber, productIdFromUrl };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (!root.__coupangAnalyzerLoaded) {
    root.__coupangAnalyzerLoaded = true;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'scrape') {
        try {
          sendResponse({ ok: true, data: scrapeCurrent() });
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
      }
      return true;
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
