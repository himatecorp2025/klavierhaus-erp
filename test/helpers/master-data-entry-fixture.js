'use strict';
// Invoke the production entry-point functions with a captured common-dialog
// boundary. Actual DOM/save integration is verified separately in Chromium.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../public/app.js'),'utf8');
const boundaries={openNestedClientModal:'\nfunction ensureInlineClientPrompt',openNestedJobPianoModal:'\nfunction createNestedClientStateMachine'};
function entry(name,open){
 const start=source.indexOf('function '+name+'('),end=source.indexOf(boundaries[name],start);
 if(start<0||end<=start)throw new Error('Cannot isolate production entry '+name);
 return vm.runInNewContext('('+source.slice(start,end).trim()+')',{MasterData:{open}});
}
module.exports={entry};
