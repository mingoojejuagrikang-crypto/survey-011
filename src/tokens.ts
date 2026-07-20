export const T = {
  bg: '#0E0F11',
  card: '#1A1C1F',
  cardAlt: '#222428',
  inputBg: '#0F1114',
  line: 'rgba(255,255,255,0.07)',
  lineStrong: 'rgba(255,255,255,0.13)',
  text: '#F5F5F7',
  textDim: '#A4A8B0',
  textMute: '#6B7079',
  blue: '#2979FF',
  blueGlow: 'rgba(41,121,255,0.32)',
  green: '#00C853',
  amber: '#FFB300',
  red: '#FF5252',
  // v0.34.0 B8 — 상태색 글로우 변형(blueGlow와 동일 계열·동일 alpha). EdgeGlow(화면 외곽
  // 은은한 페이드)가 세션 상태 톤(green/amber/red)을 표현할 때 쓴다. 인라인 rgba 일회값 금지.
  greenGlow: 'rgba(0,200,83,0.32)',
  amberGlow: 'rgba(255,179,0,0.32)',
  redGlow: 'rgba(255,82,82,0.32)',
  // v0.36.0 FB#5(Vance) — EdgeGlow "Siri 활성화급" 강화용 고-alpha 변형. 밝고 좁은 안쪽 링에 겹쳐
  //   최근 iPhone Siri처럼 또렷하고 생동감 있는 외곽 밴드를 만든다(넓은 저-alpha 블룸 + 이 선명한
  //   코어). tone 의미(green/amber/red)·red 우선순위 SSOT는 불변 — 색만 같은 계열로 진하게.
  greenGlowStrong: 'rgba(0,200,83,0.60)',
  amberGlowStrong: 'rgba(255,179,0,0.60)',
  redGlowStrong: 'rgba(255,82,82,0.60)',
  // v0.36.0 코덱스 시안(2026-07-20) — 화면 안쪽 4겹 엣지글로우의 최외곽 저-alpha 블룸(≈94px).
  //   soft(0.32)·strong(0.60)과 같은 계열의 faint(0.14) 변형 — 인라인 rgba 일회값 금지 원칙 유지.
  greenGlowFaint: 'rgba(0,200,83,0.14)',
  amberGlowFaint: 'rgba(255,179,0,0.14)',
  redGlowFaint: 'rgba(255,82,82,0.14)',
  google: '#4285F4',
} as const;

export const TYPE_LABELS = {
  date: '날짜',
  text: '텍스트',
  int: '정수',
  float: '실수',
  options: '리스트',
  name: '이름',
} as const;

export const TYPE_COLORS = {
  date: { fg: '#7AB8FF', bg: 'rgba(122,184,255,0.13)' },
  text: { fg: '#C9C9D1', bg: 'rgba(201,201,209,0.10)' },
  int: { fg: '#FFB300', bg: 'rgba(255,179,0,0.13)' },
  float: { fg: '#FF9F70', bg: 'rgba(255,159,112,0.13)' },
  options: { fg: '#A78BFA', bg: 'rgba(167,139,250,0.13)' },
  name: { fg: '#50C878', bg: 'rgba(80,200,120,0.13)' },
} as const;

export const DEVICE = {
  width: 375,
  height: 812,
  statusBar: 62,
  tabBar: 88,
  content: 662,
} as const;
