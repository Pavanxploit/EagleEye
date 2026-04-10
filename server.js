require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const path     = require('path');
const app      = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── Database connection ──────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost/biketracker')
  .then(() => console.log('DB connected'))
  .catch(e  => console.error('DB error:', e));

// ── Schemas ──────────────────────────────────
const LocationSchema = new mongoose.Schema({
  deviceId:   String,
  lat:        Number,
  lng:        Number,
  speed:      Number,
  tiltX:      Number,
  tiltY:      Number,
  fallen:     Boolean,
  satellites: Number,
  ts: { type: Date, default: Date.now }
});

const AlertSchema = new mongoose.Schema({
  deviceId: String,
  type:     String,
  lat:      Number,
  lng:      Number,
  ts: { type: Date, default: Date.now }
});

const CommandSchema = new mongoose.Schema({
  deviceId: String,
  cmd:      String,
  sent:     { type: Boolean, default: false },
  ts: { type: Date, default: Date.now }
});

const GeofenceSchema = new mongoose.Schema({
  deviceId: String,
  lat:      Number,
  lng:      Number,
  radius:   Number
});

const Location = mongoose.model('Location', LocationSchema);
const Alert    = mongoose.model('Alert',    AlertSchema);
const Command  = mongoose.model('Command',  CommandSchema);
const Geofence = mongoose.model('Geofence', GeofenceSchema);

// ── Helpers ───────────────────────────────────
function haversine(la1,lo1,la2,lo2){
  const R=6371000, f1=la1*Math.PI/180, f2=la2*Math.PI/180;
  const df=(la2-la1)*Math.PI/180, dl=(lo2-lo1)*Math.PI/180;
  const a=Math.sin(df/2)**2+Math.cos(f1)*Math.cos(f2)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── Routes ────────────────────────────────────

// Device sends location every 5 sec
app.post('/api/update', async (req,res) => {
  try {
    const {id,lat,lng,spd,tiltX,tiltY,fallen,sats} = req.body;
    await Location.create({deviceId:id,lat,lng,speed:spd,tiltX,tiltY,fallen,satellites:sats});

    // Geofence check
    const gf = await Geofence.findOne({deviceId:id});
    if(gf){
      const dist = haversine(lat,lng,gf.lat,gf.lng);
      if(dist > gf.radius)
        await Alert.create({deviceId:id,type:'GEOFENCE_EXIT',lat,lng});
    }
    res.json({ok:true});
  } catch(e){ res.status(500).json({err:e.message}); }
});

// Mobile app polls this for live data
app.get('/api/live/:deviceId', async (req,res) => {
  const d = await Location.findOne({deviceId:req.params.deviceId}).sort({ts:-1});
  res.json(d);
});

// Trip history — last 200 points
app.get('/api/history/:deviceId', async (req,res) => {
  const d = await Location.find({deviceId:req.params.deviceId}).sort({ts:-1}).limit(200);
  res.json(d.reverse());
});

// Fall / tamper alert from device
app.post('/api/alert', async (req,res) => {
  const {type,id,lat,lng} = req.query;
  await Alert.create({deviceId:id,type,lat,lng});
  console.log(`ALERT: ${type} from ${id}`);
  res.json({ok:true});
});

// Recent alerts
app.get('/api/alerts/:deviceId', async (req,res) => {
  const d = await Alert.find({deviceId:req.params.deviceId}).sort({ts:-1}).limit(20);
  res.json(d);
});

// Engine kill / restore command
app.post('/api/command', async (req,res) => {
  const {deviceId,cmd} = req.body;
  await Command.create({deviceId,cmd});
  res.json({ok:true});
});

// Device polls this every 10 sec
app.get('/api/command/:deviceId', async (req,res) => {
  const c = await Command.findOneAndUpdate(
    {deviceId:req.params.deviceId,sent:false},
    {sent:true},{new:true}
  );
  res.json({cmd: c ? c.cmd : ''});
});

// Save / update geofence
app.post('/api/geofence', async (req,res) => {
  const {deviceId,lat,lng,radius} = req.body;
  await Geofence.findOneAndUpdate({deviceId},{lat,lng,radius},{upsert:true});
  res.json({ok:true});
});

app.get('/api/geofence/:deviceId', async (req,res) => {
  const d = await Geofence.findOne({deviceId:req.params.deviceId});
  res.json(d || {lat:12.3,lng:76.6,radius:200});
});

// Serve mobile app for all other routes
app.get('/{*splat}', (req,res) => res.sendFile(path.join(__dirname,'public/index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));