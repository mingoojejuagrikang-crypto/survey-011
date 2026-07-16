import { useState } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import { downloadBlob } from '../../lib/csv';
import type { ExportResult } from '../../lib/useDataActions';
import { Backdrop } from './Backdrop';

// ─── export done modal (v0.13.0 R6) ──────────────────────────
// ExportResult 타입은 생산자인 useDataActions(lib)가 소유한다 — lib→component 역참조 방지.

/** 내보내기 완료를 작은 줄 배너 대신 큰 중앙 팝업으로 안내(민구 시인성 요청). 클릭 동작:
 *  - '파일 열기/공유': Web Share API Level 2(navigator.share({files})). iOS 스탠드얼론 PWA에서
 *    공유 시트(파일에 저장 / Numbers·엑셀로 열기 / 메일)를 띄운다. PWA는 다운로드 파일을 직접
 *    '실행'할 수 없어(보안 경계), '공유시트로 다른 앱에 넘기기'가 실질적 '파일 열기'다. canShare로
 *    지원 확인될 때만 노출, 미지원이면 숨김.
 *  - '다시 다운로드': 보관 Blob을 같은 방식으로 재다운로드(모든 환경 신뢰 폴백).
 *  닫으면 Blob 참조 해제(메모리 회수 — 큰 ZIP이 모달 동안만 메모리에 핀). */
export function ExportDoneModal({ result, onClose }: { result: ExportResult; onClose: () => void }) {
  const [shareError, setShareError] = useState<string | null>(null);
  const mime = result.kind === 'csv' ? 'text/csv' : 'application/zip';
  // canShare 파일 지원 가드(미지원 브라우저는 share 버튼 숨김).
  const canShareFile = (() => {
    try {
      const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
      if (!nav.share || !nav.canShare) return false;
      const f = new File([result.blob], result.filename, { type: mime });
      return nav.canShare({ files: [f] });
    } catch { return false; }
  })();

  const doShare = async () => {
    setShareError(null);
    try {
      const file = new File([result.blob], result.filename, { type: mime });
      await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
        files: [file],
        title: result.filename,
      });
    } catch (e) {
      // 사용자가 공유 시트를 취소(AbortError)한 건 오류가 아니므로 무시.
      if ((e as Error)?.name !== 'AbortError') {
        setShareError('공유를 열 수 없습니다. 다시 다운로드를 사용하세요.');
      }
    }
  };

  // 보관 Blob을 그대로 재다운로드(downloadBlob은 mime 무관 범용 다운로더 — csv/zip 공용).
  const doRedownload = () => { downloadBlob(result.blob, result.filename); };

  return (
    <Backdrop onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 380, padding: 24,
          display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: 999,
            background: 'rgba(0,200,83,0.14)', border: `2px solid ${T.green}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {I.check(28, T.green)}
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, color: T.text }}>내보내기 완료</div>
        <div
          style={{
            fontSize: 14, color: T.textDim, textAlign: 'center', lineHeight: 1.5,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            wordBreak: 'break-all', overflowWrap: 'anywhere',
          }}
        >
          {result.filename}
        </div>
        <div style={{ fontSize: 12.5, color: T.textMute, textAlign: 'center', lineHeight: 1.5 }}>
          기기에 저장되었습니다.{canShareFile ? ' 다른 앱(엑셀·파일·메일)으로 열려면 아래 공유를 누르세요.' : ''}
        </div>
        {shareError && (
          <div style={{ fontSize: 12.5, color: T.red, textAlign: 'center' }}>{shareError}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 2 }}>
          {canShareFile && (
            <button
              onClick={doShare}
              style={{
                width: '100%', height: 50, borderRadius: 14, border: 'none',
                background: T.blue, color: '#fff', fontSize: 15, fontWeight: 800,
                letterSpacing: -0.2, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: `0 4px 14px ${T.blueGlow}`,
              }}
            >
              {I.share(18, '#fff')} 파일 열기 / 공유
            </button>
          )}
          <button
            onClick={doRedownload}
            style={{
              width: '100%', height: 50, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.text, fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {I.download(18, T.text)} 다시 다운로드
          </button>
          <button
            onClick={onClose}
            style={{
              width: '100%', height: 46, borderRadius: 14,
              border: 'none', background: 'transparent',
              color: T.textDim, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
