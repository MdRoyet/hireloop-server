require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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

app.get("/", (req, res) => {
  res.send("HireLoop Backend Engine Is Running Perfectly!");
});

app.post("/api/company", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const companyData = req.body;
    const result = await db.collection("companies").insertOne(companyData);

    res.status(201).json({
      success: true,
      message:
        "Company profile cleanly written with assigned recruiterId index reference!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/company", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const query = {};
    if (req.query.recruiterId) {
      query.recruiterId = req.query.recruiterId;
    }

    const companies = await db
      .collection("companies")
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json({ success: true, data: companies });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/dashboard/recruiter-stats", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not ready" });

    const query = {};
    if (req.query.recruiterId) {
      query.recruiterId = req.query.recruiterId;
    }

    const totalJobs = await db.collection("jobs").countDocuments(query);
    const activeJobs = await db
      .collection("jobs")
      .countDocuments({ ...query, status: "active" });
    const closedJobs = await db
      .collection("jobs")
      .countDocuments({ ...query, status: "closed" });

    res.status(200).json({
      success: true,
      stats: {
        totalJobs,
        totalApplicants: 0,
        activeJobs,
        closedJobs: closedJobs || 0,
      },
      recentApplications: [],
      topCompanies: [],
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/jobs", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const query = {};

    if (req.query.recruiterId) query.recruiterId = req.query.recruiterId;
    if (req.query.search)
      query.title = { $regex: req.query.search, $options: "i" };
    if (req.query.category && req.query.category !== "all")
      query.category = req.query.category;
    if (req.query.type && req.query.type !== "all") query.type = req.query.type;
    if (req.query.isRemote === "true")
      query.$or = [{ isRemote: true }, { isRemote: "true" }];

    const jobs = await db
      .collection("jobs")
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/jobs", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const dataToSave = req.body;
    dataToSave.createdAt = new Date().toISOString();

    const result = await db.collection("jobs").insertOne(dataToSave);

    res.status(201).json({
      success: true,
      insertedId: result.insertedId,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/jobs/:id", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const { id } = req.params;

    const searchConditions = [{ _id: id }];

    if (ObjectId.isValid(id)) {
      searchConditions.push({ _id: new ObjectId(id) });
    }

    const job = await db.collection("jobs").findOne({ $or: searchConditions });

    if (!job) {
      return res
        .status(404)
        .json({ success: false, error: "Job not found in database." });
    }

    res.status(200).json({ success: true, data: job });
  } catch (error) {
    console.error("❌ MongoDB Fetch Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 🚀 POST: Pure Simple Direct Injection Job Application
 * Captures absolutely every field sent by the frontend form without filtering.
 */
app.post("/api/applications", async (req, res) => {
  try {
    if (!db) {
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });
    }

    // Displays the full incoming payload right inside your terminal window
    console.log("-----------------------------------------");
    console.log("📥 Data arrived safely at server:", req.body);
    console.log("-----------------------------------------");

    // Grab req.body completely and drop it straight into MongoDB Atlas
    const result = await db.collection("applications").insertOne(req.body);

    return res
      .status(201)
      .json({ success: true, insertedId: result.insertedId });
  } catch (error) {
    console.error("💥 Server Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------- START ENGINE -----------------
app.listen(port, () => {
  console.log(`📡 Express API running on port ${port}`);
});
