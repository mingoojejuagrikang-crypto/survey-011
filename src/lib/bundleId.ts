/**
 * v0.50 (2026-08-19) — **번들 자산 해시**(빌드 식별자) 공용 모듈.
 *
 * `feedback.ts`의 지역 `readBundleId()`를 승격한 것이다(리서치 rpwa F9). 이제 두 소비자가 있다:
 *  · 피드백 zip의 `bundle` 필드(종전) — 같은 버전의 여러 빌드를 구분한다
 *  · `liveVersionProbe` — **배포본 index.html의 해시와 직접 대조**해 「최신인가」를 사실로 만든다
 *
 * 🔑 `readBundleId()`가 돌려주는 것은 **지금 실행 중인** 번들이다. SW precache가 낡았으면
 * **낡은 해시가 나오고, 그게 바로 우리가 감지하려는 상태다** — "SW 캐시를 읽으니 무의미"가
 * 아니라 정반대로 그 비교가 성립하는 이유다.
 */

/** 번들 파일명에서 해시를 뽑는 정규식. `assets/index-<hash>.js` 형태를 판다. */
const BUNDLE_RE = /\/assets\/(index-[A-Za-z0-9_.-]+\.js)/;

/** 로컬 번들을 식별할 수 없는 경우의 sentinel — **비교의 왼쪽이 이 값이면 판정하면 안 된다.**
 *  비-export다: 바깥은 `isComparableBundleId()`로 물어야 하고, 문자열을 직접 비교하면
 *  판정 규칙이 두 벌이 된다(오라클도 그 함수를 쓴다). */
const BUNDLE_ID_DEV = 'dev';
const BUNDLE_ID_UNKNOWN = 'unknown';

/** 지금 문서가 로드한 번들 자산 이름. dev 서버(모듈 직접 로드)에서는 `'dev'`. */
export function readBundleId(): string {
  try {
    const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
    for (const s of scripts) {
      const m = BUNDLE_RE.exec(s.getAttribute('src') ?? '');
      if (m) return m[1];
    }
    return BUNDLE_ID_DEV;
  } catch {
    return BUNDLE_ID_UNKNOWN;
  }
}

/** 로컬 해시가 **비교에 쓸 수 있는 값**인가. `dev`/`unknown`/빈 값이면 판정 불가다. */
export function isComparableBundleId(id: string): boolean {
  return !!id && id !== BUNDLE_ID_DEV && id !== BUNDLE_ID_UNKNOWN;
}

/**
 * 배포본 `index.html` 문자열에서 번들 자산 이름을 뽑는다. **순수 함수.**
 *
 * 🔴 못 뽑으면 `null`이다 — 호출자는 이것을 **「최신」으로 접으면 안 된다.** 실제로 일어나는 경우:
 *  · GH Pages/SPA fallback이 **200으로 404 페이지**를 돌려줄 때
 *  · 프록시·캡티브 포털이 에러 페이지를 끼워 넣을 때
 * 그 둘은 「네트워크 실패」와도 다르다(fetch는 성공했다). 그래서 상태를 갈라 남긴다.
 */
export function extractBundleId(html: string): string | null {
  const m = BUNDLE_RE.exec(html);
  return m ? m[1] : null;
}
