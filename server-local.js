const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DB_FILE = path.join(DATA_DIR, "store.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ACTIVITIES = [
  ["01","Material Unloading","Punch mark/photo; punch-off/transfer; thickness; Heat No."],
  ["02","Cutting","Right angle; drawing layout; material identification; number stencilling."],
  ["03","Scrap Segregation / Disposal","Scrap identification, segregation and disposal."],
  ["04","Dish-End / Outside Process","Outgoing/return challan Job No.; quantity/details; material ID; cutting/grinding; welding; component ID."],
  ["05","Weld Cap / Outside Process","Outgoing/return Job No.; quantity; identification."],
  ["06","Rolling","Front pressing/8–7 line; gauge rolling; LZ setup gap; diameter; rolling condition."],
  ["07","Fit-up — QC Witness","Thickness; setup gap; layout; punch transfer; joint prep; alignment/Hi-Low; tack weld; joint ID. Inform QC before first welding run."],
  ["08","Welding","WPS; qualified welder; preheat; holding oven; consumable; coupon/runner plate; rod batch; TC/traceability; preheat/interpass/parameters/ID."],
  ["09","Back-chipping & Dye Penetrant — HOLD","100% joint; back-chip; root clean; visual; DPT; QC witness. Do not proceed until released."],
  ["10","Nozzle Opening","V-edge; location; orientation; photo; upload/share; QC review; photo No."],
  ["11","Reinforcement Pads","Location; size; pin hole; 100% weld; visual; QC."],
  ["12","Radiography / Repair","Required RT; RT result; repair location; repair; reshoot; final accepted."],
  ["13","Cutting Edge / Grinding / Hard Punch","Finish; grind; no sharp edges; hard punch fully welded; visual."],
  ["14","Internal / External Visual — QC Witness","External surface; dents; weld; grinding; internal cleaning; internal visual after second dish-end; no debris."],
  ["15","PWHT — Where Applicable","Arrangement; ID; calibration; temperature; holding time; photo; chart; calibration certificate."],
  ["16","Mounting","Foot plate weld/clean; nuts/bolts before welding; gusset; burr/spatter/flux; rubbing plate bolts; straightness."],
  ["17","Hydrotest — QC/TPIA","Weld/NDT/PWHT/visual complete; tank ready; gauge calibration; pressure/duration; no leakage/defect; photo; clearance."],
  ["18","Sandblasting","No unblasted area; mill scale/scrap not visible; surface preparation accepted."],
  ["19","Painting / Colour","Surface prep; QC before primer; defects/rectification/approval; colour; batch; mixing with QC; application."],
  ["20","Accessories","Catwalk/other pads welded; welds checked; fabrication; primer/colour complete; QC confirmation before mounting."]
].map(([no,name,detail]) => ({
  no, name, detail,
  control: /HOLD|Witness|Hydrotest/.test(name)
}));

function loadStore() {
  try {
    if (!fs.existsSync(DB_FILE)) return { jobs: [], nextId: 1 };
    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return data && Array.isArray(data.jobs) ? data : { jobs: [], nextId: 1 };
  } catch {
    return { jobs: [], nextId: 1 };
  }
}
function saveStore(store) {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE);
}
function now() { return new Date().toISOString(); }
function safeName(name) {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0,120);
}
function publicJob(job) {
  const copy = JSON.parse(JSON.stringify(job));
  copy.attachments = (copy.attachments || []).map(a => ({...a, url: `/uploads/${encodeURIComponent(a.savedName)}`}));
  return copy;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, Date.now() + "-" + crypto.randomBytes(6).toString("hex") + "-" + safeName(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image\/|application\/pdf$|text\/plain$)/i.test(file.mimetype);
    cb(allowed ? null : new Error("Only images, PDF and text evidence files are allowed."));
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT, "public")));

app.get("/api/health", (_req,res) => res.json({ ok:true, service:"Relax QC Control Center", node:process.version }));

app.get("/api/activities", (_req,res) => res.json(ACTIVITIES));

app.get("/api/jobs", (_req,res) => {
  const store = loadStore();
  const list = store.jobs.map(j => {
    const completed = Object.values(j.checks || {}).filter(c => ["RELEASED","PASS"].includes(c.status)).length;
    const blocked = Object.values(j.checks || {}).filter(c => ["HOLD","REWORK","FAIL"].includes(c.status)).length;
    return { id:j.id, jobNo:j.jobNo, contractor:j.contractor, date:j.date, completed, blocked, updatedAt:j.updatedAt };
  }).sort((a,b) => b.id-a.id);
  res.json(list);
});

app.get("/api/jobs/:id", (req,res) => {
  const store=loadStore();
  const job=store.jobs.find(j=>j.id===Number(req.params.id));
  if(!job) return res.status(404).json({error:"Job not found"});
  res.json(publicJob(job));
});

