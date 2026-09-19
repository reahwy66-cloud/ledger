import { httpServerHandler } from 'cloudflare:node';
import './server.js';

/* server.js starts Express on port 3000 when PORT is not set. Cloudflare's
   Node HTTP bridge forwards Worker requests to that same in-isolate server. */
export default httpServerHandler({ port: 3000 });
