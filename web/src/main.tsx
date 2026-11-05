import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter-tight';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/index.css';
import './styles/theme-v2.css';
import './components/site/site.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

if (import.meta.env.DEV) {
  void import('./lib/auth/devtools').then(({ installAuthDevtools }) => installAuthDevtools());
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
