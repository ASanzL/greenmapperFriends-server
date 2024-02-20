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
app.post('/upload', async (req, res) => {
  console.log('upload');
  console.log(req.body);
  let collection = await connectDb();
 
  // await collection.insertOne({home: req.body.home}).then(r => console.log(r));
  collection.updateOne({}, { $set: {home: req.body.home} });

  res.send('added test')
})
// Read db test
app.get('/read', async (req, res) => {
  
  let collection = await connectDb();

  let results = await collection.aggregate([]).toArray();
  res.send(results).status(200);
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

async function connectDb() {
  await client.connect();
  console.log('Connected successfully to server');
  const db = client.db(dbName);
  return db.collection('test');
}