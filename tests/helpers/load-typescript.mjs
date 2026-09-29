import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Compile trusted repository source; injected transports keep tests offline.
export function load(file,imports={}) {
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const loaded={exports:{}};
 new Function('module','exports','require',code)(loaded,loaded.exports,name=>{
  if(!Object.hasOwn(imports,name))throw new Error('Unexpected test dependency: '+name);
  return imports[name];
 });
 return loaded.exports;
}
