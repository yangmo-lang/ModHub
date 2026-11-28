import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Overlay from './Overlay.jsx';
import './styles.css';

// 同一份前端：#overlay 是遊戲內疊加介面
const isOverlay = window.location.hash === '#overlay';
if (isOverlay) document.body.classList.add('overlay-body');
createRoot(document.getElementById('root')).render(isOverlay ? <Overlay /> : <App />);
