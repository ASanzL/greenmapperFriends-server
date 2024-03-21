const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const bodyparser = require('body-parser');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyparser.json({limit: '50mb'}));
const port = 3001

const url = 'mongodb://localhost:27017';
const client = new MongoClient(url);

const dbName = 'greenmapper';

app.get('/', (req, res) => {
  res.send('Hello World!')
})

// Upload to db test
app.get('/checkpolygon', async (req, res) => {
  try {
    let collection = await connectDb("polygonTest");

    // Update or insert the polygon document
    await collection.updateOne({}, { $set: {
      location: { type: "Polygon", coordinates: [
        [
          [
              12.358589,
              58.278245
          ],
          [
              12.240829,
              58.307477
          ],
          [
              12.221947,
              58.301344
          ],
          [
              12.347603,
              58.270121
          ],
          [
              12.358589,
              58.278245
          ]
      ]
      ]}
    }}, { upsert: true });

    // Find overlapping polygons
    const result = await collection.find({
      location: {
        $geoIntersects: {
          $geometry: {
            type: "Polygon",
            coordinates: [
              [
                [12.241173, 58.300081],
                [12.22023, 58.261995],
                [12.285118, 58.244833],
                [12.364426, 58.303661],
                [12.328033, 58.330708],
                [12.241173, 58.300081]
              ]
            ]
          }
        }
      }
    }).toArray();
    console.log(result);
    res.send(result.length > 0 ? result : "No overlap");
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Upload to db test
app.post('/sethome', async (req, res) => {
  console.log('set home');
  console.log(req.body);
  let collection = await connectDb();
 
  collection.updateOne({}, { $set: {home: req.body.home} }, { upsert: true });

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