app.post("/api/jobs", (req,res) => {
  const store=loadStore();
  const b=req.body || {};
  if(!String(b.jobNo||"").trim()) return res.status(400).json({error:"Job / Tank No. is required."});
  const job = {
    id: store.nextId++,
    contractor:String(b.contractor||""),
    jobNo:String(b.jobNo||"").trim(),
    activity:String(b.activity||""),
    date:String(b.date||""),
    supervisor:String(b.supervisor||""),
    qcEngineer:String(b.qcEngineer||""),
    notes:String(b.notes||""),
    checks:{},
    attachments:[],
    contractorConfirmed:false,
    qcConfirmed:false,
    createdAt:now(),
    updatedAt:now()
  };
  store.jobs.push(job); saveStore(store);
  res.status(201).json(publicJob(job));
});

app.put("/api/jobs/:id", (req,res) => {
  const store=loadStore();
  const job=store.jobs.find(j=>j.id===Number(req.params.id));
  if(!job) return res.status(404).json({error:"Job not found"});
  const b=req.body || {};
  for (const k of ["contractor","jobNo","activity","date","supervisor","qcEngineer","notes"]) {
    if (b[k] !== undefined) job[k]=String(b[k]||"");
  }
  if (b.contractorConfirmed !== undefined) job.contractorConfirmed=!!b.contractorConfirmed;
  if (b.qcConfirmed !== undefined) job.qcConfirmed=!!b.qcConfirmed;
  job.updatedAt=now();
  saveStore(store); res.json(publicJob(job));
});

app.delete("/api/jobs/:id", (req,res) => {
  const store=loadStore();
  const idx=store.jobs.findIndex(j=>j.id===Number(req.params.id));
  if(idx<0) return res.status(404).json({error:"Job not found"});
  const job=store.jobs[idx];
  for(const a of (job.attachments||[])) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR,a.savedName)); } catch {}
  }
  store.jobs.splice(idx,1); saveStore(store); res.json({ok:true});
});

app.put("/api/jobs/:id/checks/:stageNo", (req,res) => {
  const store=loadStore();
  const job=store.jobs.find(j=>j.id===Number(req.params.id));
  if(!job) return res.status(404).json({error:"Job not found"});
  const allowed=["PENDING","IN PROGRESS","RELEASED","REWORK","HOLD","PASS","FAIL"];
  const status=String(req.body?.status||"PENDING");
  if(!allowed.includes(status)) return res.status(400).json({error:"Invalid status"});
  const no=String(req.params.stageNo).padStart(2,"0");
  if(!ACTIVITIES.some(a=>a.no===no)) return res.status(400).json({error:"Invalid stage"});
  job.checks[no]={status, notes:String(req.body?.notes||""), updatedAt:now()};
  job.updatedAt=now(); saveStore(store); res.json(publicJob(job));
});

app.post("/api/jobs/:id/attachments", upload.array("files",10), (req,res) => {
  const store=loadStore();
  const job=store.jobs.find(j=>j.id===Number(req.params.id));
  if(!job) return res.status(404).json({error:"Job not found"});
  const stageNo=String(req.body?.stageNo||"").padStart(2,"0");
  if(!ACTIVITIES.some(a=>a.no===stageNo)) return res.status(400).json({error:"Invalid stage"});
  for(const f of (req.files||[])) {
    job.attachments.push({id:crypto.randomUUID(),stageNo,originalName:f.originalname,savedName:f.filename,size:f.size,mime:f.mimetype,createdAt:now()});
  }
  job.updatedAt=now(); saveStore(store);
  res.status(201).json(publicJob(job));
});

app.delete("/api/jobs/:id/attachments/:attachmentId", (req,res) => {
  const store=loadStore();
  const job=store.jobs.find(j=>j.id===Number(req.params.id));
  if(!job) return res.status(404).json({error:"Job not found"});
  const idx=job.attachments.findIndex(a=>a.id===req.params.attachmentId);
  if(idx<0) return res.status(404).json({error:"Attachment not found"});
  const a=job.attachments[idx];
  try { fs.unlinkSync(path.join(UPLOAD_DIR,a.savedName)); } catch {}
  job.attachments.splice(idx,1); job.updatedAt=now(); saveStore(store); res.json(publicJob(job));
});

app.get("/api/jobs/:id/export", (req,res) => {
  const store=loadStore();
  const job=store.jobs.find(j=>j.id===Number(req.params.id));
  if(!job) return res.status(404).json({error:"Job not found"});
  res.setHeader("Content-Disposition", `attachment; filename="${safeName(job.jobNo||"qc-job")}.json"`);
  res.json(publicJob(job));
});

app.use((err,_req,res,_next) => {
  console.error(err);
  res.status(400).json({error:err.message || "Request failed"});
});

app.get("*", (_req,res) => res.sendFile(path.join(ROOT,"public","index.html")));

app.listen(PORT, () => {
  console.log(`\nRELAX QC CONTROL CENTER`);
  console.log(`Running at http://localhost:${PORT}`);
  console.log(`Node ${process.version}`);
  console.log(`Data file: ${DB_FILE}`);
  console.log(`Press Ctrl+C to stop.\n`);
});
