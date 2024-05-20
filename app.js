const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");
const bodyparser = require("body-parser");
const axios = require("axios");
const MGRS = require("@ngageoint/mgrs-js");
const { Point } = require("@ngageoint/grid-js");
require("@ngageoint/grid-js");


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
    let mgrsSize = MGRS.GridType.TEN_KILOMETER;
    let collectionName = "grid-100km";
    let tempCollectionName = "";
    // World
    if(area > Number(req.query.worldMinArea)) {
      gridSize = 100000;
      // The frontend cant handle 100km size
      mgrsSize = MGRS.GridType.TEN_KILOMETER;
      collectionName = "grid-100km";
    }
    // Country
    else if (area > Number(req.query.countryMinArea)) {
      gridSize = 10000;
      mgrsSize = MGRS.GridType.TEN_KILOMETER;
      collectionName = "grid-10km";
    }
    // Region
    else if (area > Number(req.query.regionMinArea)) {
      gridSize = 1000;
      mgrsSize = MGRS.GridType.KILOMETER;
      collectionName = "grid-1kmm";
    }
    // Neighbourhood
    else if (area > 0) {
      gridSize = 100;
      mgrsSize = MGRS.GridType.HUNDRED_METER;
      collectionName = "grid-1kmm";
      tempCollectionName = "grid-temp-" + Math.floor(Math.random() * 10000000).toString();
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
    ]).toArray();

    // If the grid is 100*100m, create a temporary grid based on 1km cells
    if(gridSize == 100) {
      for await (const [i, cell] of result.entries()) {
        let tempCollection = await connectDb(tempCollectionName);
        await createGrid(options = {
          collection: tempCollection,
          minLon: cell.geometry.coordinates[0],
          maxLon: cell.geometry.coordinates[0] + cell.offset.lon,
          minLat: cell.geometry.coordinates[1],
          maxLat: cell.geometry.coordinates[1] + cell.offset.lat,
          cellSize: 100,
          index: i
        });
      }
    }

    let intersectCollection = await connectDb(gridSize == 100 ? tempCollectionName : collectionName);

    let filter = {
      geometry: {
        $geoIntersects: {
          $geometry: {
            type: "Polygon",
            coordinates: polygon
          }
        }
      }
    };

    let intsersectionResult = await intersectCollection.find(filter).toArray();
    if(gridSize == 100) {
      let tempCollection = await connectDb(tempCollectionName);
      await tempCollection.drop();
    }

    let mgrsGrid = [];

    for (cell of intsersectionResult) {
      mgrsGrid.push(getMGRSStringFromLatLng(cell.geometry.coordinates[1], cell.geometry.coordinates[0], mgrsSize));
    }

    res.send({
      createdGrid: intsersectionResult, 
      mgrsGrid
    });

  } catch (error) {
    console.log(error.message);
    res.status(500).send(error.message);
  }
});

