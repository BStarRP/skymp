import React from 'react';
import ReactDOM from 'react-dom';

import App from './App';

import { store } from './redux/store';
import { Provider } from 'react-redux';

import { Widgets } from './utils/Widgets';

import './main.scss';

if (!window.skyrimPlatform) {
  window.skyrimPlatform = {};
  window.needToScroll = true;
}

if (!window.skyrimPlatform.widgets) {
  window.skyrimPlatform.widgets = new Widgets([]);
}

ReactDOM.render(
  <React.StrictMode>
    <Provider store={store}>
      <App elem={window.skyrimPlatform.widgets.get()} />
    </Provider>
  </React.StrictMode>,
  document.getElementById('root')
);

// Send front-loaded message to notify the client that the UI is ready
if (window.skyrimPlatform && window.skyrimPlatform.sendMessage) {
  console.log('Sending front-loaded message');
  window.skyrimPlatform.sendMessage('front-loaded');
} else {
  console.log('skyrimPlatform.sendMessage not available yet, deferring front-loaded message');
  // Try again after a short delay
  setTimeout(() => {
    if (window.skyrimPlatform && window.skyrimPlatform.sendMessage) {
      console.log('Sending front-loaded message (delayed)');
      window.skyrimPlatform.sendMessage('front-loaded');
    } else {
      console.error('skyrimPlatform.sendMessage still not available');
    }
  }, 100);
}

// Called from skymp5-functions-lib, chatProperty.ts
window.scrollToLastMessage = () => {
  const _list = document.querySelector('#chat > .chat-main > .list > .chat-list');
  if (_list != null && window.needToScroll) { _list.scrollTop = _list.offsetHeight * _list.offsetHeight; }
};

window.playSound = (name) => {
  (new Audio(require('./sound/' + name).default)).play();
};

