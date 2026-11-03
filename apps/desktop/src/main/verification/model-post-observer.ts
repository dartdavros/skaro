import { app, type Session } from 'electron';

/** Observe genuine Chromium POST attempts without replacing transport or provider responses. */
export function observeModelPosts(onPost: () => void) {
  const networks: Session[] = [];
  const observe = (network: Session) => {
    networks.push(network);
    network.webRequest.onBeforeRequest(
      { urls: ['https://openrouter.ai/api/v1/chat/completions'] },
      (details, callback) => {
        if (details.method === 'POST') onPost();
        callback({ cancel: false });
      },
    );
  };
  app.on('session-created', observe);
  return () => {
    app.removeListener('session-created', observe);
    for (const network of networks) network.webRequest.onBeforeRequest(null);
  };
}
