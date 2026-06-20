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

// 🚀 CENTRAL SUBSCRIPTION PLAN LIMIT DEFINITIONS
const PLAN_LIMITS = {
  seeker_free: 3,
  seeker_pro: 30,
  seeker_premium: "unlimited",
  recruiter_free: 3,
  recruiter_growth: 10,
  recruiter_enterprise: "unlimited",
};

function normalizeRole(role) {
  if (!role) return "seeker";
  const value = String(role).toLowerCase().replace(/-/g, "_");
  if (value === "recruiter") return "recruiter";
  if (value === "admin") return "admin";
  return "seeker";
}

function defaultPlanForRole(role) {
  return normalizeRole(role) === "recruiter" ? "recruiter_free" : "seeker_free";
}

function getBillingCycleStart(user) {
  const accountCreatedDate = new Date(user.createdAt || new Date());
  const now = new Date();
  let cycleStartDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    accountCreatedDate.getDate(),
  );

  if (cycleStartDate > now) {
    cycleStartDate.setMonth(cycleStartDate.getMonth() - 1);
  }

  return cycleStartDate.toISOString();
}

async function findUserByIdentity({ email, authUserId }) {
  if (!db) return null;

  const conditions = [];
  if (email) conditions.push({ email });
  if (authUserId) conditions.push({ authUserId });

  if (conditions.length === 0) return null;

  return db.collection("users").findOne({ $or: conditions });
}

function buildQuotaResponse({ plan, used, limit }) {
  let remaining = 0;
  if (limit === "unlimited") {
    remaining = "unlimited";
  } else {
    remaining = Math.max(0, limit - used);
  }

  return {
    plan,
    used,
    limit,
    remaining,
    canApply: remaining === "unlimited" || remaining > 0,
    canPost: remaining === "unlimited" || remaining > 0,
  };
}

// ----------------- API CRUD OPERATIONS -----------------

app.get("/", (req, res) => {
  res.send("HireLoop Backend Engine Is Running Perfectly!");
});

/**
 * POST: /api/user/sync
 * Creates or updates the billing profile used for plan limits.
 */
