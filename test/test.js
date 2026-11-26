// 쿠팡 화면 구조(옛 버전 / 새 버전)를 흉내 낸 샘플로 수집·분석 로직을 검사합니다.
// 실행: npm test
const { JSDOM } = require('jsdom');
const assert = require('assert');
const C = require('../extension/content.js');
const A = require('../extension/analysis.js');

const oldLayout = `
<ul id="productList">
  <li class="search-product">
    <a href="/vp/products/111?itemId=1"><dl>
      <dt><img src="//thumb/1.jpg" alt="국산 볶음 차조 1kg"></dt>
      <dd><div class="name">국산 볶음 차조 1kg</div>
        <div class="price"><del class="base-price">15,900</del>
          <strong class="price-value">12,900</strong>원
          <span class="unit-price">(100g당 1,290원)</span></div>
        <img src="//image/badges/rocket/logo_rocket_large.png" alt="로켓배송">
        <div class="rating-star"><em class="rating">4.5</em><span class="rating-total-count">(1,234)</span></div>
      </dd></dl></a>
  </li>
  <li class="search-product search-product__ad-badge">
    <a href="/vp/products/222"><div class="name">해남 차조 500g</div>
      <strong class="price-value">8,500</strong>원 <span class="ad-badge">광고</span>
      <span class="rating-total-count">(56)</span></a>
  </li>
  <li class="search-product">
    <a href="/vp/products/333"><div class="name">찰조 2kg 대용량</div>
      <strong class="price-value">23,000</strong>원
      <img src="//image/rocket-merchant/logo.png" alt="판매자로켓">
      <span class="rating-total-count">(8,900)</span></a>
  </li>
  <li><a href="/vp/products/444">가격 없는 배너</a></li>
</ul>`;

// 새 화면: 클래스 이름이 해시로 바뀐 경우 (클래스에 의존하지 않고 글자 패턴으로 읽는지 확인)
const newLayout = `
<ul>
  <li class="ProductUnit_productUnit__Qd6sv">
    <a href="https://www.coupang.com/vp/products/555?vendorItemId=9">
      <figure><img src="https://thumb/5.jpg" alt="유기농 차조 800g"></figure>
      <div class="ProductUnit_productName__gre7e">유기농 차조 800g</div>
      <div class="PriceArea_x1"><del>19,800원</del><div>16,500원</div><div>(100g당 2,063원)</div></div>
      <div class="ProductRating_star__RGSlV"><div style="width: 90%"></div></div>
      <span class="ProductRating_ratingCount__R0Vhz">(312)</span>
    </a>
  </li>
</ul>`;

function dom(html, url) {
  return new JSDOM(html, { url }).window.document;
}

// 1) 옛 화면
let r = C.scrapeSearch(dom(oldLayout, 'https://www.coupang.com/np/search?q=%EC%B0%A8%EC%A1%B0&page=1'));
assert.strictEqual(r.keyword, '차조');
assert.strictEqual(r.items.length, 3, '가격 없는 배너는 빠져야 함');
assert.deepStrictEqual(r.items.map((i) => i.price), [12900, 8500, 23000]);
assert.deepStrictEqual(r.items.map((i) => i.reviewCount), [1234, 56, 8900]);
assert.strictEqual(r.items[0].rating, 4.5);
assert.strictEqual(r.items[0].delivery, '로켓배송');
assert.strictEqual(r.items[1].ad, true);
assert.strictEqual(r.items[2].delivery, '판매자로켓');
assert.strictEqual(r.items[0].url, 'https://www.coupang.com/vp/products/111');
console.log('✔ 옛 화면 구조 수집');

// 2) 새 화면 (2페이지 → 순위 37부터)
r = C.scrapeSearch(dom(newLayout, 'https://www.coupang.com/np/search?q=%EC%B0%A8%EC%A1%B0&page=2'));
assert.strictEqual(r.items.length, 1);
assert.strictEqual(r.items[0].price, 16500, '정가·단위가격 제외한 판매가');
assert.strictEqual(r.items[0].reviewCount, 312);
assert.strictEqual(r.items[0].rating, 4.5);
assert.strictEqual(r.items[0].name, '유기농 차조 800g');
assert.strictEqual(r.items[0].rank, 37);
console.log('✔ 새 화면 구조 수집');

// 3) 상품 상세 + 리뷰
const product = `
<h1 class="prod-buy-header__title">국산 볶음 차조 1kg</h1>
<span class="total-price"><strong>12,900원</strong></span>
<span class="count">1,234개 상품평</span>
<article class="sdp-review__article__list"><div class="sdp-review__article__list__review__content">밥에 섞어 먹으니 고소하고 식감이 좋아요</div></article>
<article class="sdp-review__article__list"><div class="sdp-review__article__list__review__content">포장이 터져서 왔어요. 지퍼백이면 좋겠어요</div></article>
<article class="sdp-review__article__list"><div class="sdp-review__article__list__review__content">밥에 섞어 먹으니 고소하고 식감이 좋아요</div></article>`;
const p = C.scrapeProduct(dom(product, 'https://www.coupang.com/vp/products/111?itemId=1'));
assert.strictEqual(p.id, '111');
assert.strictEqual(p.price, 12900);
assert.strictEqual(p.reviewCount, 1234);
assert.strictEqual(p.reviews.length, 2, '중복 리뷰 제거');
console.log('✔ 상품 상세·리뷰 수집');

// 4) 분석
const items = C.scrapeSearch(dom(oldLayout, 'https://www.coupang.com/np/search?q=x')).items;
const a = A.analyzeKeyword(items, 30);
assert.strictEqual(a.productCount, 3);
assert.strictEqual(a.adCount, 1);
assert.strictEqual(a.medianPrice, 12900);
assert.strictEqual(a.totalReviews, 10190);
assert.strictEqual(a.top10AvgReviews, Math.round((1234 + 8900) / 2));
assert.strictEqual(a.difficulty.level, '어려움');
assert.strictEqual(a.items[0].estSales, 1234 * 30);
assert.ok(Math.abs(a.bands.reduce((t, b) => t + b.share, 0) - 100) < 0.5, '가격대 비중 합 100%');
assert.ok(A.toCsv(a.items).startsWith('﻿순위,'));
assert.strictEqual(A.formatWon(123456789), '1.2억원');
console.log('✔ 분석 계산');

console.log('\n모든 테스트 통과');
