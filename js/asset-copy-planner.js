/**
 * planAssetCopy(listing) -> [{from, to}, ...]
 *
 * listing: { [subdirName]: string[] }   예) { css: ['base.css'], images: ['a.png'] }
 * 자산 대상 서브폴더(css, images)만 채택, 파일명은 source = dest 동일 경로로 매핑.
 *
 * 순수함수 -- FileSystemAccess 의존 없음. 브라우저/node 양쪽 호출 가능.
 */
function planAssetCopy(listing) {
  const TARGETS = ['css', 'images'];
  const out = [];
  for (const dir of TARGETS) {
    const files = listing[dir];
    if (!Array.isArray(files)) continue;
    for (const f of files) {
      out.push({ from: `${dir}/${f}`, to: `${dir}/${f}` });
    }
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = planAssetCopy;
