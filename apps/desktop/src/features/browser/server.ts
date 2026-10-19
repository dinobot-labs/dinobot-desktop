import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { BrowserController } from "./controller.ts";
import { MAX_BODY, record } from "./validation.ts";

export interface BrowserEndpoint { port: number; token: string; close(): Promise<void> }
/** No CORS, redirects, remote fetch or ambient cookies: only a local bearer-authenticated JSON action transport. */
export async function startBrowserServer(controller: BrowserController): Promise<BrowserEndpoint> {
 const token = randomBytes(32).toString("hex");
 let port = 0;
 const server = createServer((req, res) => { void handle(req, res).catch(() => send(res, 400, { id: 0, ok: false, error: "InvalidRequest" })); });
 server.requestTimeout = 65000;
 server.headersTimeout = 10000;
 server.timeout = 65000;
 server.maxHeadersCount = 32;
 function send(res: ServerResponse, status: number, body: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
 }
 async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.headers.origin !== undefined || req.headers.host !== `127.0.0.1:${port}` || req.method !== "POST" || req.url !== "/action") { send(res, 403, { id: 0, ok: false, error: "Forbidden" }); return; }
  const auth = req.headers.authorization ?? "";
  const expected = `Bearer ${token}`;
  if (Buffer.byteLength(auth) !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) { send(res, 401, { id: 0, ok: false, error: "Unauthorized" }); return; }
  if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json" || req.headers["content-encoding"] !== undefined) { send(res, 415, { id: 0, ok: false, error: "ExpectedJSON" }); return; }
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) { send(res, 413, { id: 0, ok: false, error: "BodyTooLarge" }); return; }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
   bytes += chunk.length;
   if (bytes > MAX_BODY) { send(res, 413, { id: 0, ok: false, error: "BodyTooLarge" }); return; }
   chunks.push(Buffer.from(chunk));
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { send(res, 400, { id: 0, ok: false, error: "InvalidJSON" }); return; }
  if (!record(body) || Object.keys(body).some(key => !["id", "cmd", "args"].includes(key)) || !Number.isSafeInteger(body.id) || (body.id as number) < 0 || typeof body.cmd !== "string" || !record(body.args)) { send(res, 400, { id: 0, ok: false, error: "InvalidRequest" }); return; }
  const lifetime = new AbortController();
  const socket = req.socket;
  // IncomingMessage "close" also fires after a normally consumed request body.
  // Only a premature response/socket closure cancels an admitted browser action.
  const disconnected = () => { if (!res.writableFinished) lifetime.abort(); };
  res.once("close", disconnected);
  socket.once("close", disconnected);
  try {
   if (res.destroyed || socket.destroyed) lifetime.abort();
   send(res, 200, await controller.agent(body.id as number, body.cmd, body.args, lifetime.signal));
  } finally {
   res.removeListener("close", disconnected);
   socket.removeListener("close", disconnected);
  }
 }
 await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
 const address = server.address();
 if (!address || typeof address === "string") throw new Error("loopback listen failed");
 port = address.port;
 let closing: Promise<void> | undefined;
 return { port, token, close: () => closing ??= new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}
