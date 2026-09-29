"use strict";

function text(value,max=2000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function integerId(value){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null;}
function number(value){const n=Number(value);return Number.isFinite(n)?Math.round((n+Number.EPSILON)*1000)/1000:NaN;}
function money(value){const n=Number(value);return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:NaN;}
function problem(code,status=400,extra=null){const error=new Error(code);error.status=status;error.extra=extra;return error;}
function respond(res,error){res.status(Number(error?.status||400)).json({error:error?.message||"INVENTORY_REQUEST_FAILED",...(error?.extra||{})});}

function createInventoryService({db,notifications=null}={}){
  function adminRecipients(){
    return db.prepare("SELECT id FROM users WHERE status='Active' AND (role='ADMIN' OR role='SUPERADMIN' OR is_superadmin=1)").all().map(row=>row.id);
  }
  function itemById(id){return id&&db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id);}
  function presetMaterials(presetId){
    return db.prepare(`SELECT pm.preset_id,pm.inventory_item_id,pm.default_quantity,pm.sort_order,
      i.sku,i.name_en,i.name_hu,i.unit,i.quantity_on_hand,i.reorder_point,i.reorder_quantity,i.unit_cost,i.active
      FROM handoff_preset_materials pm JOIN inventory_items i ON i.id=pm.inventory_item_id
      WHERE pm.preset_id=? ORDER BY pm.sort_order,i.id`).all(presetId);
  }
  function decoratePreset(row){return row?{...row,materials:presetMaterials(row.id)}:null;}
  function normalizePresetMaterials(materials){
    const seen=new Set();
    return (Array.isArray(materials)?materials:[]).map((entry,index)=>{
      const itemId=integerId(entry?.inventory_item_id),quantity=number(entry?.default_quantity??entry?.quantity);
      if(!itemId||!(quantity>0))throw problem("INVALID_PRESET_MATERIAL");
      if(seen.has(itemId))throw problem("DUPLICATE_PRESET_MATERIAL");
      seen.add(itemId);
      const item=itemById(itemId);if(!item||!Number(item.active))throw problem("INVALID_INVENTORY_ITEM");
      return {inventory_item_id:itemId,default_quantity:quantity,sort_order:index};
    });
  }
  function setPresetMaterials(presetId,materials){
    const normalized=normalizePresetMaterials(materials);
    db.prepare("DELETE FROM handoff_preset_materials WHERE preset_id=?").run(presetId);
    const insert=db.prepare("INSERT INTO handoff_preset_materials(preset_id,inventory_item_id,default_quantity,sort_order) VALUES(?,?,?,?)");
    normalized.forEach(row=>insert.run(presetId,row.inventory_item_id,row.default_quantity,row.sort_order));
    return presetMaterials(presetId);
  }
  function normalizeUsage(materials){
    const seen=new Set();
    return (Array.isArray(materials)?materials:[]).filter(entry=>Number(entry?.quantity)>0).map(entry=>{
      const itemId=integerId(entry?.inventory_item_id),quantity=number(entry?.quantity);
      if(!itemId||!(quantity>0))throw problem("INVALID_MATERIAL_USAGE");
      if(seen.has(itemId))throw problem("DUPLICATE_MATERIAL_USAGE");
      seen.add(itemId);
      const item=itemById(itemId);if(!item||!Number(item.active))throw problem("INVALID_INVENTORY_ITEM");
      if(Number(item.quantity_on_hand)+1e-9<quantity)throw problem("INSUFFICIENT_INVENTORY",409,{
        inventory_item_id:item.id,sku:item.sku,name_en:item.name_en,name_hu:item.name_hu,
        requested_quantity:quantity,quantity_on_hand:Number(item.quantity_on_hand||0)
      });
      return {item,quantity};
    });
  }
  function notifyLowStock(item,request){
    if(!notifications)return null;
    const recipients=adminRecipients();if(!recipients.length)return null;
    return notifications.emitOnce({
      category:"LOW_STOCK",entityType:"INVENTORY_ITEM",entityId:String(item.id),
      titleEn:"Inventory needs replenishment",titleHu:"Készletfeltöltés szükséges",
      bodyEn:`${item.sku} · ${item.name_en} · ${item.quantity_on_hand} ${item.unit} remaining · purchase request #${request.id}`,
      bodyHu:`${item.sku} · ${item.name_hu} · ${item.quantity_on_hand} ${item.unit} maradt · beszerzési igény #${request.id}`,
      actionUrl:"#intake",severity:Number(item.quantity_on_hand)<=0?"URGENT":"WARNING",recipients
    });
  }
  function ensurePurchaseRequest(itemId,actorUserId=null){
    const item=itemById(itemId);if(!item)return null;
    if(Number(item.quantity_on_hand)>Number(item.reorder_point)) {
      notifications?.resolveEntity?.("INVENTORY_ITEM",String(item.id));
      return null;
    }
    let request=db.prepare("SELECT * FROM purchase_requests WHERE inventory_item_id=? AND status IN ('open','approved','ordered') ORDER BY id DESC LIMIT 1").get(item.id);
    if(!request){
      const quantity=Math.max(Number(item.reorder_quantity||1),0.001);
      const info=db.prepare(`INSERT INTO purchase_requests(inventory_item_id,status,requested_quantity,reason,created_by_user_id,updated_by_user_id)
        VALUES(?,'open',?,'Automatic low-stock request',?,?)`).run(item.id,quantity,actorUserId||null,actorUserId||null);
      request=db.prepare("SELECT * FROM purchase_requests WHERE id=?").get(Number(info.lastInsertRowid));
    }
    notifyLowStock(item,request);
    return request;
  }
  function consumeForHandoff({jobId,handoffId,userId,materials}={}){
    const usage=normalizeUsage(materials);
    if(!usage.length)return [];
    const rows=[];
    const insertUsage=db.prepare(`INSERT INTO job_material_usage(job_id,handoff_id,inventory_item_id,quantity,unit_cost_snapshot,total_cost,used_by_user_id)
      VALUES(?,?,?,?,?,?,?)`);
    const insertMovement=db.prepare(`INSERT INTO inventory_movements(inventory_item_id,movement_type,quantity_delta,balance_after,job_id,handoff_id,reference,note,created_by_user_id)
      VALUES(?,'usage',?,?,?,?,?,?,?)`);
    for(const entry of usage){
      const current=itemById(entry.item.id);
      if(Number(current.quantity_on_hand)+1e-9<entry.quantity)throw problem("INSUFFICIENT_INVENTORY",409,{
        inventory_item_id:current.id,sku:current.sku,name_en:current.name_en,name_hu:current.name_hu,
        requested_quantity:entry.quantity,quantity_on_hand:Number(current.quantity_on_hand||0)
      });
      const balance=number(Number(current.quantity_on_hand)-entry.quantity),unitCost=money(current.unit_cost||0),totalCost=money(unitCost*entry.quantity);
      db.prepare("UPDATE inventory_items SET quantity_on_hand=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(balance,userId||null,current.id);
      const info=insertUsage.run(jobId,handoffId,current.id,entry.quantity,unitCost,totalCost,userId||null);
      insertMovement.run(current.id,-entry.quantity,balance,jobId,handoffId,`handoff:${handoffId}`,"Workshop material usage",userId||null);
      rows.push(db.prepare(`SELECT u.*,i.sku,i.name_en,i.name_hu,i.unit FROM job_material_usage u
        JOIN inventory_items i ON i.id=u.inventory_item_id WHERE u.id=?`).get(Number(info.lastInsertRowid)));
    }
    return rows;
  }
  function checkLowStockForUsage(rows,actorUserId=null){
    const itemIds=[...new Set((rows||[]).map(row=>Number(row.inventory_item_id)).filter(Boolean))];
    return itemIds.map(id=>ensurePurchaseRequest(id,actorUserId)).filter(Boolean);
  }
  function emitInventoryException(error,jobId=null){
    if(!notifications||!["INSUFFICIENT_INVENTORY","INVALID_INVENTORY_ITEM"].includes(error?.message))return null;
    const recipients=adminRecipients();if(!recipients.length)return null;
    const item=error?.extra?.inventory_item_id?itemById(error.extra.inventory_item_id):null;
    return notifications.emitOnce({
      category:"INVENTORY_EXCEPTION",entityType:item?"INVENTORY_ITEM":"JOB",entityId:String(item?.id||jobId||"inventory"),
      titleEn:"Workshop inventory requires attention",titleHu:"A műhelykészlet beavatkozást igényel",
      bodyEn:item?`${item.sku} · ${item.name_en} · requested ${error.extra.requested_quantity}, available ${error.extra.quantity_on_hand}`:text(error.message,240),
      bodyHu:item?`${item.sku} · ${item.name_hu} · igény: ${error.extra.requested_quantity}, elérhető: ${error.extra.quantity_on_hand}`:text(error.message,240),
      actionUrl:"#intake",severity:"URGENT",recipients
    });
  }
  return {itemById,presetMaterials,decoratePreset,setPresetMaterials,normalizeUsage,consumeForHandoff,checkLowStockForUsage,ensurePurchaseRequest,emitInventoryException,adminRecipients};
}

function registerInventoryRoutes({app,db,auth,permit,audit,inventoryService}={}){
  const service=inventoryService||createInventoryService({db}),admin=permit("ADMIN");
  app.get("/api/inventory",auth,admin,(req,res)=>{
    const includeInactive=req.query.include_inactive==="1";
    const rows=db.prepare(`SELECT i.*,
      (SELECT COUNT(*) FROM purchase_requests p WHERE p.inventory_item_id=i.id AND p.status='open') AS open_purchase_request_count
      FROM inventory_items i ${includeInactive?"":"WHERE i.active=1"} ORDER BY lower(i.name_en),i.id`).all();
    res.json(rows);
  });
  app.get("/api/inventory/:id/movements",auth,admin,(req,res)=>{
    const id=integerId(req.params.id);if(!id||!service.itemById(id))return res.status(404).json({error:"INVENTORY_ITEM_NOT_FOUND"});
    res.json(db.prepare("SELECT * FROM inventory_movements WHERE inventory_item_id=? ORDER BY created_at DESC,id DESC LIMIT 250").all(id));
  });
  app.post("/api/inventory",auth,admin,(req,res)=>{
    try{
      const sku=text(req.body?.sku,120).toUpperCase(),nameEn=text(req.body?.name_en,240),nameHu=text(req.body?.name_hu,240),unit=text(req.body?.unit||"pcs",40);
      const quantity=number(req.body?.quantity_on_hand||0),reorderPoint=number(req.body?.reorder_point||0),reorderQuantity=number(req.body?.reorder_quantity||1),unitCost=money(req.body?.unit_cost||0);
      if(!sku||!nameEn||!nameHu)throw problem("INVENTORY_ITEM_FIELDS_REQUIRED");
      if(!(quantity>=0)||!(reorderPoint>=0)||!(reorderQuantity>0)||!(unitCost>=0))throw problem("INVALID_INVENTORY_VALUES");
      const info=db.prepare(`INSERT INTO inventory_items(sku,name_en,name_hu,unit,quantity_on_hand,reorder_point,reorder_quantity,unit_cost,active,created_by_user_id,updated_by_user_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(sku,nameEn,nameHu,unit,quantity,reorderPoint,reorderQuantity,unitCost,req.body?.active===false?0:1,req.user.id,req.user.id);
      const row=service.itemById(Number(info.lastInsertRowid));
      if(quantity!==0)db.prepare(`INSERT INTO inventory_movements(inventory_item_id,movement_type,quantity_delta,balance_after,reference,note,created_by_user_id)
        VALUES(?,'adjustment',?,?,?,'Initial inventory balance',?)`).run(row.id,quantity,quantity,"initial",req.user.id);
      service.ensurePurchaseRequest(row.id,req.user.id);
      audit(req,"CREATE","inventory_items",String(row.id),null,row);res.status(201).json(row);
    }catch(error){if(String(error?.message).includes("UNIQUE"))error=problem("INVENTORY_SKU_EXISTS",409);respond(res,error);}
  });
  app.put("/api/inventory/:id",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),before=id&&service.itemById(id);if(!before)return res.status(404).json({error:"INVENTORY_ITEM_NOT_FOUND"});
    try{
      const sku=text(req.body?.sku??before.sku,120).toUpperCase(),nameEn=text(req.body?.name_en??before.name_en,240),nameHu=text(req.body?.name_hu??before.name_hu,240),unit=text(req.body?.unit??before.unit,40);
      const reorderPoint=number(req.body?.reorder_point??before.reorder_point),reorderQuantity=number(req.body?.reorder_quantity??before.reorder_quantity),unitCost=money(req.body?.unit_cost??before.unit_cost);
      if(!sku||!nameEn||!nameHu)throw problem("INVENTORY_ITEM_FIELDS_REQUIRED");
      if(!(reorderPoint>=0)||!(reorderQuantity>0)||!(unitCost>=0))throw problem("INVALID_INVENTORY_VALUES");
      db.prepare(`UPDATE inventory_items SET sku=?,name_en=?,name_hu=?,unit=?,reorder_point=?,reorder_quantity=?,unit_cost=?,active=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(sku,nameEn,nameHu,unit,reorderPoint,reorderQuantity,unitCost,req.body?.active===undefined?Number(before.active):req.body.active?1:0,req.user.id,id);
      const after=service.itemById(id);service.ensurePurchaseRequest(id,req.user.id);audit(req,"UPDATE","inventory_items",String(id),before,after);res.json(after);
    }catch(error){if(String(error?.message).includes("UNIQUE"))error=problem("INVENTORY_SKU_EXISTS",409);respond(res,error);}
  });
  app.post("/api/inventory/:id/adjust",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),before=id&&service.itemById(id);if(!before)return res.status(404).json({error:"INVENTORY_ITEM_NOT_FOUND"});
    try{
      const delta=number(req.body?.quantity_delta),type=["restock","adjustment"].includes(String(req.body?.movement_type))?String(req.body.movement_type):"adjustment";
      if(!Number.isFinite(delta)||delta===0)throw problem("INVALID_INVENTORY_ADJUSTMENT");
      const balance=number(Number(before.quantity_on_hand)+delta);if(balance<0)throw problem("INVENTORY_BALANCE_NEGATIVE",409);
      db.transaction(()=>{
        db.prepare("UPDATE inventory_items SET quantity_on_hand=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(balance,req.user.id,id);
        db.prepare(`INSERT INTO inventory_movements(inventory_item_id,movement_type,quantity_delta,balance_after,reference,note,created_by_user_id)
          VALUES(?,?,?,?,?,?,?)`).run(id,type,delta,balance,text(req.body?.reference,240)||null,text(req.body?.note,2000)||null,req.user.id);
      })();
      const after=service.itemById(id);service.ensurePurchaseRequest(id,req.user.id);audit(req,"ADJUST","inventory_items",String(id),before,after);res.json(after);
    }catch(error){respond(res,error);}
  });
  app.get("/api/purchase-requests",auth,admin,(req,res)=>{
    const status=text(req.query.status,40);
    const rows=db.prepare(`SELECT p.*,i.sku,i.name_en,i.name_hu,i.unit,i.quantity_on_hand,i.reorder_point
      FROM purchase_requests p JOIN inventory_items i ON i.id=p.inventory_item_id
      WHERE (?='' OR p.status=?) ORDER BY CASE p.status WHEN 'open' THEN 0 WHEN 'approved' THEN 1 WHEN 'ordered' THEN 2 ELSE 3 END,p.created_at DESC,p.id DESC`).all(status,status);
    res.json(rows);
  });
  app.post("/api/purchase-requests/:id/status",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),before=id&&db.prepare("SELECT * FROM purchase_requests WHERE id=?").get(id);if(!before)return res.status(404).json({error:"PURCHASE_REQUEST_NOT_FOUND"});
    try{
      const status=text(req.body?.status,40);if(!["approved","ordered","received","cancelled"].includes(status))throw problem("INVALID_PURCHASE_REQUEST_STATUS");
      if(before.status==="received"||before.status==="cancelled")throw problem("PURCHASE_REQUEST_CLOSED",409);
      let receivedQuantity=null;
      db.transaction(()=>{
        if(status==="received"){
          receivedQuantity=number(req.body?.received_quantity??before.requested_quantity);if(!(receivedQuantity>0))throw problem("INVALID_RECEIVED_QUANTITY");
          const item=service.itemById(before.inventory_item_id),balance=number(Number(item.quantity_on_hand)+receivedQuantity);
          db.prepare("UPDATE inventory_items SET quantity_on_hand=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(balance,req.user.id,item.id);
          db.prepare(`INSERT INTO inventory_movements(inventory_item_id,movement_type,quantity_delta,balance_after,reference,note,created_by_user_id)
            VALUES(?,'restock',?,?,?,?,?)`).run(item.id,receivedQuantity,balance,`purchase-request:${id}`,text(req.body?.note,2000)||"Purchase request received",req.user.id);
        }
        db.prepare("UPDATE purchase_requests SET status=?,received_quantity=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(status,receivedQuantity,req.user.id,id);
      })();
      const after=db.prepare("SELECT * FROM purchase_requests WHERE id=?").get(id),item=service.itemById(after.inventory_item_id);
      if(status==="received"||status==="cancelled")service.ensurePurchaseRequest(item.id,req.user.id);
      audit(req,"STATUS","purchase_requests",String(id),before,after);res.json({request:after,item});
    }catch(error){respond(res,error);}
  });
  return service;
}

module.exports={createInventoryService,registerInventoryRoutes};
