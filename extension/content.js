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

    // 정가(취소선)와 단위가격( "(100g당 1,200원)" )은 빼고 "원" 금액 중 가장 작은 값을 판매가로 봄
    const clone = card.cloneNode(true);
    clone.querySelectorAll('del, s, strike, [class*="base-price"], [class*="BasePrice"], [class*="unit-price"], [class*="UnitPrice"]')
      .forEach((el) => el.remove());
    const text = (clone.textContent || '').replace(/\([^)]*\)/g, ' ');
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
    const aria = card.querySelector('[aria-label*="별점"], [aria-label*="rating" i]');
    if (aria) {
      const n = toNumber(aria.getAttribute('aria-label'));
      if (n != null && n <= 5) return n;
    }
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
    if (/rocket[_-]?fresh|로켓프레시/.test(srcs + text)) return '로켓프레시';
    if (/rocket[_-]?merchant|판매자로켓|로켓그로스/.test(srcs + text)) return '판매자로켓';
    if (/rocket[_-]?jikgu|로켓직구/.test(srcs + text)) return '로켓직구';
    if (/rocket|로켓배송/.test(srcs + text)) return '로켓배송';
    return '일반';
  }

  function isAd(card) {
    if (card.querySelector('.ad-badge, [class*="ad-badge"], [class*="AdMark"], [class*="adMark"]')) return true;
    return /(^|\s)광고(\s|$)/.test(card.textContent || '');
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
        ad: isAd(card),
        url: absoluteUrl(a.getAttribute('href'), pageUrl).split('?')[0],
        image: (card.querySelector('img') && (card.querySelector('img').getAttribute('src') || card.querySelector('img').getAttribute('data-src'))) || ''
      });
    });
    const offset = (page - 1) * 36;
    items.forEach((it, i) => { it.rank = offset + i + 1; });
    return { type: 'search', keyword, page, url: pageUrl, items };
  }

  // 상품 상세 페이지 읽기 (리뷰 포함)
  function scrapeProduct(doc, pageUrl) {
    doc = doc || document;
    pageUrl = pageUrl || (doc.location && doc.location.href) || '';
    const id = productIdFromUrl(pageUrl);
    const titleEl = doc.querySelector('.prod-buy-header__title, h1[class*="title"], h1, h2.prod-buy-header__title');
    const og = doc.querySelector('meta[property="og:title"]');
    const name = cleanText((titleEl && titleEl.textContent) || (og && og.getAttribute('content')) || doc.title);

    const priceEl = doc.querySelector('.total-price strong, [class*="final-price"], [class*="FinalPrice"], .prod-sale-price .total-price, [class*="price-amount"]');
    const price = priceEl ? toNumber(priceEl.textContent) : null;

    const countEl = doc.querySelector('.count, .sdp-review__average__total-star__info-count, [class*="review-count"], [class*="ReviewCount"]');
    const reviewCount = countEl ? toNumber(countEl.textContent) : null;

    const reviewNodes = doc.querySelectorAll(
      '.sdp-review__article__list__review__content, [class*="review__content"], [class*="ReviewContent"], [class*="review-content"], article [class*="review"] [class*="content"]'
    );
    const reviews = [];
    const seen = new Set();
    reviewNodes.forEach((n) => {
      const t = cleanText(n.textContent);
      if (t.length >= 5 && !seen.has(t)) {
        seen.add(t);
        // 해당 리뷰의 별점 (있으면)
        const art = n.closest('article') || n.parentElement;
        let star = null;
        if (art) {
          const s = art.querySelector('[data-rating], [class*="star-orange"], [class*="rating"]');
          if (s) star = toNumber(s.getAttribute('data-rating')) || null;
        }
        reviews.push({ text: t.slice(0, 1000), star });
      }
    });
    return { type: 'product', id, name, price, reviewCount, url: pageUrl.split('?')[0], reviews };
  }

  function scrapeCurrent() {
    const url = location.href;
    if (/\/np\/search/.test(url)) return scrapeSearch(document, url);
    if (/\/vp\/products\//.test(url)) return scrapeProduct(document, url);
    return { type: 'unknown', url };
  }

  const api = { scrapeSearch, scrapeProduct, extractPrice, extractReviewCount, extractRating, toNumber, productIdFromUrl };

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