// Created the entire grid of size "cellSize" cells and stores it in mongodb
app.get("/createGrid", async (req, res) => {
  try {
    for(let x = 0; x < 1; x++) {
      console.time("create")
      let collection = await connectDb("grid-100km-m");
  
      const size = await collection.countDocuments();
  
      if (size == 0) {
        const result = await createGrid({
          minLat: -90,
          maxLat: 90,
          minLon: -180,
          maxLon: 180,
          collection: collection,
          cellSize: 1000
        });
        await collection.createIndex( { "geometry" : "2dsphere" } );
        console.timeEnd("create");
        await collection.drop();
    }
  }
  res.send(
    // { created: result.length }
    {created: true}
  );
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

// Donate on an array of cells
app.post("/donate", async (req, res) => {
  try {
    let cells = req.body.params.cells;
    let collection = await connectDb("donations");
    let cellsToInsert = [];
    // await cells.forEach(async (cell) => {
    //   let storedCell = await getCellFromLatLng(cell.southWest.lat, cell.southWest.lng, cell.size, "grid-10km");
    //   console.log("storedcell");
    //   cellsToInsert.push(storedCell);
    // });
    for (const cell of cells) {
      let storedCell = await getCellFromLatLng(cell.southWest.lat, cell.southWest.lng, cell.size, cellSizeToCollectionName(cell.size));
      console.log("storedcell");
      cellsToInsert.push(storedCell);
    }
    console.log("INSERT");
    await collection.insertOne({
      cells: cellsToInsert
    });
    res.send(cells);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Get all cells for creating the heatmap
app.get("/heatmap", async (req, res) => {
  try {
    // let cellSize = req.body.params.cellSize;
    let collection = await connectDb("donations");
    
    let result = await collection.find().toArray();

    console.log(result);

    res.send(result);
  } catch (error) {
    res.status(500).send(error.message);
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
  let coords = [];
  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 10; y++) {
      const mgrsObject = MGRS.MGRS.from(Point.point(x / 10, y / 10));
      const mgrs10km = mgrsObject.coordinate(MGRS.GridType.TEN_KILOMETER);
      coords.push(mgrs10km);
    }
  }
  let results = await collection.aggregate([]).toArray();
  res.send(coords).status(200);
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

  let latStepAmount = Math.abs(minLat - calculateDegreesLatitude(minLat, cellSize));
  lonStepAmount = Math.abs(calculateDegreesLongitude(minLon, cellSize, minLat, minLat + latStepAmount));
  let lastLon = minLon;
  
  for (let lat = minLat; lat + latStepAmount < maxLat + 0.0001; lat += latStepAmount) {
    latStepAmount = Math.abs(lat - calculateDegreesLatitude(lat, cellSize, 0));
    // λ2 = λ1 + atan2( sin θ ⋅ sin δ ⋅ cos φ1, cos δ − sin φ1 ⋅ sin φ2 )
    lonStepAmount = Math.abs(calculateDegreesLongitude(lastLon, cellSize, lat, lat + latStepAmount));
    for (let lon = minLon; maxLon > lon + lonStepAmount - 0.00001; lon += lonStepAmount) {
      lastLon = lon;
      let vertice = {
        _id: { lat, lon, cellSize },
        geometry: {
          type: "Point",
          coordinates: [((lon + 180) % 360 + 360) % 360 - 180, lat],
        },
        offset: {
          lon: lonStepAmount,
          lat: latStepAmount
        }
      };
      if (options.index != null) {
        vertice._id.index = options.index;
      }
      // if (vertices.length == 0) {
        vertices.push(vertice);
      // }
    }
    if (collection != null && vertices.length > 2000000) {
      await collection.insertMany(vertices, { ordered: false });
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

  return Math.asin(Math.sin(lat1Rad) * Math.cos(distance / earthRadius) + Math.cos(lat1Rad) * 
  Math.sin(distance / earthRadius) * Math.cos(bearingRad)) * (180 / Math.PI);
}

function calculateDegreesLongitude(lon1, distance, lat1, lat2, bearing = 90) {
  const lat1Rad = lat1 * (Math.PI / 180); // Convert latitudes to radians
  const lat2Rad = lat2 * (Math.PI / 180);
  const bearingRad = bearing * (Math.PI / 180); // Convert bearing to radians

  return Math.atan2(Math.sin(bearingRad) * Math.sin(distance / earthRadius) * Math.cos(lat1Rad),
      Math.cos(distance / earthRadius) - Math.sin(lat1Rad) * Math.sin(lat2Rad)) * (180 / Math.PI);
}

function getMGRSStringFromLatLng(lat, lng, size) {
  const mgrsObject = MGRS.MGRS.from(Point.point(lng, lat));
  return mgrsObject.coordinate(size);
}

async function connectDb(collectionName = "test") {
  await client.connect();
  console.log("Connected successfully to server");
  const db = client.db(dbName);
  return db.collection(collectionName);
}

async function getCellFromLatLng(lat, lng, size, grid) {
  let collection = await connectDb(grid);
  const resultNear = await collection
  .aggregate([{
      $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] },
          distanceField: "dist.calculated",
          maxDistance: size * 0.1,
      },
  },
]).toArray();
return resultNear;
}

function cellSizeToCollectionName(cellSize) {
  switch (cellSize) {
    case 100000:
      return "grid-100km";
      break;
    case 10000:
      return "grid-10km";
      break;
    case 1000:
      return "grid-1kmm";
      break;
    case 100:
      return "grid-1kmm";
      break;
  
    default:
      return "Not an accepted size"
      break;
  }
}