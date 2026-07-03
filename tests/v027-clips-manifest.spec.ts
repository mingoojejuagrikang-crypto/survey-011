/**
 * v0.27.0 — export zip 동봉 `clips-manifest.json` 검증 (클립 감사 SOP-003 §3 자동화).
 *
 * sessionSnapshot.spec.ts / csv-export.spec.ts와 같은 Node 런너 패턴(브라우저 불필요):
 * IDB/Drive/import.meta.env 의존부(exportLog.ts의 googleAuth) 없이, exportLogZip이 zip을
 * 구성하는 순서 그대로(device/events/sessions/clips → attachClipsManifest)를 재현해
 * 순수 계층(clipsManifest.ts)의 계약을 직접 검증한다.
 *
 * 실행: npx playwright test tests/v027-clips-manifest.spec.ts
 */
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import {
  attachClipsManifest,
  buildClipsManifest,
  parseClipKey,
  CLIPS_MANIFEST_SCHEMA,
  CLIPS_MANIFEST_FILENAME,
  type ClipsManifest,
  type ManifestSourceEvent,
} from '../src/lib/clipsManifest';
import { buildSessionsSnapshot, restoreSessionsFromZip, type ZipRestoreDeps } from '../src/lib/sessionSnapshot';
import type { Session } from '../src/types';

const SID = 'sess_1781000000000';

/** 세션 시드: 값이 커밋된 행(1·3) + 빈 placeholder 행(2) — exportLogZip의 sessions.json 형상. */
function makeSession(id: string): Session {
  return {
    id,
    date: '2026-07-03',
    label: 'A구역',
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    rows: [
      { index: 1, values: { c6: '1', c8: '35.1' }, complete: true, audioClips: { c8: `${id}:1:c8` } },
      { index: 2, values: { c6: '2', c8: '' }, complete: false },
      { index: 3, values: { c6: '3', c8: '41.3' }, complete: true, audioClips: { c8: `${id}:3:c8` } },
    ],
    completedRows: 2,
    syncedRows: 0,
    startedAt: 1781000000000,
  };
}

/** 이벤트 시드: 셀(1,c8)은 정정 흐름(stt→value→value) — "마지막" value 이벤트가 이겨야 한다.
 *  셀(3,c8)은 stt만 있고 confidence 미탑재(iOS [STT-13] 케이스) — confidence:null 기대. */
function makeEvents(): ManifestSourceEvent[] {
  return [
    { type: 'stt', sessionId: SID, row: 1, colId: 'c8', text: '삼십오 점 이', confidence: 0.61 },
    { type: 'value', sessionId: SID, row: 1, colId: 'c8', text: '삼십오 점 이', parsed: '35.2', confidence: 0.61 },
    // 정정 후 최종 커밋 — manifest는 이 "마지막" 이벤트의 text/confidence를 실어야 한다.
    { type: 'value', sessionId: SID, row: 1, colId: 'c8', text: '삼십오 점 일', parsed: '35.1', confidence: 0.87 },
    { type: 'stt', sessionId: SID, row: 3, colId: 'c8', text: '사십일 점 삼' }, // confidence 없음
    // 다른 셀/타입 이벤트는 매칭되면 안 된다.
    { type: 'tts', sessionId: SID, row: 1, colId: 'c8', text: '횡경' },
    { type: 'value', sessionId: 'sess_other', row: 1, colId: 'c8', text: '99', confidence: 0.99 },
  ];
}

/** exportLogZip과 동일한 zip 구성(순서 포함)을 재현. clips/ 확장자 혼재(wav/webm)도 재현. */
function buildExportLikeZip(sessions: Session[], events: ManifestSourceEvent[], clipKeys: { key: string; ext: string }[]): JSZip {
  const zip = new JSZip();
  zip.file('device.json', JSON.stringify({ appVersion: '0.27.0' }, null, 2));
  zip.file('events.json', JSON.stringify(events, null, 2));
  zip.file('sessions.json', buildSessionsSnapshot(sessions, '0.27.0'));
  for (const { key, ext } of clipKeys) zip.file(`clips/${key}.${ext}`, new Uint8Array([1, 2, 3]));
  return zip;
}

const CLIPS = [
  { key: `${SID}:1:c8`, ext: 'wav' },          // final
  { key: `${SID}:1:c8:raw`, ext: 'wav' },       // 트림 전 원본
  { key: `${SID}:1:c8:a1`, ext: 'wav' },        // 정정으로 보관된 1차 시도
  { key: `${SID}:1:c8:cmd2`, ext: 'webm' },     // 명령 발화
  { key: `${SID}:1:c8:cmd2:raw`, ext: 'webm' }, // 명령 발화 원본
  { key: `${SID}:3:c8`, ext: 'wav' },           // confidence 미탑재 셀
  { key: `${SID}:9:c8`, ext: 'wav' },           // sessions/events에 없는 행 → null들
];

async function roundTripManifest(zip: JSZip): Promise<ClipsManifest> {
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const loaded = await JSZip.loadAsync(bytes);
  const file = loaded.file(CLIPS_MANIFEST_FILENAME);
  expect(file).not.toBeNull();
  return JSON.parse(await file!.async('text')) as ClipsManifest;
}

