/**
 * planAssetCopy 테스트
 * 실행: cd tools && node test-asset-copy-planner.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'js', 'asset-copy-planner.js');
const source = fs.readFileSync(SRC, 'utf8');
const planAssetCopy = new Function(source + '\nreturn planAssetCopy;')();

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) { console.error(`FAIL ${label}\n  expected: ${b}\n  actual:   ${a}`); process.exit(1); }
  console.log(`PASS  ${label}`);
}

// 케이스 1: css/ 와 images/ 둘 다 있는 경우
assertEq(
  planAssetCopy({ 'css': ['base.css', 'bridge.css'], 'images': ['logo.png'] }),
  [
    { from: 'css/base.css',   to: 'css/base.css' },
    { from: 'css/bridge.css', to: 'css/bridge.css' },
    { from: 'images/logo.png', to: 'images/logo.png' },
  ],
  'css/images 모두 있음'
);

// 케이스 2: css/ 만 있고 images/ 없음
assertEq(
  planAssetCopy({ 'css': ['kb-publish.css'] }),
  [{ from: 'css/kb-publish.css', to: 'css/kb-publish.css' }],
  'images 없음'
);

// 케이스 3: 둘 다 비어있음 → 빈 배열
assertEq(planAssetCopy({}), [], '자산 폴더 없음');

// 케이스 4: 빈 폴더는 무시
assertEq(planAssetCopy({ 'css': [], 'images': [] }), [], '빈 폴더');

console.log('\n전체 통과');
