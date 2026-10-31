import { strict as assert } from "node:assert";
import { realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
const root = resolve(import.meta.dir, "..");
const from = resolve(root, "apps/web");
for (const name of ["@dinobot/ui", "@dinobot/ui/styles.css"]) {
 const path = Bun.resolveSync(name, from);
 const real = realpathSync(path);
 const local = relative(resolve(root, "packages/ui"), real);
 assert(!local.startsWith("..") && !isAbsolute(local), name + " escaped the worktree");
 console.log(JSON.stringify({from,name,path,real}));
}
