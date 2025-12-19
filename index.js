// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bd8m97l.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});
const DB_NAME = process.env.DB_NAME || "BloodDonation";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);


let db, userCollection, requestCollection , fundingCollection;



function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach decoded payload { uid, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized: Invalid token" });
  }
}



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




// Get user by uid
app.get("/api/users/:uid", async (req, res) => {
  const user = await userCollection.findOne({ uid: req.params.uid });
  res.json(user);
});

// Update user by uid
app.patch("/api/users/:uid", async (req, res) => {
  const { name, avatarUrl, bloodGroup, district, upazila } = req.body;
  await userCollection.updateOne(
    { uid: req.params.uid },
    { $set: { name, avatarUrl, bloodGroup, district, upazila } }
  );
  res.json({ success: true });
});




// Create donation request
app.post("/api/requests", async (req, res) => {
  try {
    const { requesterUid } = req.body;

    if (!requesterUid) {
      return res.status(400).json({ message: "Requester UID required" });
    }

    const user = await userCollection.findOne({ uid: requesterUid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const status = String(user.status || "").trim().toLowerCase();
    if (status !== "active") {
      return res
        .status(403)
        .json({ message: "Blocked users cannot create a donation request" });
    }

    const newRequest = {
      ...req.body,
      status: "pending",
      createdAt: new Date(),
    };

    const result = await requestCollection.insertOne(newRequest);

    res.json({
      success: true,
      request: { ...newRequest, _id: result.insertedId },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


// Get requests by user (with optional status, pagination)
app.get("/api/requests", async (req, res) => {
  const { uid, status, page = 1, limit = 10 } = req.query;
  const query = { requesterUid: uid };
  if (status) query.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const cursor = requestCollection.find(query).skip(skip).limit(parseInt(limit));
  const items = await cursor.toArray();
  const total = await requestCollection.countDocuments(query);

  res.json({ items, total });
});

// Get single request details
app.get("/api/requests/:id", async (req, res) => {
  const request = await requestCollection.findOne({ _id: new ObjectId(req.params.id) });
  res.json(request);
});

// Update donation request (edit form)
app.patch("/api/requests/:id", async (req, res) => {
  await requestCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body }
  );
  res.json({ success: true });
});

// Volunteers and Admins can view all requests
app.get("/api/admin/requests", requireRole(["admin", "volunteer"]), async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const query = {};
  if (status) query.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const items = await requestCollection.find(query).skip(skip).limit(parseInt(limit)).toArray();
  const total = await requestCollection.countDocuments(query);

  res.json({ items, total });
});

// Volunteers and Admins can update status
app.patch("/api/admin/requests/:id/status", requireRole(["admin", "volunteer"]), async (req, res) => {
  const { status } = req.body;
  await requestCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status } }
  );
  res.json({ success: true });
});

// Delete donation request
app.delete("/api/requests/:id", async (req, res) => {
  await requestCollection.deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ success: true });
});


// for admin dashboard
// GET total donors
app.get("/api/stats/total-donors", async (req, res) => {
  const total = await userCollection.countDocuments({ role: "donor" });
  res.json({ total });
});

// GET total funding (sum amount from funding collection)
app.get("/api/stats/total-funding", async (req, res) => {
  const fundingCollection = db.collection("funding");
  const agg = await fundingCollection.aggregate([
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]).toArray();
  res.json({ total: agg[0]?.total || 0 });
});

// GET total blood donation requests
app.get("/api/stats/total-requests", async (req, res) => {
  const total = await requestCollection.countDocuments({});
  res.json({ total });
});

//all user mgt

// GET all users with optional status filter and pagination
app.get("/api/admin/users", async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const query = {};
  if (status) query.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const items = await userCollection.find(query).skip(skip).limit(parseInt(limit)).toArray();
  const total = await userCollection.countDocuments(query);
  res.json({ items, total });
});



// PATCH user status (active / blocked)
app.patch("/api/admin/users/:uid/status", async (req, res) => {
  const { status } = req.body;
  await userCollection.updateOne({ uid: req.params.uid }, { $set: { status } });
  res.json({ success: true });
});

// PATCH user role (donor / volunteer / admin)
app.patch("/api/admin/users/:uid/role", async (req, res) => {
  const { role } = req.body;
  await userCollection.updateOne({ uid: req.params.uid }, { $set: { role } });
  res.json({ success: true });
});


//all donation req

// GET all requests with optional status, pagination
app.get("/api/admin/requests", async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const query = {};
  if (status) query.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const items = await requestCollection.find(query).skip(skip).limit(parseInt(limit)).toArray();
  const total = await requestCollection.countDocuments(query);
  res.json({ items, total });
});

