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

    res.send(result.length > 0);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// 
app.get('/getIntersectsInGrid', async (req, res) => {
  // console.log(JSON.parse(req.query.polygon));
  
  try {
    let collection = await connectDb('grid');
    const result = await collection.countDocuments({
      geometry: {
        $geoIntersects: {
            $geometry: {
                type: 'Polygon',
                coordinates: JSON.parse(req.query.polygon)
            }
        }
    }
    });

    console.log("intersectResult", result);
    res.send({"count": result});
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Created the entire grid of 100*100 cells and stores it in mongodb
app.get('/createGrid', async (req, res) => {
  try {
    let collection = await connectDb("grid");

    const size = await collection.countDocuments();

    if(size == 0) {
     // Define the bounding box for Trollhättan
    const minLat = 58.2; // Minimum latitude
    const maxLat = 58.3; // Maximum latitude
    const minLon = 12.2; // Minimum longitude
    const maxLon = 12.35; // Maximum longitude

    // Define the size of each grid cell in meters
    const cellSize = 1000; // meters

    // Calculate the number of steps needed for latitude and longitude
    const numberOfStepsLat = Math.ceil((maxLat - minLat) * 111319.45 / cellSize);
    const numberOfStepsLon = Math.ceil((maxLon - minLon) * 111319.45 * Math.cos(minLat * Math.PI / 180) / cellSize);

    // Iterate over latitude and longitude within the bounding box
    for (let lat = minLat; lat < maxLat; lat += cellSize / 111319.45) {
        for (let lon = minLon; lon < maxLon; lon += (cellSize / (111319.45 * Math.cos(lat * Math.PI / 180)))) {
            const vertices = [
                [lon, lat],
                [lon + (cellSize / (111319.45 * Math.cos(lat * Math.PI / 180))), lat],
                [lon + (cellSize / (111319.45 * Math.cos(lat * Math.PI / 180))), lat + (cellSize / 111319.45)],
                [lon, lat + (cellSize / 111319.45)],
                [lon, lat]  // Repeat the first vertex to close the polygon
            ];

            // Insert the polygon into MongoDB
            await collection.insertOne({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [vertices]
                }
            });
        }
    }

  }
    res.send(size);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Only for debug
app.get('/getGrid', async (req, res) => {
  try {
    let collection = await connectDb('grid');
    
    const result = await collection.find().toArray();
    console.log("getGrid");
    res.send(result);
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