app.post("/api/user/sync", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const { email, name, role, authUserId, createdAt } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, error: "Email is required." });
    }

    const normalizedRole = normalizeRole(role);
    const defaultPlan = defaultPlanForRole(normalizedRole);
    const existing = await findUserByIdentity({ email, authUserId });

    if (!existing) {
      await db.collection("users").insertOne({
        email,
        name: name || email,
        role: normalizedRole === "recruiter" ? "recruiter" : "job_seeker",
        authUserId: authUserId || null,
        plan: defaultPlan,
        createdAt: createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      await db.collection("users").updateOne(
        { _id: existing._id },
        {
          $set: {
            ...(name ? { name } : {}),
            ...(authUserId ? { authUserId } : {}),
            role:
              normalizedRole === "recruiter" ? "recruiter" : existing.role || "job_seeker",
            updatedAt: new Date().toISOString(),
          },
        },
      );
    }

    const user = await findUserByIdentity({ email, authUserId });
    return res.status(200).json({
      success: true,
      plan: user?.plan || defaultPlan,
      limit: PLAN_LIMITS[user?.plan || defaultPlan],
    });
  } catch (error) {
    console.error("User sync failure:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST: /api/user/upgrade-plan
 * Persists a paid plan after Stripe checkout or webhook events.
 */
app.post("/api/user/upgrade-plan", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const {
      email,
      plan,
      role,
      authUserId,
      stripeCustomerId,
      stripeSubscriptionId,
    } = req.body;

    if (!email || !plan) {
      return res.status(400).json({
        success: false,
        error: "Email and plan are required.",
      });
    }

    if (!PLAN_LIMITS[plan]) {
      return res.status(400).json({
        success: false,
        error: `Unknown plan: ${plan}`,
      });
    }

    const normalizedRole = normalizeRole(role);
    const existing = await findUserByIdentity({ email, authUserId });
    const roleValue =
      normalizedRole === "recruiter"
        ? "recruiter"
        : normalizedRole === "admin"
          ? "admin"
          : "job_seeker";

    const updatePayload = {
      email,
      plan,
      role: existing?.role || roleValue,
      updatedAt: new Date().toISOString(),
      ...(authUserId ? { authUserId } : {}),
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
    };

    if (!existing) {
      await db.collection("users").insertOne({
        ...updatePayload,
        createdAt: new Date().toISOString(),
      });
    } else {
      await db.collection("users").updateOne(
        { _id: existing._id },
        { $set: updatePayload },
      );
    }

    return res.status(200).json({
      success: true,
      plan,
      limit: PLAN_LIMITS[plan],
    });
  } catch (error) {
    console.error("Plan upgrade failure:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET: /api/user/plan-status
 * Role-aware quota endpoint for seekers and recruiters.
 */
app.get("/api/user/plan-status", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const userEmail = req.headers["user-email"];
    const userRole = req.headers["user-role"] || "job_seeker";
    const authUserId = req.headers["user-id"];

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Missing user-email header.",
      });
    }

    let user = await findUserByIdentity({ email: userEmail, authUserId });

    if (!user) {
      user = {
        email: userEmail,
        role: userRole,
        plan: defaultPlanForRole(userRole),
        createdAt: new Date().toISOString(),
      };
    }

    const currentPlan = user.plan || defaultPlanForRole(userRole);
    const maxAllowed = PLAN_LIMITS[currentPlan] ?? PLAN_LIMITS.seeker_free;
    const normalizedRole = normalizeRole(user.role || userRole);

    if (normalizedRole === "recruiter") {
      const recruiterKey = authUserId || user.authUserId || userEmail;
      const used = await db.collection("jobs").countDocuments({
        recruiterId: recruiterKey,
        status: "active",
      });

      return res.status(200).json({
        role: "recruiter",
        ...buildQuotaResponse({ plan: currentPlan, used, limit: maxAllowed }),
      });
    }

    const cycleStartISO = getBillingCycleStart(user);
    const used = await db.collection("applications").countDocuments({
      $or: [{ applicantId: userEmail }, { email: userEmail }],
      appliedAt: { $gte: cycleStartISO },
    });

    return res.status(200).json({
      role: "seeker",
      ...buildQuotaResponse({ plan: currentPlan, used, limit: maxAllowed }),
    });
  } catch (error) {
    console.error("Plan status failure:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 🚀 GET: /api/user/apply-status
 * Pulls profile plans and evaluates current monthly balances dynamically
 */
app.get("/api/user/apply-status", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const userEmail = req.headers["user-email"];
    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Missing user-email header context mapping.",
      });
    }

    let user = await findUserByIdentity({ email: userEmail });

    if (!user) {
      user = {
        email: userEmail,
        plan: "seeker_free",
        createdAt: new Date().toISOString(),
      };
    }

    const currentPlan = user.plan || "seeker_free";
    const maxAllowed = PLAN_LIMITS[currentPlan] ?? PLAN_LIMITS.seeker_free;
    const cycleStartISO = getBillingCycleStart(user);

    const used = await db.collection("applications").countDocuments({
      $or: [{ applicantId: userEmail }, { email: userEmail }],
      appliedAt: { $gte: cycleStartISO },
    });

    return res.status(200).json({
      role: "seeker",
      ...buildQuotaResponse({ plan: currentPlan, used, limit: maxAllowed }),
    });
  } catch (error) {
    console.error("💥 Apply Status Engine Failure:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/*
 * 🚀 POST: /api/applications
 * Dynamic subscription-enforced application processing routing hub
 */
app.post("/api/applications", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });

    const { email, applicantId } = req.body;
    const userIdentifier = email || applicantId;

    if (!userIdentifier) {
      return res
        .status(400)
        .json({
          success: false,
          error: "Missing required applicant identifiers.",
        });
    }

    let user = await findUserByIdentity({ email: userIdentifier });

    if (!user) {
      user = {
        email: userIdentifier,
        plan: "seeker_free",
        createdAt: new Date().toISOString(),
      };
    }

    const currentPlan = user.plan || "seeker_free";
    const maxAllowed = PLAN_LIMITS[currentPlan] ?? PLAN_LIMITS.seeker_free;
    const cycleStartISO = getBillingCycleStart(user);

    const currentApplicationsCount = await db
      .collection("applications")
      .countDocuments({
        $or: [{ applicantId: user.email }, { email: user.email }],
        appliedAt: { $gte: cycleStartISO },
      });

    // 4. Enforce structural dynamic interception gates
    if (maxAllowed !== "unlimited" && currentApplicationsCount >= maxAllowed) {
      return res.status(403).json({
        success: false,
        error: `Your ${currentPlan.replace("seeker_", "").toUpperCase()} plan limit has been fully consumed! Please upgrade to continue applying.`,
      });
    }

    // 5. Append runtime date stamps and insert transaction
    const applicationPayload = { ...req.body };
    applicationPayload.appliedAt = new Date().toISOString();

    const result = await db
      .collection("applications")
      .insertOne(applicationPayload);
    const remainingTokens =
      maxAllowed === "unlimited"
        ? "unlimited"
        : maxAllowed - (currentApplicationsCount + 1);

    return res.status(201).json({
      success: true,
      insertedId: result.insertedId,
      remaining: remainingTokens,
    });
  } catch (error) {
    console.error("💥 Submission Pipeline Defect:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------- STANDARD PLATFORM CRUD ENDPOINTS -----------------

app.post("/api/company", async (req, res) => {
  try {
    if (!db)
      return res
        .status(500)
        .json({ success: false, error: "Database not initialized" });
    const companyData = req.body;
    const result = await db.collection("companies").insertOne(companyData);
    res.status(201).json({ success: true, insertedId: result.insertedId });
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
    if (req.query.recruiterId) query.recruiterId = req.query.recruiterId;
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
    if (req.query.recruiterId) query.recruiterId = req.query.recruiterId;
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
    const recruiterId = dataToSave.recruiterId;
    const recruiterEmail = dataToSave.recruiterEmail;

    if (!recruiterId && !recruiterEmail) {
      return res.status(400).json({
        success: false,
        error: "Missing recruiter identity for plan enforcement.",
      });
    }

    let user = await findUserByIdentity({
      email: recruiterEmail,
      authUserId: recruiterId,
    });

    if (!user) {
      user = {
        email: recruiterEmail || recruiterId,
        plan: "recruiter_free",
        createdAt: new Date().toISOString(),
      };
    }

    const currentPlan = user.plan || "recruiter_free";
    const maxAllowed = PLAN_LIMITS[currentPlan] ?? PLAN_LIMITS.recruiter_free;
    const recruiterKey = recruiterId || user.authUserId || recruiterEmail;

    if (maxAllowed !== "unlimited") {
      const activeJobs = await db.collection("jobs").countDocuments({
        recruiterId: recruiterKey,
        status: "active",
      });

      if (activeJobs >= maxAllowed) {
        return res.status(403).json({
          success: false,
          error: `Your ${currentPlan.replace("recruiter_", "").toUpperCase()} plan allows up to ${maxAllowed} active job posts. Please upgrade to post more jobs.`,
        });
      }
    }

    dataToSave.createdAt = new Date().toISOString();
    const result = await db.collection("jobs").insertOne(dataToSave);

    const activeJobsAfterInsert = await db.collection("jobs").countDocuments({
      recruiterId: recruiterKey,
      status: "active",
    });

    return res.status(201).json({
      success: true,
      insertedId: result.insertedId,
      remaining:
        maxAllowed === "unlimited"
          ? "unlimited"
          : Math.max(0, maxAllowed - activeJobsAfterInsert),
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
    if (ObjectId.isValid(id)) searchConditions.push({ _id: new ObjectId(id) });
    const job = await db.collection("jobs").findOne({ $or: searchConditions });
    if (!job)
      return res
        .status(404)
        .json({ success: false, error: "Job not found in database." });
    res.status(200).json({ success: true, data: job });
  } catch (error) {
    console.error("❌ MongoDB Fetch Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------- START ENGINE -----------------
app.listen(port, () => {
  console.log(`📡 Express API running on port ${port}`);
});
