const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(ROOT, 'storage');
const UPLOAD_DIR = path.join(STORAGE_ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required for the cloud version.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10
});

const ACTIVITIES = [
  ['01','Material Unloading','Punch mark/photo; punch-off/transfer; thickness; Heat No.'],
  ['02','Cutting','Right angle; drawing layout; material identification; number stencilling.'],
  ['03','Scrap Segregation / Disposal','Scrap identification, segregation and disposal.'],
  ['04','Dish-End / Outside Process','Outgoing/return challan Job No.; quantity/details; material ID; cutting/grinding; welding; component ID.'],
  ['05','Weld Cap / Outside Process','Outgoing/return Job No.; quantity; identification.'],
  ['06','Rolling','Front pressing/8–7 line; gauge rolling; LZ setup gap; diameter; rolling condition.'],
  ['07','Fit-up — QC Witness','Thickness; setup gap; layout; punch transfer; joint prep; alignment/Hi-Low; tack weld; joint ID. Inform QC before first welding run.'],
  ['08','Welding','WPS; qualified welder; preheat; holding oven; consumable; coupon/runner plate; rod batch; TC/traceability; preheat/interpass/parameters/ID.'],
  ['09','Back-chipping & Dye Penetrant — HOLD','100% joint; back-chip; root clean; visual; DPT; QC witness. Do not proceed until released.'],
  ['10','Nozzle Opening','V-edge; location; orientation; photo; upload/share; QC review; photo No.'],
  ['11','Reinforcement Pads','Location; size; pin hole; 100% weld; visual; QC.'],
  ['12','Radiography / Repair','Required RT; RT result; repair location; repair; reshoot; final accepted.'],
  ['13','Cutting Edge / Grinding / Hard Punch','Finish; grind; no sharp edges; hard punch fully welded; visual.'],
  ['14','Internal / External Visual — QC Witness','External surface; dents; weld; grinding; internal cleaning; internal visual after second dish-end; no debris.'],
  ['15','PWHT — Where Applicable','Arrangement; ID; calibration; temperature; holding time; photo; chart; calibration certificate.'],
  ['16','Mounting','Foot plate weld/clean; nuts/bolts before welding; gusset; burr/spatter/flux; rubbing plate bolts; straightness.'],
  ['17','Hydrotest — QC/TPIA','Weld/NDT/PWHT/visual complete; tank ready; gauge calibration; pressure/duration; no leakage/defect; photo; clearance.'],
  ['18','Sandblasting','No unblasted area; mill scale/scrap not visible; surface preparation accepted.'],
  ['19','Painting / Colour','Surface prep; QC before primer; defects/rectification/approval; colour; batch; mixing with QC; application.'],
  ['20','Accessories','Catwalk/other pads welded; welds checked; fabrication; primer/colour complete; QC confirmation before mounting.']
].map(([no,name,detail])=>({no,name,detail,control:/HOLD|Witness|Hydrotest/.test(name)}));

const allowedStatuses = ['PENDING','IN PROGRESS','RELEASED','REWORK','HOLD','PASS','FAIL'];

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS jobs (
    id BIGSERIAL PRIMARY KEY,
    contractor TEXT NOT NULL DEFAULT '',
    job_no TEXT NOT NULL,
    activity TEXT NOT NULL DEFAULT '',
    job_date TEXT NOT NULL DEFAULT '',
    supervisor TEXT NOT NULL DEFAULT '',
    qc_engineer TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    checks JSONB NOT NULL DEFAULT '{}'::jsonb,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    contractor_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    qc_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  await pool.query(`CREATE INDEX IF NOT EXISTS jobs_job_no_idx ON jobs(job_no);`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('ADMIN_PASSWORD is required.');
  const existing = await pool.query('SELECT username FROM app_users WHERE username=$1', [username]);
  if (!existing.rowCount) {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    await pool.query('INSERT INTO app_users(username,password_hash) VALUES($1,$2)', [username, hash]);
  }
}

app.set('trust proxy', 1);
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));
app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'CHANGE_ME',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly:true, secure: process.env.NODE_ENV === 'production', sameSite:'lax', maxAge: 8*60*60*1000 }
}));

