import { httpServerHandler } from 'cloudflare:node';
import { runDueNotifications } from './server.js';

const http = httpServerHandler({ port: 3000 });

export default {
  fetch(request, env, ctx) {
    return http.fetch(request, env, ctx);
  },
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(runDueNotifications());
  }
};
