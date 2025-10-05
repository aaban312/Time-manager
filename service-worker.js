// Service Worker: best-effort scheduling for notifications.
// IMPORTANT: Web platform currently does not guarantee background timers when browser is killed.
// This SW will try to use the Notification Triggers API (showTrigger) if available.
// It also listens to messages from the page to schedule notifications.
self.addEventListener('install', event=>{
  self.skipWaiting();
  console.log('service-worker installed');
});
self.addEventListener('activate', event=>{
  event.waitUntil(self.clients.claim());
  console.log('service-worker activated');
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  // Focus/open clients
  event.waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}).then(function(cList){
    if(cList.length>0) return cList[0].focus();
    return clients.openWindow('/');
  }));
});

// Listen for messages to schedule notifications
self.addEventListener('message', event=>{
  const data = event.data || {};
  if(data && data.cmd === 'scheduleNotification'){
    scheduleNotification(data);
  }
});

function scheduleNotification(data){
  const { tag, title, body, timestamp } = data;
  const when = Number(timestamp) || Date.now();
  // Try Notification Triggers API
  try{
    if(self.registration && self.registration.showNotification){
      // If the browser supports showTrigger, use it (Chrome origin trial/experiments).
      // TimestampTrigger may not exist; create if available.
      const supportsTrigger = typeof TimestampTrigger !== 'undefined' || (self.Registration && 'showNotification' in self.registration);
      if(typeof TimestampTrigger !== 'undefined'){
        self.registration.showNotification(title, {
          body,
          tag: tag,
          showTrigger: new TimestampTrigger(when)
        });
        console.log('Scheduled notification with showTrigger for', when);
        return;
      }
    }
  }catch(e){
    console.warn('showTrigger failed', e);
  }
  // Fallback: try to set a timer while the SW is alive (best-effort only)
  const delay = Math.max(0, when - Date.now());
  setTimeout(function(){
    self.registration.showNotification(title, { body, tag });
  }, delay);
}



// Additional message handlers for Trigger API scheduling (Option 3)
const __scheduled = new Map();

self.addEventListener('message', event=>{
  const data = event.data || {};
  if(!data || !data.cmd) return;
  if(data.cmd === 'scheduleNotification' || data.cmd === 'scheduleNotificationTrigger'){
    scheduleNotificationTrigger(data);
  } else if(data.cmd === 'cancelAllScheduled'){
    cancelAllScheduled();
  }
});

function cancelAllScheduled(){
  __scheduled.forEach((v,k)=>{ if(v.timeoutId) clearTimeout(v.timeoutId); });
  __scheduled.clear();
  console.log('Cleared SW scheduled list');
}

async function scheduleNotificationTrigger(data){
  const { id, title, body, timestamp } = data;
  const when = Number(timestamp) || Date.now();
  // Try to use showTrigger if available
  try{
    if('showTrigger' in Notification.prototype || typeof TimestampTrigger !== 'undefined'){
      // Use registration.showNotification with showTrigger
      // TimestampTrigger may be available in global scope
      const trigger = (typeof TimestampTrigger !== 'undefined') ? new TimestampTrigger(when) : null;
      if(trigger){
        await self.registration.showNotification(title || 'Notification', { body: body || '', tag: id, showTrigger: trigger });
        __scheduled.set(id, { when, via: 'showTrigger' });
        console.log('Scheduled via showTrigger', id, when);
        return;
      }
    }
  }catch(e){
    console.warn('showTrigger attempt failed', e);
  }
  // Fallback: best-effort setTimeout while SW is alive (not reliable when SW is terminated)
  const delay = Math.max(0, when - Date.now());
  const timeoutId = setTimeout(()=> {
    self.registration.showNotification(title || 'Notification', { body: body || '', tag: id });
    __scheduled.delete(id);
  }, delay);
  __scheduled.set(id, { when, timeoutId, via: 'timeout' });
  console.log('Scheduled fallback timeout', id, when, delay);
}
