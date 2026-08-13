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

test('F5 — 커밋 이후 같은 셀에 들어온 비커밋 발화가 sttText를 덮지 않는다', () => {
  // 🔴 실측(2026-07-27 B세션 row16 횡경): `committedValue=311.1`인데 `sttText="완료"`로 남았다.
  //    events.json이 시간순이라 "뒤에서 첫 매칭"을 채택하면 **커밋 뒤에 온 다음 명령 발화**가
  //    감사 메타데이터를 덮는다. 오디오·시트값은 무손상이지만 **다음 클립 감사가 거짓 MISMATCH**를
  //    내고, 그러면 진짜 오염을 찾는 능력이 같이 죽는다.
  const events = [
    { type: 'stt', sessionId: 'S1', row: 16, colId: 'c1', text: '삼백십일 점 일', confidence: 0.97 },
    { type: 'value', sessionId: 'S1', row: 16, colId: 'c1', text: '311.1', confidence: 0.97 },
    // 커밋 **이후** 같은 셀 컨텍스트에서 들어온 비커밋 발화(다음 명령).
    { type: 'stt', sessionId: 'S1', row: 16, colId: 'c1', text: '완료', confidence: 0.42 },
  ] as unknown as ManifestSourceEvent[];
  const manifest = buildClipsManifest(
    [{ file: 'clips/S1:16:c1.webm', key: 'S1:16:c1' }],
    [{ id: 'S1', rows: [{ index: 16, values: { c1: '311.1' } }] }] as unknown as Session[],
    events,
    '0.40.0',
  );
  const entry = manifest.clips[0];
  expect(entry.committedValue, '시트에 올라간 값').toBe('311.1');
  expect(entry.sttText, '커밋 발화가 감사 신호로 남는다(비커밋 "완료"가 아니라)').toBe('311.1');
  expect(entry.confidence).toBe(0.97);
});

test('F5 — value 이벤트가 아예 없으면 stt로 폴백한다(기존 동작 보존)', () => {
  const events = [
    { type: 'stt', sessionId: 'S1', row: 2, colId: 'c1', text: '이십오 점 영', confidence: 0.88 },
  ] as unknown as ManifestSourceEvent[];
  const manifest = buildClipsManifest(
    [{ file: 'clips/S1:2:c1.webm', key: 'S1:2:c1' }],
    [{ id: 'S1', rows: [{ index: 2, values: {} }] }] as unknown as Session[],
    events,
    '0.40.0',
  );
  expect(manifest.clips[0].sttText, 'value가 없으면 stt가 그대로 쓰인다').toBe('이십오 점 영');
});

/** ── v0.49 r2 A3(codex F3) — W4 섀도 계측이 원 STT의 confidence를 가리지 않는다 ────────── */

test('A3 — would_salvage 합성 stt가 원 final STT의 confidence를 가리지 않는다', () => {
  // 🔴 실측(codex F3): `상식 3.3`처럼 extraneous_token으로 거절된 뒤 재발화 전에 세션이 끝나면
  //    그 셀은 **미커밋**이라 stt 폴백이 쓰인다. W4가 그 뒤에 쓰는 합성 라인
  //    (`type:'stt'` + `extra:'would_salvage:…'`)은 confidence를 싣지 않으므로, 역순 폴백이
  //    그 줄을 먼저 만나 원 final의 0.95가 **null로 떨어졌다**. 값·거절 동작은 안전했지만
  //    기존 클립 감사 메타데이터가 깨진다(W4의 「기존 집계 비파괴」 축 위반).
  const events = [
    { type: 'stt', sessionId: 'S1', row: 2, colId: 'c1', text: '상식 3.3', confidence: 0.95 },
    { type: 'stt_parse_failed', sessionId: 'S1', row: 2, colId: 'c1', text: '상식 3.3', extra: 'extraneous_token' },
    { type: 'stt', sessionId: 'S1', row: 2, colId: 'c1', text: '상식 3.3', extra: 'would_salvage:3.3' },
  ] as unknown as ManifestSourceEvent[];
  const manifest = buildClipsManifest(
    [{ file: 'clips/S1:2:c1.webm', key: 'S1:2:c1' }],
    [{ id: 'S1', rows: [{ index: 2, values: { c1: '' } }] }] as unknown as Session[],
    events,
    '0.49.0',
  );
  const entry = manifest.clips[0];
  expect(entry.sttText, '원 발화 텍스트는 그대로다').toBe('상식 3.3');
  expect(entry.confidence, '합성 라인이 원 STT의 confidence를 가렸다').toBe(0.95);
});

