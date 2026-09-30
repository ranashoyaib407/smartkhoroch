const CACHE_NAME = 'smartkhoroch-v3';

const STATIC_ASSETS = [
  '/manifest.json',
  '/app-icon-192.png'
];

/* =========================================================
   FIREBASE CLOUD MESSAGING — নতুন অংশ
   পুরাতন PWA logic অপরিবর্তিত রাখা হয়েছে
   ========================================================= */

importScripts(
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js'
);

importScripts(
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js'
);

const firebaseConfig = {
  apiKey: "AIzaSyBmBqMYex_qjSuiVuF2GWAkOLnfcti3wWM",
  authDomain: "smartkhoroch.firebaseapp.com",
  projectId: "smartkhoroch",
  storageBucket: "smartkhoroch.firebasestorage.app",
  messagingSenderId: "527246087111",
  appId: "1:527246087111:web:038798401b3eebefd47fe2",
  measurementId: "G-MGGJ1XM8S2"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

/*
  Background push notification
*/
messaging.onBackgroundMessage((payload) => {

  const data = payload.data || {};

  const title = data.title || 'SmartKhoroch';

  const options = {
    body: data.body || '',
    icon: '/app-icon-192.png',
    badge: '/app-icon-192.png',

    data: {
      url: data.url || '/'
    },

    tag: data.tag || 'smartkhoroch-notification',

    renotify: false
  };

  return self.registration.showNotification(
    title,
    options
  );
});


/* =========================================================
   পুরাতন PWA CODE — রাখা হয়েছে
   ========================================================= */

// Install
self.addEventListener('install', (event) => {

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {

      return cache.addAll(STATIC_ASSETS);

    })
  );

  self.skipWaiting();

});


// Activate
self.addEventListener('activate', (event) => {

  event.waitUntil(

    caches.keys().then((keys) => {

      return Promise.all(

        keys.map((key) => {

          if (key !== CACHE_NAME) {

            return caches.delete(key);

          }

        })

      );

    })

  );

  self.clientsClaim();

});


// Fetch
self.addEventListener('fetch', (event) => {

  // HTML/page request হলে সবসময় network থেকে নতুন version নেওয়া হবে

  if (event.request.mode === 'navigate') {

    event.respondWith(

      fetch(event.request).catch(() => {

        return caches.match('/index.html');

      })

    );

    return;

  }


  // অন্যান্য static file

  event.respondWith(

    fetch(event.request).catch(() => {

      return caches.match(event.request);

    })

  );

});


/* =========================================================
   NOTIFICATION CLICK — নতুন অংশ
   ========================================================= */

self.addEventListener('notificationclick', (event) => {

  event.notification.close();

  const targetUrl =
    event.notification?.data?.url || '/';

  event.waitUntil(

    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {

      for (const client of clientList) {

        if ('focus' in client) {

          return client.focus();

        }

      }

      if (clients.openWindow) {

        return clients.openWindow(targetUrl);

      }

    })

  );

});
