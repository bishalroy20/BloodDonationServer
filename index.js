// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bd8m97l.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Declare variables
let db;
let userCollection;

async function run() {
  try {
    await client.connect();
    db = client.db("BloodDonation");
    userCollection = db.collection("user");
    console.log("✅ Connected to MongoDB");

    // Example route
    app.get("/api/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.json(users);
    });

    // Start server only after DB connection
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}

run().catch(console.dir);