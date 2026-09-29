"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Database=require("better-sqlite3");
const {createInventoryService}=require("../server/inventory");

function fixture(){
  const db=new Database(":memory:");
  db.exec(fs.readFileSync(path.join(__dirname,"..","server","schema.sql"),"utf8"));
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status) VALUES('U1','Inventory Admin','inventory@example.com','x','ADMIN','Active')").run();
  const clientId=Number(db.prepare("INSERT INTO clients(name,email) VALUES('Inventory Client','client@example.com')").run().lastInsertRowid);
  const pianoId=Number(db.prepare("INSERT INTO pianos(client_id,brand,model) VALUES(?, 'Steinway','B')").run(clientId).lastInsertRowid);
  const jobId=Number(db.prepare("INSERT INTO jobs(client_id,piano_id,title,stage,workflow_stage_key,created_by_user_id) VALUES(?,?,'Inventory Job','received','received','U1')").run(clientId,pianoId).lastInsertRowid);
  const handoffId=Number(db.prepare(`INSERT INTO job_handoffs(job_id,from_stage,to_stage,performed_by_user_id,performed_by,assigned_to_user_id,assigned_to)
    VALUES(?,'received','in_progress','U1','Inventory Admin','U1','Inventory Admin')`).run(jobId).lastInsertRowid);
  const notifications=[];
  const service=createInventoryService({
    db,
    notifications:{
      emitOnce(payload){notifications.push(payload);return payload;},
      resolveEntity(){}
    }
  });
  return {db,service,notifications,jobId,handoffId};
}

test("Round J consumes confirmed material usage, records movement, and opens one low-stock purchase request",()=>{
  const {db,service,notifications,jobId,handoffId}=fixture();
  const itemId=Number(db.prepare(`INSERT INTO inventory_items(sku,name_en,name_hu,unit,quantity_on_hand,reorder_point,reorder_quantity,unit_cost,active,created_by_user_id,updated_by_user_id)
    VALUES('FELT-001','Action felt','Mechanika filc','pcs',5,3,10,2.5,1,'U1','U1')`).run().lastInsertRowid);

  const used=db.transaction(()=>service.consumeForHandoff({
    jobId,handoffId,userId:"U1",materials:[{inventory_item_id:itemId,quantity:3}]
  }))();
  assert.equal(used.length,1);
  assert.equal(used[0].quantity,3);
  assert.equal(used[0].unit_cost_snapshot,2.5);
  assert.equal(used[0].total_cost,7.5);
  assert.equal(db.prepare("SELECT quantity_on_hand FROM inventory_items WHERE id=?").get(itemId).quantity_on_hand,2);

  const movement=db.prepare("SELECT * FROM inventory_movements WHERE inventory_item_id=? ORDER BY id DESC LIMIT 1").get(itemId);
  assert.equal(movement.movement_type,"usage");
  assert.equal(movement.quantity_delta,-3);
  assert.equal(movement.balance_after,2);
  assert.equal(movement.job_id,jobId);
  assert.equal(movement.handoff_id,handoffId);

  const first=service.checkLowStockForUsage(used,"U1");
  const second=service.checkLowStockForUsage(used,"U1");
  assert.equal(first.length,1);
  assert.equal(second.length,1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM purchase_requests WHERE inventory_item_id=? AND status IN ('open','approved','ordered')").get(itemId).c,1);
  const request=db.prepare("SELECT * FROM purchase_requests WHERE inventory_item_id=?").get(itemId);
  assert.equal(request.requested_quantity,10);
  assert.ok(notifications.some(n=>n.category==="LOW_STOCK"));
});

test("Round J rejects insufficient stock without partially changing quantity or usage history",()=>{
  const {db,service,jobId,handoffId}=fixture();
  const itemId=Number(db.prepare(`INSERT INTO inventory_items(sku,name_en,name_hu,unit,quantity_on_hand,reorder_point,reorder_quantity,unit_cost,active)
    VALUES('WIRE-001','Bass wire','Basszushúr','pcs',1,1,5,12,1)`).run().lastInsertRowid);

  assert.throws(
    ()=>db.transaction(()=>service.consumeForHandoff({jobId,handoffId,userId:"U1",materials:[{inventory_item_id:itemId,quantity:2}]}))(),
    error=>error?.message==="INSUFFICIENT_INVENTORY"&&Number(error?.status)===409
  );
  assert.equal(db.prepare("SELECT quantity_on_hand FROM inventory_items WHERE id=?").get(itemId).quantity_on_hand,1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM job_material_usage WHERE inventory_item_id=?").get(itemId).c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM inventory_movements WHERE inventory_item_id=?").get(itemId).c,0);
});

test("Round J stores reusable material recipes on handoff presets",()=>{
  const {db,service}=fixture();
  const presetId=Number(db.prepare(`INSERT INTO handoff_presets(title_en,title_hu,default_labor_cost,default_material_cost,default_duration_min,active)
    VALUES('String replacement','Húrcsere',120,35,60,1)`).run().lastInsertRowid);
  const itemId=Number(db.prepare(`INSERT INTO inventory_items(sku,name_en,name_hu,unit,quantity_on_hand,reorder_point,reorder_quantity,unit_cost,active)
    VALUES('STRING-001','Piano string','Zongorahúr','pcs',20,5,10,7,1)`).run().lastInsertRowid);
  service.setPresetMaterials(presetId,[{inventory_item_id:itemId,default_quantity:2}]);
  const preset=service.decoratePreset(db.prepare("SELECT * FROM handoff_presets WHERE id=?").get(presetId));
  assert.equal(preset.materials.length,1);
  assert.equal(preset.materials[0].inventory_item_id,itemId);
  assert.equal(preset.materials[0].default_quantity,2);
  assert.equal(preset.materials[0].quantity_on_hand,20);
});
