require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// ----------------- MIDDLEWARE -----------------
app.use(cors());
app.use(express.json());

let db;
const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function connectDB() {
  try {
    await client.connect();
    db = client.db(process.env.DB_NAME || "hireloop_db");
    console.log("🚀 Connected to MongoDB Atlas successfully!");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}
connectDB();

// ----------------- API CRUD OPERATIONS -----------------

/**
 * 🚀 GET: Root status endpoint
 * Route: GET http://localhost:5000/
 */
app.get("/", (req, res) => {
  res.send("HireLoop Backend Engine Is Running Perfectly!");
});

/**
 * 🚀 POST: Receive company registration form data and push directly to MongoDB
 * Route: POST http://localhost:5000/api/company
 */
app.post("/api/company", async (req, res) => {
  try {
    if (!db) {
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });
    }

    // Grab the un-mutated business payload sent from your custom form
    const companyData = req.body;

    // Direct, raw insertion into your dedicated 'companies' collection
    const result = await db.collection("companies").insertOne(companyData);

    res.status(201).json({
      success: true,
      message:
        "Company registered successfully and saved directly into MongoDB!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("❌ MongoDB Company Save Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 🚀 GET: Fetch all jobs from MongoDB (Newest First)
 * Route: GET http://localhost:5000/api/jobs
 */
app.get("/api/jobs", async (req, res) => {
  try {
    if (!db) {
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });
    }

    // Find all job records and sort them by creation timestamp descending
    const jobs = await db
      .collection("jobs")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      data: jobs,
    });
  } catch (error) {
    console.error("❌ MongoDB Fetch Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 🚀 POST: Receive client data and push directly to MongoDB
 * Route: POST http://localhost:5000/api/jobs
 */
app.post("/api/jobs", async (req, res) => {
  try {
    if (!db) {
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });
    }

    const dataToSave = req.body;
    const result = await db.collection("jobs").insertOne(dataToSave);

    res.status(201).json({
      success: true,
      message: "Data synced and saved directly into MongoDB!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("❌ MongoDB Save Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------- START ENGINE -----------------
app.listen(port, () => {
  console.log(`📡 Express API running on port ${port}`);
});