test('A3 — 합성 라인이 그 셀의 유일한 stt면 정직하게 null이다(합성값을 관측인 척 싣지 않는다)', () => {
  // 실사용에선 원 final stt가 항상 선행하므로 도달하지 않는 경계다. 그래도 고정한다 —
  // 「건너뛴다」의 의미가 「무시하고 그 앞을 쓴다」이지 「합성값으로 대체한다」가 아님을
  // 못박아 두지 않으면, 다음 감사 도구 변경이 이 null을 새 회귀로 보고한다.
  const events = [
    { type: 'stt', sessionId: 'S1', row: 3, colId: 'c1', text: '상식 3.3', extra: 'would_salvage:3.3' },
  ] as unknown as ManifestSourceEvent[];
  const manifest = buildClipsManifest(
    [{ file: 'clips/S1:3:c1.webm', key: 'S1:3:c1' }],
    [{ id: 'S1', rows: [{ index: 3, values: { c1: '' } }] }] as unknown as Session[],
    events,
    '0.49.0',
  );
  expect(manifest.clips[0].sttText).toBeNull();
  expect(manifest.clips[0].confidence).toBeNull();
});

test('r3 #10 — 다른 주석 stt(manual_hold_restore)도 원 STT의 confidence를 가리지 않는다', () => {
  // 🔴 claude r2 #10 — A3의 가드가 `would_salvage:` **단일 접두 allowlist**라, 같은 셀 좌표로
  //    남는 다른 주석 라인은 그대로 통과했다. `manual_hold_restore_controller:started`
  //    (useVoiceSession :4334)는 text·confidence가 **아예 없어** 원 STT의 0.95를 null로 떨어뜨리고
  //    sttText까지 지운다 — A3가 고친 것과 완전히 같은 가림이고 접두만 다르다.
  //    이제 판별은 접두가 아니라 구조다: 엔진 관측 라인에는 `extra`가 없다.
  const events = [
    { type: 'stt', sessionId: 'S1', row: 5, colId: 'c1', text: '삼십삼 점 삼', confidence: 0.95 },
    { type: 'stt', sessionId: 'S1', row: 5, colId: 'c1', extra: 'manual_hold_restore_controller:started' },
  ] as unknown as ManifestSourceEvent[];
  const manifest = buildClipsManifest(
    [{ file: 'clips/S1:5:c1.webm', key: 'S1:5:c1' }],
    [{ id: 'S1', rows: [{ index: 5, values: { c1: '' } }] }] as unknown as Session[],
    events,
    '0.49.0',
  );
  expect(manifest.clips[0].sttText, '주석 라인이 원 발화 텍스트를 지웠다').toBe('삼십삼 점 삼');
  expect(manifest.clips[0].confidence, '주석 라인이 원 STT의 confidence를 가렸다').toBe(0.95);
});

test('r3 #10 — 파서 주석(decimal_fraction_recovered)도 관측으로 세지 않는다 — 모르는 태그는 제외', () => {
  // allowlist는 **열린 채 실패**한다(새 태그가 추가될 때마다 조용히 구멍). 이제 닫힌 채 실패한다.
  const events = [
    { type: 'stt', sessionId: 'S1', row: 6, colId: 'c1', text: '이십구 점 부', confidence: 0.82 },
    { type: 'stt', sessionId: 'S1', row: 6, colId: 'c1', text: '29.9', extra: 'decimal_fraction_recovered' },
  ] as unknown as ManifestSourceEvent[];
  const manifest = buildClipsManifest(
    [{ file: 'clips/S1:6:c1.webm', key: 'S1:6:c1' }],
    [{ id: 'S1', rows: [{ index: 6, values: { c1: '' } }] }] as unknown as Session[],
    events,
    '0.49.0',
  );
  expect(manifest.clips[0].sttText).toBe('이십구 점 부');
  expect(manifest.clips[0].confidence).toBe(0.82);
});

test('A3 — 접두가 같아도 `value` 이벤트는 건너뛰지 않는다(스킵 대상은 합성 stt뿐)', () => {
  const events = [
    { type: 'stt', sessionId: 'S1', row: 4, colId: 'c1', text: '삼십삼 점 삼', confidence: 0.71 },
    { type: 'value', sessionId: 'S1', row: 4, colId: 'c1', text: '삼십삼 점 삼', parsed: '33.3', confidence: 0.71, extra: 'would_salvage:3.3' },
  ] as unknown as ManifestSourceEvent[];
  const manifest = buildClipsManifest(
    [{ file: 'clips/S1:4:c1.webm', key: 'S1:4:c1' }],
    [{ id: 'S1', rows: [{ index: 4, values: { c1: '33.3' } }] }] as unknown as Session[],
    events,
    '0.49.0',
  );
  expect(manifest.clips[0].confidence, '커밋 이벤트는 extra와 무관하게 감사 신호다').toBe(0.71);
});
