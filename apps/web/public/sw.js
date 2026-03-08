self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { message: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'T-Minus Zero';
  const body = payload.body || payload.message || '';
  const url = payload.url || (payload.launch_id ? `/launches/${payload.launch_id}` : '/');
  const tag = payload.tag || (payload.launch_id ? `launch:${payload.launch_id}` : undefined);

  const options = {
    body,
    tag,
    data: { url },
    icon: '/apple-touch-icon.png',
    badge: '/favicon-32x32.png'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification?.close();
  const url = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

