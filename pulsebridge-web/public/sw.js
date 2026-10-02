// PulseBridge PWA Service Worker for Background Notifications & Push
const CACHE_NAME = 'pulsebridge-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Listen for message from client to display background notifications
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data.payload
    self.registration.showNotification(title, {
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      vibrate: [150, 80, 150],
      ...options,
    })
  }
})

// Tap notification to focus app
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/')
      }
    })
  )
})
