#!/usr/bin/env node
// Server process entry point. The CLI spawns this detached; it is not meant to
// be run directly, though doing so works fine.
import { silenceSqliteWarning } from "./quiet.js";

silenceSqliteWarning();

const { listen } = await import("./server.js");

const envPort = Number(process.env.PV_PORT);
listen(Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : 8974);
