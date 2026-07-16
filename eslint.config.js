// v0.35.1 Stage 1-8 — GL-006 공통 개발 헌장 §5의 강제 장치 (민구 채택 2026-07-16).
// 파일 크기는 책임 크기의 신호: 300줄 분리 검토, 500줄 리팩토링 대상. 500을 오류 상한으로 강제하고
// 기존 초과 파일은 파일 상단 eslint-disable + KNOWN-ISSUES [ENV-12] 예외 목록으로 관리하며
// 리팩토링 Stage 2·3에서 순차 해소한다(해소 즉시 disable 주석 제거).
// 규칙은 max-lines 하나뿐인 최소 구성 — 스타일 린트가 아니라 크기 게이트다(필요 이상 도입 금지).
// tsPlugin/reactHooks는 규칙을 켜지 않고 **정의만** 등록한다 — 기존 소스의 인라인
// eslint-disable(@typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps) 주석이
// "정의 없는 규칙" 오류를 내지 않게 하기 위함.
import parser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: { parser },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
    },
  },
];
