const Koa = require("koa");
const serve = require("koa-static");
const proxy = require("koa-proxy");
const Router = require("koa-router");
import * as koaBody from "koa-body";
import * as http from "http";
import { Settings } from "./settings";
import Axios from "axios";
import { AddressInfo } from "net";

let gScampServer: any = null;

const createApp = (getOriginPort: () => number) => {
  const app = new Koa();
  app.use(koaBody.default({ multipart: true }));

  const router = new Router();
  router.get(new RegExp("/scripts/.*"), (ctx: any) => ctx.throw(403));
  router.get(new RegExp("\.es[mpl]"), (ctx: any) => ctx.throw(403));
  router.get(new RegExp("\.bsa"), (ctx: any) => ctx.throw(403));

  router.post("/rpc/:rpcClassName", (ctx: any) => {
    const { rpcClassName } = ctx.params;
    const { payload } = ctx.request.body;

    if (gScampServer.onHttpRpcRunAttempt) {
      ctx.body = gScampServer.onHttpRpcRunAttempt(rpcClassName, payload);
    }
  });

  // Basic health check endpoint
  router.get("/health", async (ctx: any) => {
    ctx.body = { 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      service: 'skymp-game-server'
    };
  });
  
  app.use(router.routes()).use(router.allowedMethods());
  app.use(serve("data"));
  return app;
};

export const setServer = (scampServer: any) => {
  gScampServer = scampServer;
};

const startStaticFileServer = (uiPort: number, uiListenHost: string = "127.0.0.1") => {
  const appStatic = createApp(() => uiPort);

  return new Promise((resolve, reject) => {
    try {
      const srv = http.createServer(appStatic.callback());

      srv.listen(uiPort, uiListenHost, () => {
        const addr = srv.address() as AddressInfo;
        console.log(`Static file server listening on ${addr.address}:${addr.port}`);
        resolve(srv);
      });

      srv.on('error', (error) => {
        console.error(`Static file server error:`, error);
        reject(error);
      });
    } catch (error) {
      console.error(`Failed to start static file server:`, error);
      reject(error);
    }
  });
};

const startProxyServer = (uiPort: number, originPort: number, uiListenHost: string = "127.0.0.1") => {
  const appProxy = new Koa();
  appProxy.use(proxy({
    host: `http://127.0.0.1:${originPort}`
  }));

  return new Promise((resolve, reject) => {
    try {
      const srv = http.createServer(appProxy.callback());
      srv.listen(uiPort, uiListenHost, () => {
        const addr = srv.address() as AddressInfo;
        console.log(`Proxy server listening on ${addr.address}:${addr.port}, proxying to port ${originPort}`);
        resolve(srv);
      });

      srv.on('error', (error) => {
        console.error(`Proxy server error:`, error);
        reject(error);
      });
    } catch (error) {
      console.error(`Failed to start proxy server:`, error);
      reject(error);
    }
  });
};

const startCombinedServer = (uiPort: number, originPort: number, uiListenHost: string = "127.0.0.1") => {
  const app = createApp(() => originPort);
  
  return new Promise((resolve, reject) => {
    try {
      const server = http.createServer(app.callback());
      server.listen(uiPort, uiListenHost, () => {
        const addr = server.address() as AddressInfo;
        console.log(`Game server UI listening on ${addr.address}:${addr.port}`);
        resolve(server);
      });

      server.on('error', (error) => {
        console.error(`Game server UI error:`, error);
        reject(error);
      });
    } catch (error) {
      console.error(`Failed to start game server UI:`, error);
      reject(error);
    }
  });
};

export const run = async (
  uiPort: number,
  originPort: number,
  uiListenHost: string = "127.0.0.1",
  dataDir: string = process.cwd(),
  settings: Settings,
) => {
  process.chdir(dataDir);

  let server: any = null;

  if (originPort > 0) {
    // Check if origin server is available
    try {
      await Axios.get(`http://127.0.0.1:${originPort}/health`, { timeout: 5000 });
      console.log(`Origin server detected on port ${originPort}, starting proxy mode`);
      server = await startProxyServer(uiPort, originPort, uiListenHost);
    } catch (error) {
      console.log(`No origin server on port ${originPort}, starting combined mode`);
      server = await startCombinedServer(uiPort, originPort, uiListenHost);
    }
  } else {
    console.log(`Starting static file server mode`);
    server = await startStaticFileServer(uiPort, uiListenHost);
  }

  return server;
};
