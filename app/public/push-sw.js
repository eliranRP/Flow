/* FLOW-502: web push for the generated service worker (vite.config.ts importScripts).
 * The send function posts JSON { title, body, url, tag }; a missing field falls back. */

/** A path in this app, or "/": a protocol-relative or foreign URL never opens. */
function sameOrigin(value) {
  if (typeof value !== "string" || value === "") return "/";
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title !== "" ? data.title : "Flow";
  const url = sameOrigin(data.url);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      lang: "he",
      dir: "rtl",
      icon: "/icons/icon-192.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = sameOrigin(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => "focus" in client);
      if (!open) return self.clients.openWindow(url);
      // navigate() rejects on a window this worker does not control yet: open a new one then.
      return open
        .focus()
        .then((client) => ("navigate" in client ? client.navigate(url) : client))
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
