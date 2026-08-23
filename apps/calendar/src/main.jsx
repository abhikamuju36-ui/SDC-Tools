import React from 'react';
import { createRoot } from 'react-dom/client';
import '../frontend/styles.css';
import App from './App.jsx';

const preLoader = document.getElementById('pre-loader');
if (preLoader) preLoader.style.display = 'none';

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