test.describe('clips-manifest.json 동봉 (v0.27.0)', () => {
  test('manifest 존재 + schema:1 + 항목 수 = 클립 수', async () => {
    const zip = buildExportLikeZip([makeSession(SID)], makeEvents(), CLIPS);
    attachClipsManifest(zip, [makeSession(SID)], makeEvents(), '0.27.0');
    const manifest = await roundTripManifest(zip);

    expect(manifest.schema).toBe(CLIPS_MANIFEST_SCHEMA);
    expect(manifest.appVersion).toBe('0.27.0');
    expect(manifest.clipCount).toBe(CLIPS.length);
    expect(manifest.clips).toHaveLength(CLIPS.length);
    // file 경로가 zip의 실제 clips/ 엔트리와 1:1 대응
    const files = manifest.clips.map((c) => c.file).sort();
    expect(files).toEqual(CLIPS.map((c) => `clips/${c.key}.${c.ext}`).sort());
  });

  test('kind 파싱 + committedValue/sttText/confidence 매핑 정확성', async () => {
    const zip = buildExportLikeZip([makeSession(SID)], makeEvents(), CLIPS);
    attachClipsManifest(zip, [makeSession(SID)], makeEvents(), '0.27.0');
    const manifest = await roundTripManifest(zip);
    const byFile = new Map(manifest.clips.map((c) => [c.file, c]));

    // final: 커밋값 + "마지막" value 이벤트(정정 후 0.87)가 이긴다 — 첫 이벤트(0.61) 아님.
    const fin = byFile.get(`clips/${SID}:1:c8.wav`)!;
    expect(fin).toMatchObject({
      sessionId: SID, row: 1, colId: 'c8', kind: 'final',
      committedValue: '35.1', sttText: '삼십오 점 일', confidence: 0.87,
    });

    // 서픽스 파싱: raw / a1 / cmd2 / cmd2:raw — 같은 셀이므로 committedValue는 동일하게 매핑.
    expect(byFile.get(`clips/${SID}:1:c8:raw.wav`)!.kind).toBe('raw');
    expect(byFile.get(`clips/${SID}:1:c8:a1.wav`)!.kind).toBe('a1');
    expect(byFile.get(`clips/${SID}:1:c8:cmd2.webm`)!.kind).toBe('cmd2');
    expect(byFile.get(`clips/${SID}:1:c8:cmd2:raw.webm`)!.kind).toBe('cmd2:raw');
    expect(byFile.get(`clips/${SID}:1:c8:a1.wav`)!.committedValue).toBe('35.1');

    // confidence 미탑재(stt에 confidence 없음, iOS [STT-13]) → 정직한 null. text는 있음.
    const r3 = byFile.get(`clips/${SID}:3:c8.wav`)!;
    expect(r3).toMatchObject({ committedValue: '41.3', sttText: '사십일 점 삼', confidence: null });

    // 매칭 실패(세션에 없는 행 9) → 추측 금지, 전부 null.
    const r9 = byFile.get(`clips/${SID}:9:c8.wav`)!;
    expect(r9).toMatchObject({ row: 9, colId: 'c8', kind: 'final', committedValue: null, sttText: null, confidence: null });
  });

  test('additive 불변: 기존 엔트리 보존 + 복구(restoreSessionsFromZip)가 manifest에 영향받지 않음', async () => {
    const zip = buildExportLikeZip([makeSession(SID)], makeEvents(), CLIPS);
    attachClipsManifest(zip, [makeSession(SID)], makeEvents(), '0.27.0');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const loaded = await JSZip.loadAsync(bytes);

    // 기존 파일들 그대로 존재
    for (const name of ['device.json', 'events.json', 'sessions.json']) {
      expect(loaded.file(name), name).not.toBeNull();
    }

    // 복구 경로: manifest가 클립으로 오인되거나 복구를 깨뜨리면 안 된다.
    const saved: { sessions: Session[]; clips: string[] } = { sessions: [], clips: [] };
    const deps: ZipRestoreDeps = {
      saveSession: async (s) => { saved.sessions.push(s); },
      saveAudioClip: async (key) => { saved.clips.push(key); },
    };
    const result = await restoreSessionsFromZip(bytes, new Set(), deps);
    expect(result.legacy).toBe(false);
    expect(result.restoredSessions).toBe(1);
    expect(result.restoredClips).toBe(CLIPS.length); // manifest는 클립 카운트에 안 잡힘
    expect(saved.clips.sort()).toEqual(CLIPS.map((c) => c.key).sort());
  });

  test('실패 내성: 비정형 키·쓰레기 이벤트에도 throw 없이 정직한 null/unknown', () => {
    // 키 형식 불일치 → kind 'unknown' + null 필드 (클립 자체는 누락시키지 않는다)
    expect(parseClipKey('weird-key')).toEqual({ sessionId: 'weird-key', row: null, colId: null, kind: 'unknown' });
    expect(parseClipKey(`${SID}:NaN행:c8`)).toEqual({ sessionId: SID, row: null, colId: null, kind: 'unknown' });

    // sessions/events가 쓰레기여도 buildClipsManifest는 throw하지 않는다
    const manifest = buildClipsManifest(
      [{ file: 'clips/weird-key.wav', key: 'weird-key' }, { file: `clips/${SID}:1:c8.wav`, key: `${SID}:1:c8` }],
      [null, 42, { id: SID }] as unknown as Session[],
      [null, 'junk', { type: 'value' }] as unknown as ManifestSourceEvent[],
      '0.27.0',
    );
    expect(manifest.clipCount).toBe(2);
    expect(manifest.clips[0]).toMatchObject({ kind: 'unknown', committedValue: null, sttText: null, confidence: null });
    expect(manifest.clips[1]).toMatchObject({ kind: 'final', committedValue: null, sttText: null, confidence: null });
  });

  test('클립 0개 export(빈 세션 필터) → 빈 manifest, 여전히 유효', async () => {
    const zip = buildExportLikeZip([], [], []);
    attachClipsManifest(zip, [], [], '0.27.0');
    const manifest = await roundTripManifest(zip);
    expect(manifest.schema).toBe(CLIPS_MANIFEST_SCHEMA);
    expect(manifest.clipCount).toBe(0);
    expect(manifest.clips).toEqual([]);
  });
});
