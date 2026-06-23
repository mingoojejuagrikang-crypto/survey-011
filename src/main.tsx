import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { initPwaUpdate } from './lib/pwaUpdate';

// v0.18.0 1f — PWA 수동 SW 등록 + 능동 업데이트 체크(비강제 프롬프트). vite.config는
// injectRegister:null이라 여기서 한 번만 등록한다(이중 등록 방지). 강제 리로드는 하지 않는다.
initPwaUpdate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
