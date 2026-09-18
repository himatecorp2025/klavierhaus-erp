"use strict";
// Repeat the complete Phase I preservation + Phase II integration gate.
// DOM assertions use Happy DOM; this does not certify browser visual layout.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
if(process.version!=='v20.18.0')throw new Error('Use Node.js v20.18.0 for this release gate.');
if(!process.env.HAPPY_DOM_MODULE)throw new Error('Set HAPPY_DOM_MODULE to happy-dom/lib/index.js (tested with 20.0.8).');
const output=path.resolve(process.env.WORKFLOW_VALIDATION_DIR||'workflow-v2-validation');
fs.mkdirSync(output,{recursive:true});
const results=[];
for(let run=1;run<=15;run++){
 const started=new Date().toISOString(),r=spawnSync(process.execPath,['--test','--test-concurrency=1','test/workflow-phase-one.test.js','test/workflow-v2.test.js'],{cwd:path.resolve(__dirname,'../..'),env:process.env,encoding:'utf8',maxBuffer:40*1024*1024});
 const log=(r.stdout||'')+(r.stderr||''),read=name=>Number(log.match(new RegExp('^# '+name+' (\\d+)','m'))?.[1]||0);
 fs.writeFileSync(path.join(output,'run-'+String(run).padStart(2,'0')+'.tap'),log);
 const entry={run,started,finished:new Date().toISOString(),node:process.version,exit:r.status,tests:read('tests'),pass:read('pass'),fail:read('fail'),skipped:read('skipped'),dom:/^ok \d+ - 17: real DOM/m.test(log)?'PASS':'CHECK_LOG',visual_layout:'NOT_RUN'};
 results.push(entry);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(entry));
 if(r.status!==0||entry.fail||entry.skipped||entry.tests!==38){process.exitCode=1;break;}
}
