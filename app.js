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

app.get("/", (req, res) => {
  res.send("Hello World!");
});

//
app.get("/getIntersectsInGrid", async (req, res) => {
  try {
    let collection = await connectDb("grid-1km");
    const polygon = JSON.parse(req.query.polygon);
    const center = JSON.parse(req.query.center);
    const radius = Math.ceil(req.query.radius);
    const area = Number(req.query.area);
    let createSmallerGrid = false;
    console.log(area, area > 20000);
    //1000*1000m
    if(area > 55000000) {
      console.log("1000");
      createSmallerGrid = false;
    }
    // 100*100m
    else {
      createSmallerGrid = true;
    }

    const result = await collection
      .aggregate([{
          $geoNear: {
              near: { type: "Point", coordinates: center },
              distanceField: "dist.calculated",
              maxDistance: radius,
          },
      },
    ])
      .toArray();
      console.log(createSmallerGrid);
      if(createSmallerGrid) {
        for await (const [i, cell] of result.entries()) {
          let tempCollection = await connectDb("grid-temp");
          await createGrid(options = {
            collection: tempCollection,
            minLon: cell.geometry.coordinates[0],
            maxLon: cell.offset.lon - 0.0001,
            minLat: cell.geometry.coordinates[1],
            maxLat: cell.offset.lat,
            cellSize: 100,
            index: i
          });
        }
        let tempCollection = await connectDb("grid-temp");
        let intsersectionResult = await tempCollection.find({
          geometry: {
            $geoIntersects: {
              $geometry: {
                type: "Polygon",
                coordinates: JSON.parse(req.query.polygon)
              }
            }
          }
        }).toArray();
    await tempCollection.drop();
    res.send(intsersectionResult);
    } else {
      res.send(result);
    }
  } catch (error) {
    console.log(error.message);
    res.status(500).send(error.message);
  }
});

// Created the entire grid of 100*100 cells and stores it in mongodb
app.get("/createGrid", async (req, res) => {
  try {
    let collection = await connectDb("grid-test2");

    const size = await collection.countDocuments();

    if (size == 0) {
      await createGrid({
        collection: collection
      });
    }
    res.sendStatus(201);
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
  const minLat = options.minLat ? options.minLat : -90;
  const maxLat = options.maxLat ? options.maxLat : 90;
  const minLon = options.minLon ? options.minLon : -180;
  const maxLon = options.maxLon ? options.maxLon : 180;
  const cellSize = options.cellSize ? options.cellSize : 100000;

  // Define the size of each grid cell in meters

  let vertices = [];
  let lonStepAmount;
  let lonOffset;
  let latOffset;
  const degreesPerMeter = cellSize / 111319.45;
  
  for (let lat = minLat; lat < maxLat; lat += degreesPerMeter) {
    lonStepAmount = cellSize / (111319.45 * Math.cos((lat * Math.PI) / 180));
    lonCorrection = minLon % lonStepAmount;
    latOffset = lat + degreesPerMeter;
    for (let lon = minLon - lonCorrection; lon < maxLon - lonCorrection; lon += lonStepAmount) {
      lonOffset = lon + lonStepAmount;
      let vertice = {
        _id: { lat, lon, cellSize },
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
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

async function connectDb(collectionName = "test") {
  await client.connect();
  console.log("Connected successfully to server");
  const db = client.db(dbName);
  return db.collection(collectionName);
}