function requireAuth(req,res,next){
  if(req.session.user) return next();
  return res.status(401).json({error:'Login required'});
}
function publicJob(row){
  const j={id:Number(row.id),contractor:row.contractor,jobNo:row.job_no,activity:row.activity,date:row.job_date,supervisor:row.supervisor,qcEngineer:row.qc_engineer,notes:row.notes,checks:row.checks||{},attachments:row.attachments||[],contractorConfirmed:row.contractor_confirmed,qcConfirmed:row.qc_confirmed,createdAt:row.created_at,updatedAt:row.updated_at};
  j.attachments=j.attachments.map(a=>({...a,url:`/uploads/${encodeURIComponent(a.savedName)}`}));
  return j;
}
function safeName(name){return String(name||'file').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)}

const storage=multer.diskStorage({destination:(_r,_f,cb)=>cb(null,UPLOAD_DIR),filename:(_r,file,cb)=>cb(null,Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'-'+safeName(file.originalname))});
const upload=multer({storage,limits:{fileSize:15*1024*1024,files:10},fileFilter:(_r,file,cb)=>cb(/^(image\/|application\/pdf$|text\/plain$)/i.test(file.mimetype)?null:new Error('Only images, PDF and text evidence files are allowed.'))});

app.get('/api/health', async (_req,res)=>res.json({ok:true,service:'Relax QC Control Center Cloud',database:'postgresql'}));
app.get('/api/me',(req,res)=>req.session.user?res.json({authenticated:true,username:req.session.user.username}):res.status(401).json({authenticated:false}));
app.post('/api/login', async (req,res)=>{
  const username=String(req.body?.username||''); const password=String(req.body?.password||'');
  const hash=crypto.createHash('sha256').update(password).digest('hex');
  const r=await pool.query('SELECT username FROM app_users WHERE username=$1 AND password_hash=$2',[username,hash]);
  if(!r.rowCount) return res.status(401).json({error:'Invalid username or password'});
  req.session.user={username}; res.json({ok:true,username});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/activities',(req,res)=>res.json(ACTIVITIES));

app.use('/api/jobs',requireAuth);
app.get('/api/jobs',async (_req,res)=>{
  const r=await pool.query('SELECT * FROM jobs ORDER BY id DESC');
  res.json(r.rows.map(j=>{const checks=j.checks||{};return {id:Number(j.id),jobNo:j.job_no,contractor:j.contractor,date:j.job_date,completed:Object.values(checks).filter(c=>['RELEASED','PASS'].includes(c.status)).length,blocked:Object.values(checks).filter(c=>['HOLD','REWORK','FAIL'].includes(c.status)).length,updatedAt:j.updated_at}}));
});
app.get('/api/jobs/:id',async(req,res)=>{const r=await pool.query('SELECT * FROM jobs WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Job not found'});res.json(publicJob(r.rows[0]))});
app.post('/api/jobs',async(req,res)=>{const b=req.body||{};if(!String(b.jobNo||'').trim())return res.status(400).json({error:'Job / Tank No. is required.'});const r=await pool.query(`INSERT INTO jobs(contractor,job_no,activity,job_date,supervisor,qc_engineer,notes,contractor_confirmed,qc_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[String(b.contractor||''),String(b.jobNo).trim(),String(b.activity||''),String(b.date||''),String(b.supervisor||''),String(b.qcEngineer||''),String(b.notes||''),!!b.contractorConfirmed,!!b.qcConfirmed]);res.status(201).json(publicJob(r.rows[0]))});
app.put('/api/jobs/:id',async(req,res)=>{const b=req.body||{};const r=await pool.query(`UPDATE jobs SET contractor=COALESCE($1,contractor),job_no=COALESCE($2,job_no),activity=COALESCE($3,activity),job_date=COALESCE($4,job_date),supervisor=COALESCE($5,supervisor),qc_engineer=COALESCE($6,qc_engineer),notes=COALESCE($7,notes),contractor_confirmed=COALESCE($8,contractor_confirmed),qc_confirmed=COALESCE($9,qc_confirmed),updated_at=NOW() WHERE id=$10 RETURNING *`,[b.contractor,b.jobNo,b.activity,b.date,b.supervisor,b.qcEngineer,b.notes,b.contractorConfirmed,b.qcConfirmed,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Job not found'});res.json(publicJob(r.rows[0]))});
app.delete('/api/jobs/:id',async(req,res)=>{const r=await pool.query('SELECT attachments FROM jobs WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Job not found'});for(const a of (r.rows[0].attachments||[])){try{fs.unlinkSync(path.join(UPLOAD_DIR,a.savedName))}catch{}}await pool.query('DELETE FROM jobs WHERE id=$1',[req.params.id]);res.json({ok:true})});
app.put('/api/jobs/:id/checks/:stageNo',async(req,res)=>{const no=String(req.params.stageNo).padStart(2,'0');const status=String(req.body?.status||'PENDING');if(!allowedStatuses.includes(status))return res.status(400).json({error:'Invalid status'});if(!ACTIVITIES.some(a=>a.no===no))return res.status(400).json({error:'Invalid stage'});const r=await pool.query('SELECT checks FROM jobs WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Job not found'});const checks=r.rows[0].checks||{};checks[no]={status,notes:String(req.body?.notes||''),updatedAt:new Date().toISOString()};const u=await pool.query('UPDATE jobs SET checks=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[checks,req.params.id]);res.json(publicJob(u.rows[0]))});
app.post('/api/jobs/:id/attachments',upload.array('files',10),async(req,res)=>{const r=await pool.query('SELECT attachments FROM jobs WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Job not found'});const stageNo=String(req.body?.stageNo||'').padStart(2,'0');if(!ACTIVITIES.some(a=>a.no===stageNo))return res.status(400).json({error:'Invalid stage'});const arr=r.rows[0].attachments||[];for(const f of(req.files||[]))arr.push({id:crypto.randomUUID(),stageNo,originalName:f.originalname,savedName:f.filename,size:f.size,mime:f.mimetype,createdAt:new Date().toISOString()});const u=await pool.query('UPDATE jobs SET attachments=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[arr,req.params.id]);res.status(201).json(publicJob(u.rows[0]))});
app.delete('/api/jobs/:id/attachments/:attachmentId',async(req,res)=>{const r=await pool.query('SELECT attachments FROM jobs WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Job not found'});const arr=r.rows[0].attachments||[];const idx=arr.findIndex(a=>a.id===req.params.attachmentId);if(idx<0)return res.status(404).json({error:'Attachment not found'});const a=arr[idx];try{fs.unlinkSync(path.join(UPLOAD_DIR,a.savedName))}catch{}arr.splice(idx,1);const u=await pool.query('UPDATE jobs SET attachments=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[arr,req.params.id]);res.json(publicJob(u.rows[0]))});
app.get('/api/jobs/:id/export',async(req,res)=>{const r=await pool.query('SELECT * FROM jobs WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Job not found'});const j=publicJob(r.rows[0]);res.setHeader('Content-Disposition',`attachment; filename="${safeName(j.jobNo||'qc-job')}.json"`);res.json(j)});

app.use('/uploads',requireAuth,(req,res,next)=>next());
app.use('/uploads',express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
app.use((err,_req,res,_next)=>{console.error(err);res.status(400).json({error:err.message||'Request failed'})});

initDb().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Relax QC Cloud listening on 0.0.0.0:${PORT}`))).catch(err=>{console.error(err);process.exit(1)});
