const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");
const bodyparser = require("body-parser");
const axios = require("axios");

require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyparser.json({ limit: "50mb" }));
const port = 3001;

const url = "mongodb://127.0.0.1:27017";
const client = new MongoClient(url);

const dbName = "greenmapper";

const earthRadius = 6371000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

//
app.get("/getIntersectsInGrid", async (req, res) => {
  try {
    const polygon = JSON.parse(req.query.polygon);
    const center = JSON.parse(req.query.center);
    const radius = Math.ceil(req.query.radius);
    const area = Number(req.query.area);
    let gridSize = 10000;
    let collectionName = "grid-100km";
    let tempCollectionName = "";
    console.log(area);
    // World
    if(area > Number(req.query.worldMinArea)) {
      gridSize = 100000;
      collectionName = "grid-100km";
    }
    // Country
    else if (area > Number(req.query.countryMinArea)) {
      gridSize = 10000;
      collectionName = "grid-10km";
    }
    // region
    else if (area > Number(req.query.regionMinArea)) {
      gridSize = 1000;
      collectionName = "grid-1km";
    }
    // neighbourhood
    else if (area > 0) {
      gridSize = 100;
      collectionName = "grid-1km";
      tempCollectionName = "grid-temp-" + Math.floor(Math.random() * 10000000).toString();
      console.log(tempCollectionName);
    }
    else {
      res.status(500).send("Error: No polygon");
      return;
    }
    
    let collection = await connectDb(collectionName);
    const result = await collection
      .aggregate([{
          $geoNear: {
              near: { type: "Point", coordinates: center },
              distanceField: "dist.calculated",
              maxDistance: radius * 1.4,
          },
      },
    ])
      .toArray();
      // If the grid is 100*100m, create a temporary grid based on 1km cells
      if(gridSize == 100) {
        for await (const [i, cell] of result.entries()) {
          let tempCollection = await connectDb(tempCollectionName);
          await createGrid(options = {
            collection: tempCollection,
            minLon: cell.geometry.coordinates[0],
            maxLon: cell.offset.lon,
            minLat: cell.geometry.coordinates[1],
            maxLat: cell.offset.lat,
            cellSize: 100,
            index: i
          });
        }
      }
      let intersectCollection = await connectDb(gridSize == 100 ? tempCollectionName : collectionName);
        let intsersectionResult = await intersectCollection.find({
          geometry: {
            $geoIntersects: {
              $geometry: {
                type: "Polygon",
                coordinates: polygon
              }
            }
          }
        }).toArray();
    //await tempCollection.drop();
    res.send(intsersectionResult);

  } catch (error) {
    console.log(error.message);
    res.status(500).send(error.message);
  }
});