// PATCH a request's status
app.patch("/api/admin/requests/:id/status", async (req, res) => {
  const { status } = req.body;
  await requestCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status } }
  );
  res.json({ success: true });
});

// PATCH a request (edit)
app.patch("/api/admin/requests/:id", async (req, res) => {
  await requestCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body }
  );
  res.json({ success: true });
});

// DELETE a request
app.delete("/api/admin/requests/:id", async (req, res) => {
  await requestCollection.deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ success: true });
});



// search page
// Search donors by blood group, district, upazila
app.get("/api/search-donors", async (req, res) => {
  const { bloodGroup, district, upazila } = req.query;
  const query = {};

  if (bloodGroup) query.bloodGroup = bloodGroup;
  if (district) query.district = district;
  if (upazila) query.upazila = upazila;

  try {
    const donors = await userCollection.find(query).toArray();
    res.json(donors);
  } catch (err) {
    console.error("Error searching donors:", err);
    res.status(500).json({ message: "Server error" });
  }
});



// Get all pending donation requests (public)
app.get("/api/public/requests", async (req, res) => {
  try {
    const requests = await requestCollection.find({ status: "pending" }).toArray();
    res.json(requests);
  } catch (err) {
    console.error("Error fetching pending requests:", err);
    res.status(500).json({ message: "Server error" });
  }
});



// Confirm donation: change status from pending to inprogress
app.patch("/api/requests/:id/confirm", async (req, res) => {
  try {
    const { donorName, donorEmail } = req.body;
    const _id = new ObjectId(req.params.id);

    const request = await requestCollection.findOne({ _id });
    if (!request) return res.status(404).json({ message: "Request not found" });

    if (request.status !== "pending") {
      return res.status(400).json({ message: "Request is not pending" });
    }

    await requestCollection.updateOne(
      { _id },
      {
        $set: {
          status: "inprogress",
          donorName,
          donorEmail,
          updatedAt: new Date(),
        },
      }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error confirming donation:", err);
    res.status(500).json({ message: "Server error" });
  }
});



function requireRole(roles) {
  return async (req, res, next) => {
    const { uid } = req.body; // or from JWT/session
    const user = await userCollection.findOne({ uid });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!roles.includes(user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient privileges" });
    }
    next();
  };
}

// Issue JWT (example login/upsert endpoint)
app.post("/api/auth/issue-token", async (req, res) => {
  try {
    const { uid, email } = req.body;
    if (!uid || !email) return res.status(400).json({ message: "uid and email required" });

    const user = await userCollection.findOne({ uid });
    if (!user) return res.status(404).json({ message: "User not found" });

    const token = jwt.sign({ uid, email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// Create payment intent (private)
app.post("/api/funding/create-intent", requireAuth, async (req, res) => {
  try {
    const { amount } = req.body; // in smallest unit: cents (USD) or paisa (BDT)
    if (!amount || amount <= 0) return res.status(400).json({ message: "Invalid amount" });

    const paymentIntent = await stripe.paymentIntents.create({
      amount, // e.g., 500 = $5.00
      currency: process.env.STRIPE_CURRENCY || "usd",
      metadata: { uid: req.user.uid, email: req.user.email },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ message: "Payment error" });
  }
});


// Record funding after successful payment (webhook or client confirm)
app.post("/api/funding/record", requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: "Invalid amount" });

    const donor = await userCollection.findOne({ uid: req.user.uid });
    if (!donor) return res.status(404).json({ message: "User not found" });

    const doc = {
      uid: req.user.uid,
      name: donor.name || "",
      email: donor.email,
      amount, // store smallest unit or normalized currency value consistently
      currency: process.env.STRIPE_CURRENCY || "usd",
      createdAt: new Date(),
    };

    const result = await fundingCollection.insertOne(doc);
    res.json({ success: true, funding: { ...doc, _id: result.insertedId } });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});






// List all funds (private)
app.get("/api/funding", requireAuth, async (req, res) => {
  try {
    const items = await fundingCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(items);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// Admin/Volunteer: total funding (for dashboards)
app.get("/api/stats/total-funding", requireAuth, requireRole(["admin", "volunteer"]), async (req, res) => {
  try {
    const agg = await fundingCollection.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]).toArray();
    res.json({ total: agg[0]?.total || 0, currency: process.env.STRIPE_CURRENCY || "usd" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});





// Connect DB and start server
async function run() {
  try {
    await client.connect();
    db = client.db("BloodDonation");
    userCollection = db.collection("user");
    requestCollection = db.collection("requests");
    fundingCollection = db.collection("funding");


    await userCollection.createIndex({ uid: 1 }, { unique: true });
    await fundingCollection.createIndex({ uid: 1 });
    await fundingCollection.createIndex({ createdAt: -1 });


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