"use strict";
// dinobot desktop main entry (dist/main.cjs).
//
// Packaged builds run dist/main.jsc — V8 bytecode compiled by the exact packaged Electron
// binary (apps/desktop/scripts/bytecode.cjs, electron-builder afterExtract hook), so no
// plain main-process source ships in app.asar.
//
// The dev tree (`electron .`) runs the plain dist/main-bundle.cjs instead: stack traces and
// --inspect still point at real code, and no Electron binary is needed to build.
//
// DINOBOT_TEST_BYTECODE=1 forces the bytecode branch for tests on an unpacked dev-style app.
const app = require("electron").app;
if (!app.isPackaged && process.env.DINOBOT_TEST_BYTECODE !== "1") {
	module.exports = require("./main-bundle.cjs");
} else {
	const fs = require("node:fs");
	const path = require("node:path");
	const vm = require("node:vm");
	const v8 = require("node:v8");
	// Every function must stay eagerly compiled: if V8 flushed or never had a function's
	// bytecode, it would recompile from the placeholder source, which is blank.
	v8.setFlagsFromString("--no-lazy");
	v8.setFlagsFromString("--no-flush-bytecode");
	const bytecode = Buffer.from(fs.readFileSync(path.join(__dirname, "main.jsc")));
	// The cache was compiled under ELECTRON_RUN_AS_NODE while this process may run with
	// different V8 flags: adopt the runtime flag hash before handing the buffer to V8.
	new vm.Script("0").createCachedData().copy(bytecode, 12, 12, 16);
	const sourceLength = bytecode.readUInt32LE(8);
	const script = new vm.Script(" ".repeat(sourceLength), { cachedData: bytecode, filename: __filename });
	if (script.cachedDataRejected) {
		throw new Error("main.jsc rejected by this Electron's V8: it was built for a different Electron version or architecture");
	}
	const run = script.runInThisContext({ filename: __filename });
	const inner = { exports: {} };
	run(inner.exports, require, inner, __filename, __dirname);
	module.exports = inner.exports;
}
