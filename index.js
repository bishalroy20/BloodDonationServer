// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bd8m97l.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

let db;
let userCollection;

// Registration route
app.post("/api/auth/register", async (req, res) => {
  try {
    const { uid, email, name, avatarUrl, bloodGroup, district, upazila } = req.body;
    const newUser = {
      uid,
      email,
      name,
      avatarUrl,
      bloodGroup,
      district,
      upazila,
      role: "donor",   // default role
      status: "active" // default status
    };
    const result = await userCollection.insertOne(newUser);
    res.json({ success: true, user: { ...newUser, _id: result.insertedId } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

// List all users
app.get("/api/users", async (req, res) => {
  const users = await userCollection.find().toArray();
  res.json(users);
});

// Change role
app.patch("/api/users/:id/role", async (req, res) => {
  const { role } = req.body;
  await userCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { role } }
  );
  res.json({ success: true });
});

// Block/unblock user
app.patch("/api/users/:id/status", async (req, res) => {
  const { status } = req.body;
  await userCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status } }
  );
  res.json({ success: true });
});

// Connect DB and start server
async function run() {
  try {
    await client.connect();
    db = client.db("BloodDonation");
    userCollection = db.collection("user");
    console.log("✅ Connected to MongoDB");

    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}
run().catch(console.dir);