// 쿠팡 화면 구조(옛 버전 / 새 버전)를 흉내 낸 샘플로 수집·분석 로직을 검사합니다.
// 실행: npm test
const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
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

// 2026년 11월 실제 쿠팡 검색 화면 구조 (적립금 배지, aria-label 별점, 광고 링크)
const realLayout = `
<ul>
  <li class="ProductUnit_productUnit__Qd6sv"><a href="/vp/products/9784754448?itemId=1&sourceType=srp_product_ads&q=귤&searchRank=0">
    <div class="ProductUnit_productNameV2__cV9cw">고당도 산지직송 제주감귤, 9kg</div>
    <div class="PriceArea_priceArea__NntJz"><div><span>할인</span><del>33,900원</del></div>
      <div><div>35%</div><div><span>21,900원</span></div><span>(100g당 438원)</span></div></div>
    <div class="ProductRating_productRating__jjf7W"><div aria-label="4.5"><div class="ProductRating_fullRating__1t_jb"></div></div><span>(3,739)</span></div>
    <div><span><img alt="최대 1,095원 적립" src="https://image.coupangcdn.com/image/badges/cashback/web/list-cash-icon@2x.png"><span>최대 1,095원 적립</span></span></div>
  </a></li>
  <li class="ProductUnit_productUnit__Qd6sv"><a href="/vp/products/9810394293?itemId=2&q=귤&sourceType=search&rank=2&searchRank=2">
    <div class="ProductUnit_productNameV2__cV9cw">[타임특가] 당일수확 제주 귤 10kg</div>
    <div class="PriceArea_priceArea__NntJz"><div><span>할인</span><del>26,400원</del></div>
      <div><div><div>57%</div><svg></svg></div><div><span>11,300원</span></div><span>(100g당 113원)</span></div></div>
    <div><span>12/1(화) </span><span>도착 예정</span></div>
    <div class="ProductRating_productRating__jjf7W"><div aria-label="5"></div><span>(48)</span></div>
    <div><span><img alt="최대 565원 적립" src="x/cashback/list-cash-icon@2x.png"><span>최대 565원 적립</span></span></div>
    <span class="RankMark_rank1__EWwz0">1</span>
  </a></li>
  <li class="ProductUnit_productUnit__Qd6sv"><a href="/vp/products/777?itemId=3&sourceType=search&rank=5">
    <div class="ProductUnit_productNameV2__cV9cw">귤탐 감귤 2kg</div>
    <div class="PriceArea_priceArea__NntJz"><div><span>12,990원</span></div></div>
    <img src="https://image.coupangcdn.com/image/badges/falcon/logo/xhdpi/logo_fresh_medium.png">
    <div aria-label="3.5"></div><span>(149,166)</span>
  </a></li>
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

// 2) 새 화면 (2페이지 → 순위 61부터)
r = C.scrapeSearch(dom(newLayout, 'https://www.coupang.com/np/search?q=%EC%B0%A8%EC%A1%B0&page=2'));
assert.strictEqual(r.items.length, 1);
assert.strictEqual(r.items[0].price, 16500, '정가·단위가격 제외한 판매가');
assert.strictEqual(r.items[0].reviewCount, 312);
assert.strictEqual(r.items[0].rating, 4.5);
assert.strictEqual(r.items[0].name, '유기농 차조 800g');
assert.strictEqual(r.items[0].rank, 61);
console.log('✔ 새 화면 구조 수집');

// 2-1) 2026년 11월 실제 화면 구조
r = C.scrapeSearch(dom(realLayout, 'https://www.coupang.com/np/search?q=%EA%B7%A4'));
assert.deepStrictEqual(r.items.map((i) => i.price), [21900, 11300, 12990], '적립금(최대 OOO원 적립)을 가격으로 읽으면 안 됨');
assert.deepStrictEqual(r.items.map((i) => i.reviewCount), [3739, 48, 149166]);
assert.deepStrictEqual(r.items.map((i) => i.rating), [4.5, 5, 3.5]);
assert.deepStrictEqual(r.items.map((i) => i.ad), [true, false, false]);
assert.deepStrictEqual(r.items.map((i) => i.rank), [null, 2, 5], '광고는 순위 없음, 나머지는 링크의 rank 값');
assert.strictEqual(r.items[2].delivery, '로켓프레시');
assert.strictEqual(r.items[1].name, '[타임특가] 당일수확 제주 귤 10kg');
console.log('✔ 2026년 실제 화면 구조 수집 (적립금·광고·별점)');

// 3-1) 2026년 실제 상품 상세 화면
const realProduct = `
<h1 class="product-title"><span>코멧 오리지널 아기물티슈 캡형</span></h1>
<div class="price-container"><div>39%</div><div>10,890원</div><div>(1매당 11원)</div><del>18,000원</del></div>
<span class="rating-count-txt">493,278 개 상품평</span>
<div class="sdp-review">
  <article><div><i class="twc-bg-full-star"></i><i class="twc-bg-full-star"></i><i class="twc-bg-full-star"></i><i class="twc-bg-full-star"></i><i class="twc-bg-half-star"></i></div>
    <div class="twc-mb-[8px] twc-font-bold">마구 부담없이써요</div>
    <div class="twc-break-all"><span translate="no">몇 년째 꾸준히 사용하고 있어요<br>가격 대비 구성이 좋아요</span></div></article>
  <article><div><i class="twc-bg-full-star"></i><i class="twc-bg-full-star"></i></div>
    <div class="twc-break-all"><span translate="no">뚜껑이 잘 안 닫혀서 말라요</span></div></article>
