import {test,expect} from "bun:test";
import {compareRuntime} from "./resource-compatibility.ts";
const host={path:"dinobot.exe",sha256:"host"};
const native={path:"resources/daemon/node_modules/native.node",sha256:"native"};
test("identical host and native bytes permit resource-only preflight",()=>{expect(()=>compareRuntime([host,native],[host,native,{path:"Uninstall dinobot.exe",sha256:"extra"}])).not.toThrow();});
test("same displayed version cannot mask changed executable bytes",()=>{expect(()=>compareRuntime([host],[{...host,sha256:"changed"}])).toThrow("mismatch");});
test("changed or newly required native addon rejects resource-only update",()=>{expect(()=>compareRuntime([host,native],[host])).toThrow("mismatch");expect(()=>compareRuntime([host,native],[host,{...native,sha256:"old"}])).toThrow("mismatch");});
test("missing Electron candidate fails",()=>{expect(()=>compareRuntime([native],[native])).toThrow("missing");});
