self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Flow", body: "", url: "/" };
  event.waitUntil(
    self.registration.showNotification(data.title || "Flow", {
      body: data.body || "",
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(self.clients.openWindow(target));
});