</div>`;
const rp = C.scrapeProduct(dom(realProduct, 'https://www.coupang.com/vp/products/188227098?itemId=5'));
assert.strictEqual(rp.price, 10890);
assert.strictEqual(rp.reviewCount, 493278);
assert.strictEqual(rp.reviews.length, 2);
assert.strictEqual(rp.reviews[0].star, 4.5);
assert.ok(rp.reviews[0].text.startsWith('[마구 부담없이써요]'));
assert.strictEqual(rp.reviews[1].star, 2);
console.log('✔ 2026년 실제 상품 상세·리뷰 수집');

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

// 3-2) 네이버쇼핑 (일반적인 카드 구조 샘플)
const naverHtml = `
<div id="list">
 <div class="product_item__a"><div class="product_img"><a href="https://smartstore.naver.com/tongyeong/products/1111111?nl-query=x"><img alt="통영 생굴무침 산지직송 300g"></a></div>
  <div class="product_info"><a href="https://smartstore.naver.com/tongyeong/products/1111111" title="통영 생굴무침 산지직송 300g 당일무침">통영 생굴무침 산지직송 300g 당일무침</a>
   <div class="price"><del>19,000원</del><strong>12,900원</strong></div><div>배송비 3,000원</div>
   <div>★4.8 리뷰 1,234 · 구매 2.3만 · 찜 99</div><div class="mall_title"><a>통영바다상회</a></div><div>오늘출발</div></div></div>
 <div class="product_item__a"><div><a href="https://adcr.naver.com/adcr?x=1&nv_mid=2222222">해남 굴무침 500g</a></div>
  <div>15,900원 (100g당 3,180원)</div><div>리뷰 87</div><span>광고</span><div class="mall_title"><a>해남수산</a></div></div>
 <div class="product_item__a"><div><a href="https://search.shopping.naver.com/catalog/3333333">굴무침 가격비교</a></div><div>최저 9,900원</div><div>리뷰 (5.6만)</div></div>
</div>`;
const nv = C.scrapeNaver(dom(naverHtml, 'https://search.shopping.naver.com/ns/search?query=%EC%83%9D%EA%B5%B4%EB%AC%B4%EC%B9%A8'));
assert.strictEqual(nv.keyword, '생굴무침');
assert.strictEqual(nv.items.length, 3);
assert.deepStrictEqual(nv.items.map((i) => i.price), [12900, 15900, 9900], '정가·배송비·100g당 가격 제외');
assert.deepStrictEqual(nv.items.map((i) => i.reviewCount), [1234, 87, 56000]);
assert.strictEqual(nv.items[0].purchaseCount, 23000);
assert.strictEqual(nv.items[0].rating, 4.8);
assert.strictEqual(nv.items[0].mall, '통영바다상회');
assert.strictEqual(nv.items[0].delivery, '오늘출발');
assert.strictEqual(nv.items[0].name, '통영 생굴무침 산지직송 300g 당일무침');
assert.deepStrictEqual(nv.items.map((i) => i.ad), [false, true, false]);
console.log('✔ 네이버쇼핑 수집 (샘플 구조)');

// 3-2b) 네이버 통합검색 (플러스스토어 영역) — 사용자가 붙여준 실제 화면 글자 순서 기반
const naverIntegrated = `
<ul>
 <li><div><a href="https://smartstore.naver.com/wcfood172/products/5555555"><img alt="국내산 통영 제철 굴 생굴 무침 택배 300g"></a></div>
  <div><a href="https://smartstore.naver.com/wcfood172/products/5555555">국내산 통영 제철 굴 생굴 무침 택배 300g</a></div>
  <div><span>할인 전 판매가</span><del>11,900<span>원</span></del><span>16%할인</span><strong>9,900<span>원</span></strong></div>
  <div>배송비3,500원</div><div><span>4.54</span><span>(54)</span></div><div>통영애서</div><span>광고</span></li>
 <li><div><a href="https://smartstore.naver.com/kangifood/products/6666666">통영 생굴무침 1kg 제철 굴무침 강이네식탁</a></div>
  <div><span>할인 전 판매가</span><span>37,000원</span><span>13%할인</span><span>32,000원</span></div>
  <div>배송비3,500원</div><div><span>4.9</span><span>(8,527)</span></div><div>구매 1,877찜 720</div><div>N배송</div></li>
