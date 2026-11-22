chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.tab && message.type === 'snapshot' && sender.frameId === 0) {
    chrome.storage.session.set({['tab-' + sender.tab.id]: message.report})
      .then(() => reply(true), () => reply(false));
    return true;
  }
});
chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove('tab-' + id));
