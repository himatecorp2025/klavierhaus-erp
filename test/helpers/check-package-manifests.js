const fs=require("fs");
const path=require("path");

function stableObject(value){
  return Object.fromEntries(Object.entries(value||{}).sort(([left],[right])=>left.localeCompare(right)));
}

function validatePackageManifests(projectRoot=path.resolve(__dirname,"../..")){
  const packagePath=path.join(projectRoot,"package.json");
  const lockPath=path.join(projectRoot,"package-lock.json");
  const packageJson=JSON.parse(fs.readFileSync(packagePath,"utf8"));
  const packageLock=JSON.parse(fs.readFileSync(lockPath,"utf8"));
  const lockRoot=packageLock.packages&&packageLock.packages[""];

  if(!Number.isInteger(packageLock.lockfileVersion)||packageLock.lockfileVersion<1) throw new Error("INVALID_LOCKFILE_VERSION");
  if(!lockRoot) throw new Error("LOCKFILE_ROOT_MISSING");
  if(packageJson.name!==lockRoot.name||packageJson.version!==lockRoot.version) throw new Error("PACKAGE_IDENTITY_MISMATCH");
  if(JSON.stringify(stableObject(packageJson.dependencies))!==JSON.stringify(stableObject(lockRoot.dependencies))) throw new Error("DEPENDENCY_SET_MISMATCH");

  for(const dependency of Object.keys(packageJson.dependencies||{})){
    if(!packageLock.packages[`node_modules/${dependency}`]) throw new Error(`LOCKED_DEPENDENCY_MISSING:${dependency}`);
  }

  return {packageJson,packageLock};
}

if(require.main===module){
  validatePackageManifests();
  console.log("package.json and package-lock.json are valid and synchronized");
}

module.exports={validatePackageManifests};