</ul>`;
const ni = C.scrapeNaver(dom(naverIntegrated, 'https://search.naver.com/search.naver?query=%EC%83%9D%EA%B5%B4%EB%AC%B4%EC%B9%A8'));
assert.strictEqual(ni.keyword, '생굴무침');
assert.deepStrictEqual(ni.items.map((i) => i.price), [9900, 32000], '할인 전 판매가·배송비 제외');
assert.deepStrictEqual(ni.items.map((i) => i.rating), [4.54, 4.9]);
assert.deepStrictEqual(ni.items.map((i) => i.reviewCount), [54, 8527]);
assert.strictEqual(ni.items[1].purchaseCount, 1877);
assert.deepStrictEqual(ni.items.map((i) => i.ad), [true, false]);
assert.strictEqual(ni.items[1].delivery, 'N배송');
assert.strictEqual(ni.items[1].mall, 'kangifood', '판매처 칸이 없으면 스토어 주소에서');
console.log('✔ 네이버 통합검색(플러스스토어) 수집');

// 3-2c) 실제 링크가 smartstore.naver.com/main/... 인 경우 판매처는 카드 글자에서
const naverMain = `<ul><li><div><a href="https://smartstore.naver.com/main/products/9666975559?nl-query=x">통영 생굴무침 500g 제철 굴무침 강이네식탁</a></div>
  <div><span>할인 전 판매가</span><span>26,000원</span><span>23%할인</span><span>19,900원</span></div><div>배송비3,500원</div>
  <div><span>4.87</span><span>(1,734)</span></div><div><span>강이네 식탁</span></div><div><span>네이버페이플러스</span></div></li></ul>`;
const nm = C.scrapeNaver(dom(naverMain, 'https://search.naver.com/search.naver?query=x'));
assert.strictEqual(nm.items[0].mall, '강이네 식탁');
assert.strictEqual(nm.items[0].price, 19900);
console.log('✔ 네이버 판매처 이름 (main 주소)');

// 3-2e) 네이버쇼핑 탭: 카드 하나에 사진·제목·판매처 링크 주소가 서로 다름 (이전엔 5개만 잡히던 문제)
const card = (n, title, price, mall) => `<div class="product_item"><div class="thumb"><a href="https://search.shopping.naver.com/catalog/${n}0001"><img alt=""></a></div>
 <div class="info"><a href="https://smartstore.naver.com/main/products/${n}0002?nl=1" title="${title}">${title}</a>
 <div class="price"><del>${price + 3000}원</del><strong>${price.toLocaleString()}원</strong></div><div>배송비 3,000원</div>
 <div><span>★4.8</span> 리뷰 ${n}00 · 구매 ${n}0</div></div>
 <div class="mall"><a href="https://smartstore.naver.com/main">${mall}</a><a href="https://search.shopping.naver.com/bridge?x=${n}">쇼핑몰선택</a></div></div>`;
const shopTab = `<div class="list">${card(1, '통영 생굴무침 300g 당일무침', 9900, '그대의밥상')}${card(2, '해남 굴무침 500g 국내산', 15900, '해남수산')}${card(3, '[특가] 통영 굴무침 1kg 대용량', 27800, '통영바다')}</div>`;
const st = C.scrapeNaver(dom(shopTab, 'https://search.shopping.naver.com/search/all?query=%EC%83%9D%EA%B5%B4%EB%AC%B4%EC%B9%A8'));
assert.strictEqual(st.items.length, 3, '카드 3개 모두');
assert.deepStrictEqual(st.items.map((i) => i.price), [9900, 15900, 27800]);
assert.deepStrictEqual(st.items.map((i) => i.mall), ['그대의밥상', '해남수산', '통영바다']);
assert.deepStrictEqual(st.items.map((i) => i.reviewCount), [100, 200, 300]);
console.log('✔ 네이버쇼핑 탭 (카드 안 링크가 여러 개)');

// 3-2f) 실제 네이버 통합검색 화면 구조 (사용자가 복사해 준 것, 2026-11-26)
const realNaver = fs.readFileSync(__dirname + '/naver-integrated-real.html', 'utf8');
const rn = C.scrapeNaver(dom('<body>' + realNaver + '</body>', 'https://search.naver.com/search.naver?query=%EC%83%9D%EA%B5%B4%EB%AC%B4%EC%B9%A8'));
const chef = rn.items.find((i) => /250g/.test(i.name) && i.mall === '셰프애찬');
assert.ok(chef, '셰프애찬 카드 수집');
assert.strictEqual(chef.price, 9800, '할인 전 판매가 15,800 제외');
assert.strictEqual(chef.rating, 4.67);
assert.strictEqual(chef.reviewCount, 9822);
assert.ok([3000, 3026].includes(chef.purchaseCount), '구매 수');
assert.strictEqual(C.koNumber('3천+'), 3000);
assert.strictEqual(chef.ad, true);
assert.strictEqual(chef.delivery, '오늘출발');
assert.ok(rn.items.some((i) => i.mall === '강이네 식탁'), '두 번째 카드');
console.log('✔ 실제 네이버 통합검색 구조 (' + rn.items.length + '개: ' + rn.items.map((i) => i.mall + ' ' + i.price).join(', ') + ')');

// 3-2g) 실제 네이버쇼핑 탭 구조 (사용자가 복사해 준 것, 2026-11-26)
const shopReal = fs.readFileSync(__dirname + '/naver-shop-real.html', 'utf8');
const sr = C.scrapeNaver(dom('<body>' + shopReal + '</body>', 'https://search.shopping.naver.com/ns/search?query=%EC%83%9D%EA%B5%B4%EB%AC%B4%EC%B9%A8'));
assert.strictEqual(sr.keyword, '생굴무침');
assert.strictEqual(sr.items.length, 3);
assert.deepStrictEqual(sr.items.map((i) => i.name), ['셰프애찬 굴함량60% 통영 생굴 무침250g', '산청할매 30년전통 굴 생굴무침 1kg + 알배추', '통영 생굴로 무친 생굴무침 300g, 500g']);
assert.deepStrictEqual(sr.items.map((i) => i.mall), ['셰프애찬', '통영밥상', '더신선 공식스토어']);
assert.deepStrictEqual(sr.items.map((i) => i.price), [9800, 26900, 13900]);
assert.deepStrictEqual(sr.items.map((i) => i.ad), [true, false, false], '슈퍼적립 표시는 광고 아님(is_ad:false)');
assert.deepStrictEqual(sr.items.map((i) => i.rating), [4.67, 4.77, 4.8]);
assert.deepStrictEqual(sr.items.map((i) => i.reviewCount), [9822, 720, 57]);
assert.deepStrictEqual(sr.items.map((i) => i.purchaseCount), [3000, 575, null]);
assert.deepStrictEqual(sr.items.map((i) => i.id), ['9365853158', '12312353207', '13823467465']);
assert.deepStrictEqual(sr.items.map((i) => i.rank), [null, 1, 2]);
assert.strictEqual(sr.items[1].delivery, 'N배송');
console.log('✔ 실제 네이버쇼핑 탭 구조');

// 3-2d) 화면 구조 복사
const dbg = C.debugDump(dom(naverMain, 'https://search.naver.com/search.naver?query=x'));
assert.ok(dbg.includes('카드 1') && dbg.includes('smartstore.naver.com/main') && !dbg.includes('nl-query'));
console.log('✔ 화면 구조 복사');

// 3-3) 인기 키워드
const kw = A.extractKeywords([
  { name: '[특가] 통영 산지직송 생굴무침 330g', reviewCount: 500 },
  { name: '통영 최상급 생굴무침 500g, 2개', reviewCount: 300 },
  { name: '더좋은 통영 산지직송 굴무침', reviewCount: 2000 },
  { name: '더좋은 어리굴젓 1kg', reviewCount: 600 }
], '생굴무침');
assert.strictEqual(kw[0].word, '통영');
assert.ok(!kw.some((k) => /생굴무침|330g|2개|특가/.test(k.word) && k.word !== '특가') , '검색어·용량·수량 제외');
assert.strictEqual(kw.find((k) => k.word === '더좋은').caution, '업체명 확인');
assert.ok(!kw.find((k) => k.word === '최상급'), '한 상품에만 나온 단어 제외');
const kw2 = A.extractKeywords([
  { name: '통영 생굴무침 500g 제철 굴무침', reviewCount: 1734 },
  { name: '통영 생굴무침 300g 굴무침 생굴 굴', reviewCount: 770 },
  { name: '[김장대전] 통영 생굴무침 300g', reviewCount: 454 }
], '생굴무침');
assert.strictEqual(kw2[0].word, '통영');
assert.strictEqual(kw2[0].caution, '', '지역명은 맨 앞에 와도 업체명으로 보지 않음');
console.log('✔ 인기 키워드 추출');

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
