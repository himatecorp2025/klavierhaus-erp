const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {validatePackageManifests}=require("./helpers/check-package-manifests");

function temporaryProject(packageJson,packageLockText){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"kh-manifest-test-"));
  fs.writeFileSync(path.join(directory,"package.json"),JSON.stringify(packageJson));
  fs.writeFileSync(path.join(directory,"package-lock.json"),packageLockText);
  return directory;
}

test("the committed package manifests are valid and synchronized",()=>{
  const {packageJson,packageLock}=validatePackageManifests(path.resolve(__dirname,".."));
  assert.equal(packageJson.dependencies.compression,"1.8.1");
  assert.equal(packageJson.dependencies.multer,"2.2.0");
  assert.equal(packageLock.packages["node_modules/multer"].version,"2.2.0");
});

test("manifest validation rejects non-JSON content appended to package-lock.json",()=>{
  const packageJson={name:"example",version:"1.0.0",dependencies:{}};
  const lock={name:"example",version:"1.0.0",lockfileVersion:3,packages:{"":packageJson}};
  const directory=temporaryProject(packageJson,`${JSON.stringify(lock)}\nUNEXPECTED TEXT`);
  assert.throws(()=>validatePackageManifests(directory),SyntaxError);
  fs.rmSync(directory,{recursive:true,force:true});
});

test("manifest validation rejects package and lock dependency drift",()=>{
  const packageJson={name:"example",version:"1.0.0",dependencies:{compression:"1.8.1"}};
  const lock={name:"example",version:"1.0.0",lockfileVersion:3,packages:{"":{name:"example",version:"1.0.0",dependencies:{}}}};
  const directory=temporaryProject(packageJson,JSON.stringify(lock));
  assert.throws(()=>validatePackageManifests(directory),/DEPENDENCY_SET_MISMATCH/);
  fs.rmSync(directory,{recursive:true,force:true});
});
