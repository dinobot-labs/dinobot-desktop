// Disposable JSONL host fixture. It never imports Patchright or opens a browser.
export {};
for await (const line of console) {
 const req = JSON.parse(line) as { id: number; cmd: string; args: Record<string, unknown> };
 if (req.cmd === "fixture-exit") process.exit(9);
 if (req.cmd === "fixture-hang") { await new Promise<void>(() => {}); break; }
 if (req.cmd === "fixture-error") { process.stderr.write("Cookie: do-not-log-this\n"); console.log(JSON.stringify({ id: req.id, ok: false, error: "Cookie: do-not-show-this Bearer token" })); continue; }
 const result = req.cmd.startsWith("ui_") ? { text: "", ui: { ok: true } } : { text: JSON.stringify({ cmd: req.cmd, args: req.args, config: JSON.parse(process.env.DINOBOT_BROWSER_CONFIG ?? "{}") }) };
 console.log(JSON.stringify({ id: req.id, ok: true, result }));
}
