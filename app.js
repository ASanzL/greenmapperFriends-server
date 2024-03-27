const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const bodyparser = require('body-parser');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyparser.json({limit: '50mb'}));
const port = 3001

const url = 'mongodb://127.0.0.1:27017';
const client = new MongoClient(url);

const dbName = 'greenmapper';

app.get('/', (req, res) => {
  res.send('Hello World!')
})

// Upload to db test
app.get('/checkpolygon', async (req, res) => {
  try {
    let collection = await connectDb();

    const result = await collection.find({
      location: {
        $geoIntersects: {
          $geometry: {
            type: "Polygon",
            coordinates: JSON.parse(req.query.polygon)
          }
        }
      }
    }).toArray();

    console.log(JSON.parse(req.query.polygon)[0].length);
    res.send(result.length > 0);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Upload to db test
app.post('/sethome', async (req, res) => {
  console.log('set home');
  console.log(req.body);
  let collection = await connectDb();
 
  // collection.updateOne({}, { $set: {home: req.body.home} }, { upsert: true });
  console.log(req.body);
  await collection.updateOne({}, { $set: {
    location: { type: "Point", coordinates: req.body}
  }}, { upsert: true });

  res.send('home updated')
})
// Read db test
app.get('/gethome', async (req, res) => {
  
  let collection = await connectDb();

  let results = await collection.aggregate([]).toArray();
  res.send(results).status(200);
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

async function connectDb(collectionName = "test") {
  await client.connect();
  console.log('Connected successfully to server');
  const db = client.db(dbName);
  return db.collection(collectionName);
}