// Created the entire grid of 100*100 cells and stores it in mongodb
app.get("/createGrid", async (req, res) => {
  try {
    let collection = await connectDb("grid-100km");

    const size = await collection.countDocuments();

    if (size == 0) {
      const result = await createGrid({
        collection: collection,
        cellSize: 100000
      });
      res.send({ created: result.length });
    }
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Created the entire grid of 100*100 cells and stores it in mongodb
app.get("/cell", async (req, res) => {
  try {
    console.log(req.query);
    if(!req.query.lat || !req.query.lon || !req.query.cellSize) {
      res.status(400).send("Require latitude, lonitude and cellSize");
    }
    let collection = await connectDb("grid");

    const result = await collection
      .find({
        _id: {
          lat: { $gte: 0 },
          lon: Number(req.query.lon),
          cellSize: Number(req.query.cellSize)
        },
      }).toArray();
      console.log(result);
    res.send(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
});
// Search in GeoServer
app.get("/geoServer", async (req, res) => {
  try {
    const polygon = JSON.parse(req.query.polygon);
    let polygonWFSString = "";

    polygon.forEach((point, index) => {
      polygonWFSString += `${point[0]} ${point[1]}`;
      if(index != polygon.length -1) {
        polygonWFSString += ", ";
      }
    });

    // Convert polygon coordinates to WKT (Well-Known Text) format
    const polygonWKT = `POLYGON((${polygonWFSString}))`;

    console.time("GeoServer");
    // Make the request to GeoServer
    axios.get("http://217.21.192.143:8080/geoserver/wfs", {
      params: {
        service: 'WFS',
        version: '1.1.1',
        request: 'GetFeature',
        typename: 'ltser:greenmapper.grid',
        srsname: 'EPSG:4326',
        outputFormat: 'application/json',
        cql_filter: `INTERSECTS(geom, ${(polygonWKT)})`
      },
      responseType: 'json',
    })
    .then(function (response) {
      console.timeEnd("GeoServer");
      res.send({ data: response.data.features });
    })
    .catch(function (error) {
      console.log(error.message);
      res.status(550).send(error);
    });

  } catch (error) {
    console.log(error.message);
    res.status(550).send(error.message);
  }
});


// Only for debug
app.get("/getGrid", async (req, res) => {
  try {
    let collection = await connectDb("grid");

    const result = await collection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Upload to db test
app.post("/sethome", async (req, res) => {
  let collection = await connectDb();

  // collection.updateOne({}, { $set: {home: req.body.home} }, { upsert: true });
  await collection.updateOne(
    {},
    {
      $set: {
        location: { type: "Point", coordinates: req.body },
      },
    },
    { upsert: true },
  );

  res.send("home updated");
});
// Read db test
app.get("/gethome", async (req, res) => {
  let collection = await connectDb();

  let results = await collection.aggregate([]).toArray();
  res.send(results).status(200);
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

async function createGrid(options = { collection, minLat, maxLat, minLon, maxLon, cellSize }) {
  const collection = options.collection ? options.collection : null;
  const minLat = options.minLat ? options.minLat : -89;
  const maxLat = options.maxLat ? options.maxLat : 89;
  const minLon = options.minLon ? options.minLon : -179;
  const maxLon = options.maxLon ? options.maxLon : 179;
  const cellSize = options.cellSize ? options.cellSize : 100000;

  // Define the size of each grid cell in meters

  let vertices = [];
  let lonStepAmount;
  let lonOffset;
  let latOffset;

  let latStepAmount = Math.abs(minLat - calculateDegreesLatitude(minLat, cellSize));
  // console.log(latStepAmount);
  lonStepAmount = Math.abs(calculateDegreesLongitude(minLon, cellSize, minLat, minLat + latStepAmount));
  let lastLon = minLon;
  
  for (let lat = minLat; lat < maxLat - latStepAmount; lat += latStepAmount - 0.000001) {
    latStepAmount = Math.abs(lat - calculateDegreesLatitude(lat, cellSize, 180));
    // λ2 = λ1 + atan2( sin θ ⋅ sin δ ⋅ cos φ1, cos δ − sin φ1 ⋅ sin φ2 )
    lonCorrection = minLon % lonStepAmount;
    latOffset = lat + latStepAmount;
    lonStepAmount = Math.abs(calculateDegreesLongitude(lastLon, cellSize, lat, lat + latStepAmount));
    for (let lon = minLon - lonCorrection; lon < maxLon - lonCorrection; lon += lonStepAmount + 0.000001) {
      lastLon = lon;
      lonOffset = lon + lonStepAmount;
      let vertice = {
        _id: { lat, lon, cellSize },
        geometry: {
          type: "Point",
          coordinates: [((lon + 180) % 360 + 360) % 360 - 180, lat],
        },
        offset: {
          lon: lonOffset,
          lat: latOffset
        }
      };
      if (options.index != null) {
        vertice._id.index = options.index;
      }
      vertices.push(vertice);
    }
    if (collection != null && vertices.length > 2000000) {
      console.log("Insert: ", vertices.length);
      await collection.insertMany(vertices, { ordered: false });
      console.log("Insert done");
      vertices = [];
    }
  }
  if(collection != null) {
    await collection.insertMany(vertices, { ordered: false });
  }
  // Insert the polygon into MongoDB
  // console.timeEnd("grid create");
  return vertices;
}

function calculateDegreesLatitude(lat1, distance, bearing = 90) {
  const lat1Rad = lat1 * (Math.PI / 180); // Convert latitude to radians
  const bearingRad = bearing * (Math.PI / 180); // Convert bearing to radians

  return Math.asin(Math.sin(lat1Rad) * Math.cos(distance / earthRadius) + Math.cos(lat1Rad) * Math.sin(distance / earthRadius) * Math.cos(bearingRad)) * (180 / Math.PI);
}

function calculateDegreesLongitude(lon1, distance, lat1, lat2, bearing = 90) {
  const lat1Rad = lat1 * (Math.PI / 180); // Convert latitudes to radians
  const lat2Rad = lat2 * (Math.PI / 180);
  const bearingRad = bearing * (Math.PI / 180); // Convert bearing to radians

  return Math.atan2(Math.sin(bearingRad) * Math.sin(distance / earthRadius) * Math.cos(lat1Rad),
      Math.cos(distance / earthRadius) - Math.sin(lat1Rad) * Math.sin(lat2Rad)) * (180 / Math.PI);
}

async function connectDb(collectionName = "test") {
  await client.connect();
  console.log("Connected successfully to server");
  const db = client.db(dbName);
  return db.collection(collectionName);
}
