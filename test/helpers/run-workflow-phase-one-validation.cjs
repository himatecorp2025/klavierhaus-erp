"use strict";
// Repeated executable evidence; does not claim browser layout coverage.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const output=process.env.PHASE1_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'kh-phase1-results-'));
fs.mkdirSync(output,{recursive:true});
const runs=[];
for(let run=1;run<=15;run++){
 const started=new Date().toISOString();
 const result=spawnSync(process.execPath,['--test','test/workflow-phase-one.test.js'],{cwd:root,env:process.env,encoding:'utf8',maxBuffer:20*1024*1024});
 const log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(path.join(output,`run-${String(run).padStart(2,'0')}.tap`),log);
 const value=key=>Number(log.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]||0);
 const row={run,started,node:process.version,tests:value('tests'),pass:value('pass'),fail:value('fail'),skipped:value('skipped'),exit_code:result.status,frontend:'JS_RENDERER_AND_STATIC_CSS_ONLY',backend:'HTTP_API',database:'SQLITE_TRANSACTIONS',accounting:'WORKFLOW_FINANCIAL_CONTRACTS',browser:'BLOCKED_IN_HOST_ENVIRONMENT'};
 runs.push(row);console.log(JSON.stringify(row));fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({source:'klavierhaus-erp-develop (40).zip',runs},null,2));
 if(result.status!==0||row.pass!==17||row.fail){process.exitCode=1;break;}
}
