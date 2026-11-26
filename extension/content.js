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
  const NAVER_PRODUCT_RE = /(smartstore\.naver\.com\/[^/?#]+\/products\/\d+|smartstore\.naver\.com\/inflow|brand\.naver\.com\/[^/?#]+\/products\/\d+|brand\.naver\.com\/inflow|shopping\.naver\.com\/(catalog|window-products|ns\/products|outlink|bridge|product)|cr\d*\.shopping\.naver\.com|adcr\.naver\.com|ader\.naver\.com\/v\d|\/catalog\/\d+|nv_mid=\d+|nvMid=\d+|nvmid=\d+)/i;

  function naverKeyOf(a) {
    const p = a.getAttribute('data-nlog-params') || '';
    const m = p.match(/nv_mid[^\d]{0,12}(\d{5,})/);
    return m ? m[1] : naverKey(a.getAttribute('href'));
  }

  function naverKey(href) {
    const s = String(href || '');
    const m = s.match(/(?:nv_mid|nvMid|catalog\/|products\/)(\d{5,})/);
    return m ? m[1] : s.split('?')[0];
  }

  function koNumber(str) {
    // "1.2만" → 12000, "3,456" → 3456
    if (!str) return null;
    const m = String(str).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(만|천)?/);
    if (!m) return null;
    return Math.round(Number(m[1]) * (m[2] === '만' ? 10000 : m[2] === '천' ? 1000 : 1));
  }

  // 상품 제목 링크(글자가 긴 링크)를 기준으로 위로 올라가며, 다른 상품 제목이 섞이기 직전까지의 상자 중
  // 가격이 들어 있는 가장 큰 것을 상품 카드로 봄 (한 카드에 사진·제목·판매처 링크 주소가 달라도 됨)
  function linkTitle(x) {
    const t = cleanText(x.getAttribute('title') || x.textContent);
    return /^새\s*창에서\s*열림$/.test(t) ? '' : t.replace(/\s*새\s*창에서\s*열림$/, '');
  }
  function isTitleLink(x) {
    const area = x.getAttribute('data-nlog-area') || '';
    // 네이버가 붙여 둔 표시: ...tit(제목) / ...img(사진) / ...mall(판매처)
    if (/\.(img|mall|info|desc|description|url|favicon|sublink\d*|checkout)$/.test(area)) return false;
    const t = linkTitle(x);
    if (/\.tit$/.test(area) && t.length >= 4) return true;
    return t.length >= 8 && !/^[\d,]+\s*원$/.test(t) && NAVER_PRODUCT_RE.test(x.getAttribute('href') || '');
  }
  function naverCard(a) {
    const title = linkTitle(a);
    let el = a;
    // 링크 자체가 상품 상자인 경우(광고 영역의 상품 카드 등)
    let best = /[\d,]{3,}\s*원/.test(a.textContent || '') ? a : null;
    for (let i = 0; i < 9 && el && el.parentElement; i++) {
      el = el.parentElement;
      if (el.tagName === 'BODY') break;
      const others = Array.from(el.querySelectorAll('a[href]')).filter((x) => isTitleLink(x) && linkTitle(x) !== title);
      if (others.length) break;
      if (/[\d,]{3,}\s*원/.test(el.textContent || '')) best = el;
    }
    return best;
  }

  function naverPrice(card) {
    const t = (card.textContent || '')
      .replace(/할인\s*전\s*판매가\s*[\d,]+\s*원/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/배송비\s*[\d,]+\s*원/g, ' ')
      .replace(/[\d,]+\s*원\s*(적립|할인|쿠폰|이상)/g, ' ')
      .replace(/최대\s*[\d,]+\s*원/g, ' ');
    // 취소선(정가) 제거 후 첫 번째 금액
    const clone = card.cloneNode(true);
    clone.querySelectorAll('del, s, strike').forEach((e) => e.remove());
    const t2 = (clone.innerText || clone.textContent || '').replace(/\([^)]*\)/g, ' ').replace(/배송비\s*[\d,]+\s*원/g, ' ')
      .replace(/할인\s*전\s*판매가\s*[\d,]+\s*원/g, ' ').replace(/정가\s*[\d,]+\s*원/g, ' ')
      .replace(/[\d,]+\s*원\s*(적립|할인|쿠폰|이상)/g, ' ').replace(/최대\s*[\d,]+\s*원/g, ' ');
    const m = t2.match(/([\d]{1,3}(?:,\d{3})+|\d{3,})\s*원/) || t.match(/([\d]{1,3}(?:,\d{3})+|\d{3,})\s*원/);
    return m ? toNumber(m[1]) : null;
  }

  // 판매처 이름: 카드 안 짧은 글자 중 가격·리뷰·배송 같은 안내 문구가 아닌 마지막 것
  const NAVER_NOISE_RE = /(원|리뷰|구매|찜|배송|할인|광고|도착|쿠폰|포인트|적립|공식|N배송|무료|판매가|%|최대|멤버십|오늘|내일|모레|반품|교환|정보|더보기|공유|별점|평점|★|^\d|^\(|네이버|페이|플러스|슈퍼|특가|김장대전|오늘끝딜|이벤트|쇼핑몰|판매처|선택|등록일|카테고리|신고|비교|최저|최고|정렬|브랜드|제조사)/;
  function naverMallName(card, name) {
    const leaves = Array.from(card.querySelectorAll('*')).filter((el) => el.children.length === 0);
    const cands = leaves.map((el) => cleanText(el.textContent))
      .filter((t) => t.length >= 2 && t.length <= 20 && !NAVER_NOISE_RE.test(t) && (!name || name.indexOf(t) < 0 || t.length >= name.length));
    return cands.length ? cands[cands.length - 1] : '';
  }

  // 네이버쇼핑 탭(search.shopping.naver.com/ns/search) 전용: 2026-11 실제 화면 구조
  // 카드 = basicProductCard, 상품명 = productCardTitle, 판매처 = mall_name, 가격 = priceTag_price
  function naverShopCards(doc, pageUrl) {
    const cards = Array.from(doc.querySelectorAll('[class*="basicProductCard_basic_product_card__"], [class*="product_item__"], [class*="adProduct_item__"]'))
      .filter((c) => !c.parentElement || !c.parentElement.closest('[class*="basicProductCard_basic_product_card__"]'));
    const out = [];
    const seen = new Set();
    cards.forEach((card) => {
      const titleEl = card.querySelector('[class*="productCardTitle"], [class*="product_title"], [class*="adProduct_title"]');
      const name = titleEl ? cleanText(titleEl.textContent) : '';
      if (!name) return;
      const link = card.querySelector('a[class*="basicProductCard_link"], a[class*="product_link"], a[href*="/products/"], a[href]');
      const href = link ? link.getAttribute('href') || '' : '';
      const params = link ? (link.getAttribute('data-nlog-params') || '') : '';
      const priceEl = card.querySelector('[class*="priceTag_price__"], [class*="price_num"], [class*="price"] em');
      const price = (priceEl && toNumber(priceEl.textContent)) || naverPrice(card);
      if (!price) return;
      const infoId = (card.querySelector('[id^="basic_product_card_information_"]') || card).id || '';
      const id = (href.match(/products\/(\d+)/) || infoId.match(/(\d{5,})/) || params.match(/nv_mid[^\d]{0,12}(\d{5,})/) || [])[1] || name + '|' + price;
      if (seen.has(id)) return;
      seen.add(id);
      const mallEl = card.querySelector('[class*="mall_name"], [class*="mallName"], [class*="mall_title"]');
      const st = naverStats(card);
      const isAd = /"is_ad"\s*:\s*true/.test(params) || /ader\.naver\.com|adcr\.naver\.com/.test(href) ||
        Array.from(card.querySelectorAll('.blind, [class*="ad_badge"]')).some((e) => cleanText(e.textContent) === '광고');
      const text = cleanText(card.textContent);
      let delivery = '일반';
      if (/N배송/.test(text)) delivery = 'N배송';
      else if (/도착보장/.test(text)) delivery = '도착보장';
      else if (/오늘출발/.test(text)) delivery = '오늘출발';
      else if (/무료배송/.test(text)) delivery = '무료배송';
      const img = card.querySelector('img');
      out.push({
        id, source: 'naver', name: name.slice(0, 150), price,
        reviewCount: st.reviewCount, purchaseCount: st.purchaseCount, rating: st.rating,
        mall: mallEl ? cleanText(mallEl.textContent).slice(0, 40) : '',
        delivery, ad: isAd,
        url: href ? absoluteUrl(href, pageUrl) : '',
        image: (img && (img.getAttribute('src') || img.getAttribute('data-src'))) || ''
      });
    });
    return out;
  }

  // 별점·리뷰·구매 수 (여러 표시 형식)
  function naverStats(card) {
    const raw = card.innerText || card.textContent || '';
    let rv = raw.match(/리뷰\s*\(?\s*([\d,.]+\s*[만천]?)/);
    const buy = raw.match(/구매\s*([\d,.]+\s*[만천]?)/);
    let star = raw.match(/(?:별점|평점|★)\s*([0-5](?:\.\d+)?)/);
    const lv = Array.from(card.querySelectorAll('*')).filter((x) => x.children.length === 0)
      .map((x) => cleanText(x.textContent)).filter(Boolean);
    for (let k = 0; k < lv.length - 1; k++) {
      if (/^(별점\s*)?[0-5]\.\d{1,2}$/.test(lv[k]) && /^(리뷰\s*)?\(?\s*[\d,]+(\.\d+)?\s*[만천]?\+?\s*\)?$/.test(lv[k + 1])) {
        star = [null, lv[k].replace(/[^\d.]/g, '')];
        rv = [null, lv[k + 1].replace(/[()리뷰\s]/g, '')];
        break;
      }
    }
    return {
      rating: star ? Number(star[1]) : null,
      reviewCount: rv ? koNumber(rv[1]) : 0,
      purchaseCount: buy ? koNumber(buy[1]) : null
    };
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
    const shop = naverShopCards(doc, pageUrl);
    if (shop.length >= 3) {
      let p2 = 0;
      shop.forEach((it) => { if (it.ad) it.rank = null; else { p2 += 1; it.rank = (page - 1) * 40 + p2; } });
      return { type: 'search', source: 'naver', keyword, page, url: pageUrl, items: shop };
    }
    const items = [];
    const seenCards = new Set();
    const seenNames = new Map();
    Array.from(doc.querySelectorAll('a[href]')).filter(isTitleLink).forEach((a) => {
      const href = a.getAttribute('href') || '';
      const key = naverKeyOf(a);
      if (seen.has(key)) return;
      const card = naverCard(a);
      if (!card || seenCards.has(card)) return;
      seenCards.add(card);
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
      // 링크 안에 가격까지 들어 있으면(광고 상자) 상품명 칸만, 없으면 가격 앞 글자까지
      const prodEl = a.querySelector('[class*="product" i], [class*="tit" i], [class*="name" i]');
      let name = prodEl ? cleanText(prodEl.textContent) : linkTitle(a);
      if (/[\d,]{3,}\s*원/.test(name)) name = name.split(/[\d,]{3,}\s*원/)[0].trim();
      name = (name || linkTexts[0] || (img && cleanText(img.getAttribute('alt'))) || '').slice(0, 150);
      const dupKey = name.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '') + '|' + price;

      const raw = card.innerText || card.textContent || '';
      let rv = raw.match(/리뷰\s*\(?\s*([\d,.]+\s*[만천]?)/);
      const buy = raw.match(/구매\s*([\d,.]+\s*[만천]?)/);
      let star = raw.match(/(?:별점|평점|★)\s*([0-5](?:\.\d+)?)/);
      // 통합검색·플러스스토어 형식: "4.78 (6,701)" 처럼 별점 바로 뒤에 리뷰 수
      const pair = raw.match(/(?:^|[^\d.,])([0-5]\.\d{1,2})\s*[\n\s]\s*\(?\s*([\d,]+(?:\.\d+)?\s*만?)\s*\)?/) ||
        raw.match(/(?:^|[^\d.,])([0-5]\.\d{1,2})\s*\(\s*([\d,]+(?:\.\d+)?\s*만?)\s*\)/);
      if (pair) {
        if (!star) star = [null, pair[1]];
        if (!rv) rv = [null, pair[2]];
      }
      // 별점과 리뷰 수가 따로 떨어진 글자 조각일 때: "4.67" 다음 조각 "9,822" 또는 "(9,822)"
      const lv = Array.from(card.querySelectorAll('*')).filter((x) => x.children.length === 0)
        .map((x) => cleanText(x.textContent)).filter(Boolean);
      for (let k = 0; k < lv.length - 1; k++) {
        if (/^[0-5]\.\d{1,2}$/.test(lv[k]) && /^\(?\s*[\d,]+(\.\d+)?\s*만?\+?\s*\)?$/.test(lv[k + 1])) {
          star = [null, lv[k]];
          rv = [null, lv[k + 1].replace(/[()]/g, '')];
          break;
        }
      }
      const mallEl = card.querySelector('a[data-nlog-area$=".mall"], [class*="mall" i] a, [class*="mall_title" i], [class*="mallName" i], [class*="store" i] a');
      const ad = /adcr\.naver\.com|ader\.naver\.com|cr\d*\.shopping\.naver\.com\/adcr|ad\.search\.naver/.test(href) ||
        Array.from(card.querySelectorAll('span, em, i, button')).some((e) => e.children.length === 0 && cleanText(e.textContent) === '광고');
      let delivery = '일반';
      if (/N배송/.test(text)) delivery = 'N배송';
      else if (/도착보장/.test(text)) delivery = '도착보장';
      else if (/오늘출발/.test(text)) delivery = '오늘출발';
      else if (/무료배송/.test(text)) delivery = '무료배송';

      const it = {
        id: key,
        source: 'naver',
        name,
        price,
        reviewCount: rv ? koNumber(rv[1]) : 0,
        purchaseCount: buy ? koNumber(buy[1]) : null,
        rating: star ? Number(star[1]) : null,
        mall: ((mallEl && !NAVER_NOISE_RE.test(cleanText(mallEl.textContent))) ? cleanText(mallEl.textContent).slice(0, 40) : '') || naverMallName(card, name) ||
          (((href.match(/(?:smartstore|brand)\.naver\.com\/([^/?#]+)/) || [])[1] || '').replace(/^(main|m|i)$/, '')),
        delivery,
        ad,
        url: absoluteUrl(href, pageUrl),
        image: (img && (img.getAttribute('src') || img.getAttribute('data-src'))) || ''
      };
      // 같은 상품이 광고 상자와 목록에 두 번 나오면 하나로 합침 (빈 칸은 서로 채움)
      const prev = seenNames.get(dupKey);
      if (prev) {
        ['mall', 'purchaseCount', 'rating', 'reviewCount', 'image'].forEach((f) => { if (!prev[f] && it[f]) prev[f] = it[f]; });
        if (prev.delivery === '일반' && it.delivery !== '일반') prev.delivery = it.delivery;
        prev.ad = prev.ad && it.ad;
        return;
      }
      seenNames.set(dupKey, it);
      items.push(it);
    });
    let pos = 0;
    items.forEach((it) => { if (it.ad) it.rank = null; else { pos += 1; it.rank = (page - 1) * 40 + pos; } });
    return { type: 'search', source: 'naver', keyword, page, url: pageUrl, items };
  }

  // 오류 신고용: 상품 카드 몇 개의 화면 구조(개인정보 없는 HTML 뼈대)를 복사
  function debugDump(doc) {
    doc = doc || document;
    const priceRe = /[\d,]{3,}\s*원/;
    const hostCount = {};
    const byHost = {};
    Array.from(doc.querySelectorAll('a[href]')).forEach((a) => {
      let el = a;
      for (let i = 0; i < 7 && el.parentElement; i++) {
        el = el.parentElement;
        const t = el.textContent || '';
        if (priceRe.test(t) && t.length < 600) {
          const h = (a.getAttribute('href') || '').replace(/^https?:\/\//, '').split(/[?#]/)[0].split('/').slice(0, 2).join('/');
          hostCount[h] = (hostCount[h] || 0) + 1;
          (byHost[h] = byHost[h] || []);
          if (byHost[h].length < 2 && byHost[h].indexOf(el) < 0) byHost[h].push(el);
          break;
        }
      }
    });
    // 링크 종류마다 카드 1~2개씩 (광고만 잔뜩 복사되지 않게, 드문 종류부터)
    const hosts = Object.keys(byHost).sort((x, y) => hostCount[x] - hostCount[y]);
    const cards = [];
    hosts.forEach((h) => byHost[h].slice(0, hosts.length > 4 ? 1 : 2).forEach((el) => { if (cards.indexOf(el) < 0 && cards.length < 8) cards.push(el); }));
    const clean = (el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll('script,style,svg,noscript').forEach((x) => x.remove());
      c.querySelectorAll('*').forEach((x) => {
        Array.from(x.attributes).forEach((at) => {
          if (at.name === 'href') x.setAttribute('href', at.value.split('?')[0].slice(0, 120));
          else if (!/^(class|aria-label|title|alt|data-nlog-area|data-nlog-params)$/.test(at.name)) x.removeAttribute(at.name);
          else if (at.value.length > 120) x.setAttribute(at.name, at.value.slice(0, 120));
        });
      });
      return c.outerHTML.replace(/\s{2,}/g, ' ');
    };
    const body = cards.map((c, i) => `--- 카드 ${i + 1} ---\n` + clean(c).slice(0, 2500)).join('\n').slice(0, 16000);
    return `[화면 구조] ${((doc.location && doc.location.href) || "").split('?')[0]}\n링크 종류: ${JSON.stringify(hostCount)}\n${body}`;
  }

  function scrapeCurrent() {
    const url = location.href;
    if (/shopping\.naver\.com|search\.naver\.com/.test(url)) return scrapeNaver(document, url);
    if (/\/np\/search/.test(url)) return scrapeSearch(document, url);
    if (/\/vp\/products\//.test(url)) return scrapeProduct(document, url);
    return { type: 'unknown', url };
  }

  const api = { scrapeSearch, scrapeProduct, scrapeNaver, naverShopCards, koNumber, naverMallName, debugDump, extractPrice, extractReviewCount, extractRating, toNumber, productIdFromUrl };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (!root.__coupangAnalyzerLoaded) {
    root.__coupangAnalyzerLoaded = true;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'debug') {
        try { sendResponse({ ok: true, data: debugDump(document) }); } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        return true;
      }
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
